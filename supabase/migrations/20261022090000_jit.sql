-- Just in time e e-mails (inscrição confirmada, lembrete e "estamos começando") pelo Resend.

-- 1) Novo tipo de evento: inscreveu na página de inscrição do just in time (`/<slug>/lp`). O check nasceu inline
--    na migração inicial, com o nome padrão `eventos_tipo_check`: recria com a lista antiga + `inscreveu_lp`.
alter table public.eventos drop constraint eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check check (tipo in (
  'visitou_login', 'acessou_sala', 'sem_login', 'fez_login', 'link_magico', 'login_provisorio', 'clicou_video',
  'mensagem_chat', 'mensagem_atendente', 'min_15', 'min_30', 'min_45', 'min_60', 'pitch', 'oferta', 'clicou_oferta',
  'comprou', 'inscreveu_lp'
));

-- 1b) Fuso em que a pessoa viu e escolheu o horário do JIT (o da configuração, ou o do navegador quando a configuração
--     é "participante"): os e-mails mostram data/hora nele. Nulo fora do JIT (e nas inscrições antigas).
alter table public.sessoes add column jit_fuso text check (jit_fuso is null or char_length(jit_fuso) between 1 and 64);

-- 2) Fila dos e-mails do JIT: no máximo um de cada tipo por sessão (a inscrição repetida não reenfileira). O cron
--    pega os vencidos (`status = 'fila' and enviar_em <= now()`) pela `pegar_emails` e grava o resultado.
create table public.envios_email (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  tipo text not null check (tipo in ('inscricao', 'lembrete', 'comecando')),
  enviar_em timestamptz not null,
  status text not null default 'fila' check (status in ('fila', 'enviado', 'erro', 'expirado')),
  tentativas integer not null default 0,
  erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sessao_id, tipo)
);

create index envios_email_status_enviar_em on public.envios_email (status, enviar_em);
-- "Últimos envios" do webinar no painel.
create index envios_email_webinar_created on public.envios_email (webinar_id, created_at desc);

create trigger envios_email_updated_at before update on public.envios_email
  for each row execute function public.tocar_updated_at();

alter table public.envios_email enable row level security;
create policy admin_tudo on public.envios_email for all to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- 3) Reserva até p_limite e-mails da fila (vencidos, em ordem) sem dois processos pegarem o mesmo
--    (`for update skip locked`), já incrementando as tentativas. Mesmo "lease" da `pegar_disparos`: `enviar_em` vai
--    3 min pra frente na mesma atualização; quem chama grava o resultado (enviado/erro/fila com nova espera) por
--    cima. `security invoker`, `search_path` travado; só o cron (service role) chama.
create or replace function public.pegar_emails(p_limite int) returns setof public.envios_email
language sql security invoker set search_path = '' as $$
  update public.envios_email set tentativas = tentativas + 1, enviar_em = now() + interval '3 minutes'
  where id in (
    select id from public.envios_email
    where status = 'fila' and enviar_em <= now()
    order by enviar_em
    limit p_limite
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.pegar_emails(int) from public, anon, authenticated;
grant execute on function public.pegar_emails(int) to service_role;
