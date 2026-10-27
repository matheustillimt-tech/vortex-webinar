-- Retenção por sessão: a API de sinal (`/api/sala/sinal`) grava um minuto de retenção por sessão uma única vez
-- (unique (sessao_id, minuto)) e, só quando o insert realmente entra, soma 1 em `retencao` via `somar_retencao`.
-- Sem updated_at: cada linha é imutável (nunca atualizada depois de inserida).
create table public.retencao_sessao (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  minuto integer not null,
  created_at timestamptz not null default now(),
  unique (sessao_id, minuto)
);

alter table public.retencao_sessao enable row level security;
create policy admin_tudo on public.retencao_sessao for all to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- Soma 1 na visualização do minuto (upsert). `security invoker` + `search_path` travado; só a service role chama
-- (a sala grava via API do servidor, nunca o navegador direto no Supabase).
create or replace function public.somar_retencao(p_webinar uuid, p_data date, p_minuto int) returns void
language sql security invoker set search_path = '' as $$
  insert into public.retencao (webinar_id, data, minuto, visualizacoes)
  values (p_webinar, p_data, p_minuto, 1)
  on conflict (webinar_id, data, minuto) do update set visualizacoes = public.retencao.visualizacoes + 1, updated_at = now();
$$;

revoke execute on function public.somar_retencao(uuid, date, int) from public, anon, authenticated;
