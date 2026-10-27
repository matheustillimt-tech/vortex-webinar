-- Fim de sessão (abandonou/não viu a oferta) e fila de disparos processada pelo cron.

alter table public.sessoes add column avaliada_fim boolean not null default false;
alter table public.sessoes add column max_segundo integer not null default 0;

-- O histórico (sessões de antes desta etapa) não é avaliado: senão o primeiro cron dispararia `abandonou` e
-- `nao_viu_oferta` para todo mundo que já passou pela sala.
update public.sessoes set avaliada_fim = true where avaliada_fim = false;

-- O cron busca sessões encerradas (sem sinal recente) ainda não avaliadas: o índice parcial cobre só essas.
create index sessoes_fim_nao_avaliada on public.sessoes (ultimo_sinal_em) where avaliada_fim = false;

-- Reserva até p_limite disparos da fila (prontos pra tentar, em ordem) sem dois processos pegarem o mesmo
-- (`for update skip locked`), já incrementando as tentativas. A reserva é um "lease": `enviar_apos` vai 3 min pra
-- frente na mesma atualização, então um cron sobreposto (ou o seguinte, se este morrer no meio) não pega o mesmo
-- disparo antes disso; quem chama grava o resultado (ok/erro/fila com nova espera) por cima. `security invoker`,
-- `search_path` travado; só o cron (service role) chama.
create or replace function public.pegar_disparos(p_limite int) returns setof public.disparos
language sql security invoker set search_path = '' as $$
  update public.disparos set tentativas = tentativas + 1, enviar_apos = now() + interval '3 minutes'
  where id in (
    select id from public.disparos
    where status = 'fila' and enviar_apos <= now()
    order by enviar_apos
    limit p_limite
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.pegar_disparos(int) from public, anon, authenticated;
grant execute on function public.pegar_disparos(int) to service_role;

-- Sinal de vida da sessão, atômico: `max_segundo` só cresce (`greatest`) mesmo com dois sinais ao mesmo tempo, e
-- devolve o valor anterior e o novo (quem chama só enfileira `permaneceu` quando cresceu). A linha é travada no
-- subselect (`for update`) pra o "anterior" ser o valor de verdade antes desta atualização. No replay também grava
-- a posição. Só o servidor (service role) chama.
create or replace function public.registrar_sinal(p_sessao uuid, p_segundo int, p_replay boolean)
returns table (anterior integer, atual integer)
language sql security invoker set search_path = '' as $$
  update public.sessoes s
     set ultimo_sinal_em = now(),
         max_segundo = greatest(s.max_segundo, p_segundo),
         posicao_replay_seg = case when p_replay then p_segundo else s.posicao_replay_seg end
    from (select id, max_segundo from public.sessoes where id = p_sessao for update) a
   where s.id = a.id
  returning a.max_segundo, s.max_segundo;
$$;

revoke execute on function public.registrar_sinal(uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.registrar_sinal(uuid, int, boolean) to service_role;
