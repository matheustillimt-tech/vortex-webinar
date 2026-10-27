-- Colunas que a geração de chat por IA precisa pra avançar em etapas (fila -> transcrevendo -> gerando ->
-- pronto|erro) e retomar de onde parou a cada execução do cron.
alter table public.geracoes_chat
  add column blocos jsonb,
  add column bloco_atual integer not null default 0,
  add column mensagens_geradas integer not null default 0,
  add column fonte_url text,
  -- Lease de quem está processando agora (reivindicação atômica pelo cron) e quantas vezes já foi reivindicada
  -- sem terminar — 3 reivindicações sem terminar vira erro, em vez de ficar tentando pra sempre.
  add column trabalhando_ate timestamptz,
  add column tentativas integer not null default 0,
  -- Total de blocos da transcrição, pra tela de acompanhamento não precisar buscar o `blocos` (jsonb grande, só
  -- admin deveria ver mesmo assim).
  add column total_blocos integer;

create index geracoes_chat_status_created_at on public.geracoes_chat (status, created_at);

-- Uma geração em andamento por webinar (fila|transcrevendo|gerando): o índice único parcial garante isso no banco,
-- não só na checagem de `iniciarGeracao`.
create unique index geracoes_chat_uma_em_andamento_por_webinar
  on public.geracoes_chat (webinar_id)
  where status in ('fila', 'transcrevendo', 'gerando');
