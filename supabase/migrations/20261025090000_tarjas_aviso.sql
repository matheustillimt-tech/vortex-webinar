-- Tarja de aviso: faixa por cima do vídeo da sala (topo ou base) com um aviso que segura a retenção
-- ("Nós vamos fechar a sala, não saia dela!"). Aparece no segundo `aparece_seg` do vídeo e fica `duracao_seg`
-- segundos. O limite de 20 por webinar é conferido na action do painel.

create table public.tarjas_aviso (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 120),
  aparece_seg integer not null check (aparece_seg >= 0),
  duracao_seg integer not null default 15 check (duracao_seg between 3 and 600),
  posicao text not null default 'topo' check (posicao in ('topo', 'base')),
  cor text not null default 'vermelho' check (cor in ('vermelho', 'amarelo', 'verde', 'preto')),
  ligada boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tarjas_aviso_webinar_aparece on public.tarjas_aviso (webinar_id, aparece_seg);

create trigger tarjas_aviso_updated_at before update on public.tarjas_aviso
  for each row execute function public.tocar_updated_at();

-- Mesmo padrão das outras tabelas de configuração do webinar: admin mexe em tudo, a equipe só lê. A sala lê com
-- a service role (não passa pela RLS).
alter table public.tarjas_aviso enable row level security;
create policy admin_tudo on public.tarjas_aviso for all to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy equipe_le on public.tarjas_aviso for select to authenticated using ((select public.eh_membro()));
