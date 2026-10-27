-- Sala de atendimento por turma: cada dia do webinar começa com a lista vazia; as turmas passadas ficam no
-- histórico (nada é apagado, só filtrado).
--
-- Turma = dia em Brasília de quando a pessoa entrou (`sessoes.inicio_sessao`), com a virada às 06:00 (não à
-- meia-noite): quem entra na turma das 19h depois da meia-noite continua na turma daquele dia.
-- Espelho em TypeScript: `turmaDe` em src/lib/regras/atendimento.ts.

create or replace function public.turma_atendimento(p_instante timestamptz)
returns date
language sql immutable set search_path = '' as $$
  select ((p_instante at time zone 'America/Sao_Paulo') - interval '6 hours')::date;
$$;

-- Igual a `conversas_atendimento`, só com o filtro opcional de turma (null = todas). Fica numa função nova pra
-- não mexer na assinatura da antiga (o MCP e as leituras sem turma continuam usando ela).
create or replace function public.conversas_atendimento_turma(p_webinar uuid, p_turma date default null, p_limite int default 300)
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
    join public.sessoes s0 on s0.id = m.sessao_id
    where m.webinar_id = p_webinar
      and (p_turma is null or public.turma_atendimento(s0.inicio_sessao) = p_turma)
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
revoke execute on function public.conversas_atendimento_turma(uuid, date, int) from public, anon;
grant execute on function public.conversas_atendimento_turma(uuid, date, int) to authenticated, service_role;

-- Turmas que tiveram conversa (pelo menos uma mensagem do participante), mais recente primeiro: o seletor de
-- histórico da sala de atendimento.
create or replace function public.turmas_atendimento(p_webinar uuid, p_limite int default 90)
returns table (turma date, conversas int)
language sql stable security invoker set search_path = '' as $$
  select public.turma_atendimento(s.inicio_sessao), count(distinct s.id)::int
  from public.mensagens_suporte m
  join public.sessoes s on s.id = m.sessao_id
  where m.webinar_id = p_webinar
    and m.autor = 'participante'
  group by 1
  order by 1 desc
  limit greatest(coalesce(p_limite, 90), 0);
$$;
revoke execute on function public.turmas_atendimento(uuid, int) from public, anon;
grant execute on function public.turmas_atendimento(uuid, int) to authenticated, service_role;
