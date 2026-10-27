# CLAUDE.md — Vórtex Webinar

Guia pro Claude Code mexer neste template. Quem usa normalmente é dono de negócio, não programador: explique o
que vai fazer em português simples antes de mudar algo e confirme antes de publicar.

## O que é

Webinar automático (perpétuo): um vídeo gravado passa como se fosse ao vivo, numa agenda que se repete (sessão
única, diária, dias úteis, semanal ou just in time). Tem página de inscrição e de espera (padrão ou montadas no
editor visual), sala com selo "Ao Vivo" e contador de pessoas, chat e vendas simulados pelo segundo do vídeo,
oferta que aparece no momento marcado, atendimento ao vivo pela aba Suporte, agente de IA, métricas, webhooks,
pixels, vendas reais por webhook de checkout, biblioteca de vídeos no Bunny, teste A/B, equipe com histórico de
ações e servidor MCP.

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4, Supabase (Postgres, Auth da equipe, Realtime
do atendimento e o bucket público `midias`), Bunny Stream (vídeo), GrapesJS (editor de páginas), OpenRouter +
ElevenLabs (IA, opcional), Resend (e-mail, opcional), Vercel (hospedagem + cron a cada minuto), Vitest.

## Um app, dois domínios

O mesmo projeto atende o **painel** (equipe) e a **sala** (público). O `middleware.ts` olha o endereço da
requisição: se for o host de `NEXT_PUBLIC_SALA_URL`, reescreve o caminho pra `app/s/...` (ex.: `/minha-aula` vira
`/s/minha-aula`); senão é painel e exige login. A sala no domínio do painel é redirecionada pro domínio da sala
(não compartilham cookies nem rodam os pixels no painel). A regra está em `src/lib/regras/rota.ts`.
Localmente: painel em `http://localhost:3000`, sala em `http://sala.localhost:3000`.

O público **não** tem login no Supabase: a sessão da sala é um cookie assinado com `SALA_TOKEN_SECRET`
(`src/lib/sala/sessao.ts`) e as APIs da sala (`app/api/sala/*`) usam a service role no servidor. Nada sensível
(regras de webhook, segredos, respostas do agente antes da hora) vai pro navegador da sala.

## Onde está cada coisa

- `app/(painel)/` — telas do painel. `_componentes/` tem as peças compartilhadas (menu, cartões, tabelas, modal,
  gráficos). `webinars/[id]/` é o assistente de 9 passos (início, webinar/agenda, login, vídeo, oferta, chat,
  vendas, agente de IA, pronto) mais métricas, painel ao vivo e histórico. `configuracoes/` tem checkouts,
  integrações por webinar (webhooks, pixels, prévia do link) e as chaves do MCP.
- `app/(editor)/` — editor visual de páginas (GrapesJS); os blocos próprios ficam em `plugin-vw.ts`.
- `app/s/` — a sala do público: `[slug]/lp` (inscrição), `inscrito`, `espera`, `sala`, `cheia`, e `t/[slug]`
  (entrada do teste A/B). `s/_paginas/` monta as páginas feitas no editor.
- `app/api/cron/tick` — o agendador: fila de webhooks (`src/lib/disparos.ts`), e-mails do just in time
  (`src/lib/emails.ts`) e fim de sessão. `app/api/cron/ia` — avança a geração de chat por IA. Os dois exigem
  `Authorization: Bearer CRON_SECRET`.
- `app/api/checkout/[plataforma]/[token]` — vendas reais (Vórtex Pay, Kiwify, Hotmart, Eduzz, Hubla, TheMembers);
  a normalização de cada formato está em `src/lib/regras/checkout.ts`.
- `app/api/bunny/webhook/[token]` — aviso do Bunny quando o vídeo termina de processar.
- `app/api/mcp` + `src/lib/mcp/` — servidor MCP (chaves `vw_…`, só o hash fica no banco).
- `src/lib/regras/` — regras de negócio puras (agenda, relógio da sala, chat, oferta, métricas, webhooks…), todas
  com teste em `tests/`.
- `src/lib/supabase/` — clientes do banco (`admin.ts` usa a service role; só no servidor).
- `src/lib/env.ts` — leitura das variáveis (as obrigatórias e os blocos opcionais Bunny, IA e e-mail).
- `supabase/migrations/` — o banco inteiro, em ordem de data.

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencha (ver INSTALACAO.md, tabela de variáveis)
npm run dev                  # painel em http://localhost:3000, sala em http://sala.localhost:3000
npm test                     # Vitest (não precisa de banco: usa PGlite e dublês)
npm run typecheck
npm run build
```

Pra instalar do zero (Supabase, Vercel, dois domínios, agendador, primeiro administrador), siga o `INSTALACAO.md`.

## Como personalizar

- **Nome no logo e na aba do navegador**: variável `NEXT_PUBLIC_NOME_SISTEMA` (código em `src/lib/marca.ts`).
  A sala do público nunca mostra esse nome: lá aparece só o título da aula.
- **Cores do painel**: variáveis `--color-*` no começo de `app/globals.css` (a cor de marca é `--color-marca`).
  As cores da sala (botão, barra de vagas, oferta) são escolhidas por webinar no próprio assistente.
- **Símbolo (logo)**: `app/(painel)/_componentes/logo.tsx` e o ícone da aba em `app/icon.svg`.
- **Textos padrão da sala** (português, espanhol e inglês): `src/lib/regras/textos-sala.ts`. **E-mails padrão do
  just in time**: `src/lib/regras/emails.ts`. **Modelos de página do editor**: `src/lib/regras/paginas-modelos.ts`.
- **Textos do painel**: ficam nos próprios componentes de `app/(painel)/`. Rode `npm test` depois de mudar
  (alguns testes conferem textos).

## Regras

- Nunca versione `.env`, `.env.local` nem qualquer chave. Segredo só no `.env.local` e nas variáveis da Vercel.
- Nunca peça pra pessoa colar chave ou senha no chat: abra o `.env.local` pra ela ou use `vercel env add`.
- Migração nova **sempre no fim da fila**: arquivo novo em `supabase/migrations/` com data/hora maior que a
  última. Nunca edite uma migração que já foi aplicada no banco de alguém. Aplique com `supabase db push`.
- Tabela nova: ligue o RLS e escreva as políticas seguindo o padrão das migrações existentes (`eh_membro()`,
  `eh_admin()`); `tests/migracao.test.ts` confere que toda tabela tem RLS. Dê os `grant` pra `authenticated` e
  `service_role` (veja a última migração).
- Regra de negócio nova vai em `src/lib/regras/` como função pura, com teste em `tests/`.
- `SUPABASE_SERVICE_ROLE_KEY` e `src/lib/supabase/admin.ts` só em código de servidor (`"server-only"`).
- Datas sempre em UTC no banco (`timestamptz`); o fuso de cada webinar fica na agenda.
- `CRYPTO_KEY` não muda depois de usada (os cabeçalhos de webhook cifrados deixam de abrir).
- Se o repositório estiver ligado à Vercel, **push na `main` publica** o sistema na hora. Trabalhe em outra
  branch e só junte na `main` quando a pessoa aprovar.
- A sala e os webhooks atingem pessoas reais: pra testar, use um webinar de teste e o modo de teste do passo
  Pronto.
