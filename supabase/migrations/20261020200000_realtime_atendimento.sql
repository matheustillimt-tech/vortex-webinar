-- Tempo real do atendimento: publica só `mensagens_suporte` no supabase_realtime (o painel escuta
-- postgres_changes dela; `sessoes` fica fora — muda a cada sinal de presença da sala, o que faria todo painel aberto
-- recarregar a lista várias vezes por segundo num webinar cheio), autoriza o canal privado de presença
-- `atendimento:<webinarId>` (Realtime Authorization) só pra equipe, cria as funções de leitura do painel
-- (`conversas_atendimento`, `metricas_ao_vivo`) e acrescenta os índices que a sala e o painel consultam o tempo todo.
-- O participante nunca usa Realtime (busca por polling autenticado pelo cookie).
--
-- Os blocos condicionais (`do $$ if exists ...`) servem a dois propósitos: compatibilidade com bancos sem
-- `supabase_realtime`/esquema `realtime` (não fazem nada ali) e re-aplicação segura no Supabase hospedado (a
-- migração ainda não foi aplicada lá, mas publicação/política só entram se faltarem).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens_suporte'
    ) then
      execute 'alter publication supabase_realtime add table public.mensagens_suporte';
    end if;
    -- Uma versão anterior desta migração (só em bancos locais) publicava `sessoes`: tira, se estiver lá.
    if exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessoes'
    ) then
      execute 'alter publication supabase_realtime drop table public.sessoes';
    end if;
  end if;
end $$;

-- Canal privado só pros tópicos `atendimento:<webinarId>` (presença da equipe); qualquer outro tópico privado
-- continua negado.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'realtime') then
    execute 'drop policy if exists equipe_le_realtime on realtime.messages';
    execute $pol$
      create policy equipe_le_realtime on realtime.messages for select to authenticated
      using ((select public.eh_membro()) and (select realtime.topic()) like 'atendimento:%')
    $pol$;
    execute 'drop policy if exists equipe_envia_realtime on realtime.messages';
    execute $pol$
      create policy equipe_envia_realtime on realtime.messages for insert to authenticated
      with check ((select public.eh_membro()) and (select realtime.topic()) like 'atendimento:%')
    $pol$;
  end if;
end $$;

create index if not exists sessoes_webinar_ultimo_sinal on public.sessoes (webinar_id, ultimo_sinal_em desc);
create index if not exists mensagens_suporte_webinar_criada on public.mensagens_suporte (webinar_id, created_at);

-- Rate limit atômico do upload de imagem da sala (`POST /api/sala/imagem`): 1 imagem a cada 10 s por sessão,
-- checado e gravado num único `update ... where ultima_imagem_em is null or < agora - 10s` (sem essa coluna, a
-- checagem por "última mensagem com imagem" é burlável — basta subir sem nunca mandar a mensagem).
alter table public.sessoes add column if not exists ultima_imagem_em timestamptz;

-- Lista de conversas do painel de atendimento numa consulta só: sessões do webinar com pelo menos uma mensagem
-- do participante, a última mensagem (de qualquer autor; apagada vem sem texto/imagem e com `ultima_apagada`) e as
-- não lidas (mensagens do participante depois da última do atendente — chatbot e IA não contam como resposta).
-- Mais recente primeiro (pela última mensagem), limitada a `p_limite`. `security invoker`: a RLS das tabelas vale
-- pra quem chama (equipe lê; anônimo não vê nada) — o servidor ainda confere o membro antes de chamar.
create or replace function public.conversas_atendimento(p_webinar uuid, p_limite int default 300)
returns table (
  sessao_id uuid,
  participante_nome text,
  participante_email text,
  participante_telefone text,
  inicio_sessao timestamptz,
  ultimo_sinal_em timestamptz,
  status_atendimento text,
  atendente_id uuid,
  atendente_nome text,
  ultima_texto text,
  ultima_imagem boolean,
  ultima_autor text,
  ultima_em timestamptz,
  ultima_apagada boolean,
  nao_lidas int
)
language sql stable security invoker set search_path = '' as $$
  with por_sessao as (
    select m.sessao_id,
           max(m.created_at) as ultima_em,
           max(m.created_at) filter (where m.autor = 'atendente') as ultima_atendente_em
    from public.mensagens_suporte m
    where m.webinar_id = p_webinar
    group by m.sessao_id
    having bool_or(m.autor = 'participante')
    order by max(m.created_at) desc, m.sessao_id
    limit greatest(coalesce(p_limite, 300), 0)
  )
  select s.id,
         p.nome,
         p.email,
         p.telefone_e164,
         s.inicio_sessao,
         s.ultimo_sinal_em,
         s.status_atendimento,
         s.atendente_id,
         u.nome,
         case when ult.apagada then null else ult.texto end,
         (not ult.apagada and ult.imagem_url is not null),
         ult.autor,
         ult.created_at,
         ult.apagada,
         nl.total
  from por_sessao c
  join public.sessoes s on s.id = c.sessao_id and s.webinar_id = p_webinar
  left join public.participantes p on p.id = s.participante_id
  left join public.usuarios u on u.id = s.atendente_id
  cross join lateral (
    select m.texto, m.imagem_url, m.autor, m.created_at, m.apagada
    from public.mensagens_suporte m
    where m.sessao_id = c.sessao_id
    order by m.created_at desc, m.id desc
    limit 1
  ) ult
  cross join lateral (
    select count(*)::int as total
    from public.mensagens_suporte m
    where m.sessao_id = c.sessao_id
      and m.autor = 'participante'
      and m.created_at > coalesce(c.ultima_atendente_em, '-infinity'::timestamptz)
  ) nl
  order by c.ultima_em desc, c.sessao_id;
$$;

revoke execute on function public.conversas_atendimento(uuid, int) from public, anon;
grant execute on function public.conversas_atendimento(uuid, int) to authenticated, service_role;

-- Números do painel Ao vivo (contagem real, sem teto de linhas): sessões online (sinal nos últimos 60 s) ao vivo ×
-- replay e desktop × celular. Sessão de teste nunca conta. Chamada pelo servidor (service role) depois de conferir
-- o membro; `security invoker` mantém a RLS se um dia for chamada pelo cliente do membro.
create or replace function public.metricas_ao_vivo(p_webinar uuid)
returns table (ao_vivo int, replay int, desktop int, mobile int)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where s.modo = 'ao_vivo')::int,
         count(*) filter (where s.modo = 'replay')::int,
         count(*) filter (where s.dispositivo = 'desktop')::int,
         count(*) filter (where s.dispositivo = 'mobile')::int
  from public.sessoes s
  where s.webinar_id = p_webinar
    and s.modo in ('ao_vivo', 'replay')
    and s.ultimo_sinal_em >= now() - interval '60 seconds';
$$;

revoke execute on function public.metricas_ao_vivo(uuid) from public, anon;
grant execute on function public.metricas_ao_vivo(uuid) to authenticated, service_role;
