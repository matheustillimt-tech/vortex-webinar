-- Vórtex Webinar: esquema completo. Datas em UTC.

create extension if not exists pgcrypto;

create or replace function public.tocar_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Equipe ---------------------------------------------------------------------------------------------------------
create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  papel text not null default 'atendente' check (papel in ('admin', 'atendente')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.eh_membro() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo)
$$;

create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo and papel = 'admin')
$$;

-- Vídeos ---------------------------------------------------------------------------------------------------------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_original text,
  bunny_guid text unique,
  hls_url text,
  thumb_url text,
  bytes bigint,
  duracao_seg integer,
  status text not null default 'enviando' check (status in ('enviando', 'processando', 'pronto', 'erro')),
  progresso integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Páginas (editor) -----------------------------------------------------------------------------------------------
create table public.paginas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('registro_jit', 'espera_jit', 'espera_unica')),
  modelo text not null,
  config jsonb not null default '{}',
  componentes jsonb not null default '[]',
  miniatura_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webinar --------------------------------------------------------------------------------------------------------
create table public.webinars (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  titulo text,
  slug text not null unique,
  idioma text not null default 'pt-BR' check (idioma in ('pt-BR', 'es', 'en')),
  apresentador_nome text,
  apresentador_avatar_url text,
  acesso_facilitado boolean not null default false,
  login_na_sala boolean not null default false,
  sincronizar_video boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo', 'arquivado')),
  tipo_agenda text not null default 'unica' check (tipo_agenda in ('unica', 'recorrente', 'jit')),
  limite_simultaneo integer,
  pixel_meta text,
  pixel_tiktok text,
  gtm text,
  script_personalizado text,
  compartilhar_titulo text,
  compartilhar_descricao text,
  compartilhar_imagem_url text,
  titulo_notificacao_compra text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  fuso text not null default 'America/Sao_Paulo',
  inicio timestamptz,
  fim timestamptz,
  repeticao text not null default 'nenhuma' check (repeticao in ('nenhuma', 'diaria', 'semanal')),
  dia_semana smallint check (dia_semana between 0 and 6),
  hora_inicio time,
  hora_fim time,
  usar_sala_espera boolean not null default true,
  pagina_espera_id uuid references public.paginas(id) on delete set null,
  vigencia_fim timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jit_horarios (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  quando text not null check (quando in ('todo_dia', 'a_cada', 'data', 'dia_semana')),
  hora time,
  intervalo_min smallint check (intervalo_min in (15, 30, 45, 60)),
  data timestamptz,
  dia_semana smallint check (dia_semana between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jit_config (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  fuso text not null default 'America/Sao_Paulo', -- 'participante' = fuso do navegador de quem acessa
  esconder_de smallint check (esconder_de between 0 and 23),
  esconder_ate smallint check (esconder_ate between 0 and 23),
  exibicao text not null default 'todos' check (exibicao in ('todos', 'proximo', 'entrar_direto', 'proximos_2', 'proximos_3', 'proximos_4')),
  pagina_registro_id uuid references public.paginas(id) on delete set null,
  pagina_espera_id uuid references public.paginas(id) on delete set null,
  fim timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.emails_jit (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  tipo text not null check (tipo in ('inscricao', 'lembrete', 'comecando')),
  minutos_antes smallint,
  remetente_nome text not null default 'Vórtex',
  assunto text not null,
  modelo jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (webinar_id, tipo)
);

create table public.telas_login (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  logo_url text,
  logo_alinhamento text not null default 'centro' check (logo_alinhamento in ('esquerda', 'centro', 'direita')),
  logo_largura_total boolean not null default true,
  barra_ligada boolean not null default true,
  barra_valor smallint not null default 92 check (barra_valor between 0 and 99),
  barra_cor text not null default '#e01414',
  barra_cor_texto text not null default '#ffffff',
  titulo_html text,
  botao_texto text not null default 'Assistir transmissão',
  botao_cor text not null default '#16a34a',
  botao_cor_texto text not null default '#ffffff',
  pede_email boolean not null default true,
  email_obrigatorio boolean not null default true,
  pede_telefone boolean not null default false,
  telefone_obrigatorio boolean not null default false,
  pais_padrao text not null default 'BR',
  placeholder_nome text not null default 'Como podemos te chamar',
  placeholder_email text not null default 'Seu melhor e-mail',
  placeholder_telefone text not null default 'Seu WhatsApp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_obrigatorio or telefone_obrigatorio)
);

create table public.webinar_video (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete restrict,
  autoplay boolean not null default true,
  tela_cheia boolean not null default false,
  orientacao text not null default 'horizontal' check (orientacao in ('horizontal', 'vertical')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ofertas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  ligada boolean not null default true,
  nome text not null,
  titulo text not null,
  preco_original text,
  preco_oferta text,
  botao_texto text not null default 'Quero aproveitar',
  botao_cor text not null default '#16a34a',
  banner_url text,
  banner_mobile_url text,
  link text,
  repassar_utms boolean not null default false,
  aparece_seg integer not null check (aparece_seg >= 1),
  some_seg integer not null default 0,
  pitch_seg integer,
  contagem_seg integer not null default 300,
  contagem_layout text not null default 'classico' check (contagem_layout in ('classico', 'rotulos', 'urgente')),
  sorteio_ligado boolean not null default false,
  sorteio_seg integer,
  sorteio_numero text check (sorteio_numero ~ '^[0-9]{1,6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (some_seg = 0 or some_seg > aparece_seg)
);

create table public.mensagens_simuladas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  segundo integer not null check (segundo >= 0),
  nome text not null,
  texto text not null,
  suporte boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mensagens_simuladas_webinar_segundo on public.mensagens_simuladas (webinar_id, segundo);

create table public.vendas_simuladas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  segundo integer not null check (segundo >= 0),
  texto text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendas_simuladas_webinar_segundo on public.vendas_simuladas (webinar_id, segundo);

create table public.audiencias (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  modo text not null default 'oculto' check (modo in ('oculto', 'fixo', 'dinamico')),
  minimo integer,
  maximo integer,
  selo_ao_vivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimo is null or maximo is null or minimo <= maximo)
);

create table public.chatbot (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  remetente text not null default 'Suporte',
  palavra_chave text not null,
  resposta text not null,
  imagem_url text,
  atraso_seg integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agentes_ia (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null unique references public.webinars(id) on delete cascade,
  ligado boolean not null default false,
  nome text,
  instrucoes text,
  contexto text,
  faq text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.regras (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  gatilho text not null check (gatilho in ('acessou', 'inscreveu_lp', 'cadastrou', 'permaneceu', 'abandonou', 'pitch', 'oferta', 'clicou_oferta', 'nao_viu_oferta')),
  valor_seg integer,
  url text not null,
  metodo text not null default 'POST' check (metodo in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  headers_enc text,
  params jsonb not null default '{}',
  corpo text,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Participantes e sessões ----------------------------------------------------------------------------------------
create table public.participantes (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  nome text not null,
  email text,
  telefone_e164 text,
  temporario boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index participantes_webinar_email on public.participantes (webinar_id, lower(email));
create index participantes_webinar_telefone on public.participantes (webinar_id, telefone_e164);

create table public.testes_ab (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  inicio timestamptz not null,
  fim timestamptz not null,
  fuso text not null default 'America/Sao_Paulo',
  arquivado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim >= inicio)
);

create table public.testes_ab_variacoes (
  id uuid primary key default gen_random_uuid(),
  teste_id uuid not null references public.testes_ab(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete restrict,
  ordem smallint not null check (ordem between 0 and 3),
  percentual smallint not null check (percentual between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teste_id, ordem)
);

create table public.sessoes (
  id uuid primary key default gen_random_uuid(),
  participante_id uuid not null references public.participantes(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  teste_ab_id uuid references public.testes_ab(id) on delete set null,
  variacao_webinar_id uuid references public.webinars(id) on delete set null,
  inicio_sessao timestamptz not null,
  jit_horario timestamptz,
  entrou_em timestamptz not null default now(),
  modo text not null default 'ao_vivo' check (modo in ('ao_vivo', 'replay', 'teste')),
  utms jsonb not null default '{}',
  dispositivo text,
  navegador text,
  pais text,
  cidade text,
  lat double precision,
  lon double precision,
  ip_hash text,
  ultimo_sinal_em timestamptz,
  posicao_replay_seg integer,
  atendente_id uuid references public.usuarios(id) on delete set null,
  status_atendimento text not null default 'aguardando' check (status_atendimento in ('aguardando', 'atendendo', 'atendido', 'dispensado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessoes_webinar_entrou on public.sessoes (webinar_id, entrou_em desc);

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  tipo text not null check (tipo in ('visitou_login', 'acessou_sala', 'sem_login', 'fez_login', 'link_magico', 'login_provisorio', 'clicou_video', 'mensagem_chat', 'mensagem_atendente', 'min_15', 'min_30', 'min_45', 'min_60', 'pitch', 'oferta', 'clicou_oferta', 'comprou')),
  segundo_video integer,
  criado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sessao_id, tipo)
);
create index eventos_webinar_tipo_data on public.eventos (webinar_id, tipo, criado_em);

create table public.retencao (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  data date not null,
  minuto integer not null,
  visualizacoes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (webinar_id, data, minuto)
);

create table public.mensagens_suporte (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  autor text not null check (autor in ('participante', 'atendente', 'chatbot', 'ia')),
  autor_id uuid references public.usuarios(id) on delete set null,
  texto text,
  imagem_url text,
  editada boolean not null default false,
  apagada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (texto is not null or imagem_url is not null)
);
create index mensagens_suporte_sessao on public.mensagens_suporte (sessao_id, created_at);

create table public.disparos (
  id uuid primary key default gen_random_uuid(),
  regra_id uuid not null references public.regras(id) on delete cascade,
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  status text not null default 'fila' check (status in ('fila', 'ok', 'erro')),
  tentativas smallint not null default 0,
  requisicao jsonb,
  resposta jsonb,
  erro text,
  enviar_apos timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (regra_id, sessao_id)
);
create index disparos_fila on public.disparos (enviar_apos) where status = 'fila';

-- Checkouts e vendas reais ---------------------------------------------------------------------------------------
create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  plataforma text not null unique check (plataforma in ('vortexpay', 'kiwify', 'hotmart', 'eduzz', 'hubla', 'themembers')),
  segredo_enc text,
  ligado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checkout_webhooks (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.checkouts(id) on delete cascade,
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  token text not null unique,
  filtro_src text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  sessao_id uuid references public.sessoes(id) on delete set null,
  plataforma text not null,
  id_transacao text not null,
  valor_centavos integer not null,
  comprador_email text,
  comprador_telefone text,
  src text,
  utms jsonb not null default '{}',
  bruto jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plataforma, id_transacao)
);

create table public.checkout_logs (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid references public.checkout_webhooks(id) on delete set null,
  resultado text not null check (resultado in ('aceita', 'ignorada', 'nao_autorizada', 'erro')),
  evento text,
  bruto jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auditoria e IA -------------------------------------------------------------------------------------------------
create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  webinar_id uuid references public.webinars(id) on delete set null,
  acao text not null check (acao in ('criou', 'editou', 'excluiu')),
  descricao text not null,
  antes jsonb,
  depois jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.geracoes_chat (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  status text not null default 'fila' check (status in ('fila', 'transcrevendo', 'gerando', 'pronto', 'erro')),
  idioma text not null default 'pt',
  tom text not null default 'natural' check (tom in ('formal', 'natural')),
  intensidade text not null default 'media' check (intensidade in ('baixa', 'media', 'alta')),
  instrucoes text,
  transcricao text,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at e RLS em tudo ---------------------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create trigger %I before update on public.%I for each row execute function public.tocar_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    -- Admin mexe em tudo. Atendente só entra nas salas de atendimento (políticas específicas abaixo).
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.eh_admin()) with check (public.eh_admin())', t);
  end loop;
end $$;

-- Atendente (qualquer membro ativo): só lê o que precisa pra atender a sala, sem acesso a segredos/financeiro.
create policy equipe_le on public.webinars for select to authenticated using (public.eh_membro());
create policy equipe_le on public.sessoes for select to authenticated using (public.eh_membro());
create policy equipe_le on public.participantes for select to authenticated using (public.eh_membro());
create policy equipe_le on public.mensagens_suporte for select to authenticated using (public.eh_membro());
create policy equipe_le on public.chatbot for select to authenticated using (public.eh_membro());
create policy equipe_le on public.eventos for select to authenticated using (public.eh_membro());
create policy equipe_le on public.audiencias for select to authenticated using (public.eh_membro());
create policy equipe_le on public.ofertas for select to authenticated using (public.eh_membro());

-- Atendente escreve mensagens na sala e assume/dispensa o atendimento da sessão.
create policy equipe_escreve_mensagens on public.mensagens_suporte for insert to authenticated with check (public.eh_membro());
create policy equipe_atualiza_mensagens on public.mensagens_suporte for update to authenticated using (public.eh_membro()) with check (public.eh_membro());
create policy equipe_atualiza_sessoes on public.sessoes for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

-- Auditoria: ninguém atualiza/apaga pela API (nem admin); inserção vem do servidor com service role (ignora RLS).
drop policy admin_tudo on public.auditoria;
create policy ler_auditoria on public.auditoria for select to authenticated using (public.eh_admin());

-- Equipe (usuarios): mantém o comportamento específico — membros leem, só admin escreve.
drop policy admin_tudo on public.usuarios;
create policy ler_equipe on public.usuarios for select to authenticated using (public.eh_membro());
create policy admin_equipe on public.usuarios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
