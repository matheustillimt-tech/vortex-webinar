# Instalação do Vórtex Webinar (passo a passo manual)

Este guia é pra quem quer instalar sem o Claude Code. Se preferir que o Claude faça com você, use o prompt do
[PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

Tempo estimado: 1 a 2 horas na primeira vez.

---

## 1. Contas que você vai criar

1. **GitHub** (github.com): guarda a sua cópia do código. Grátis.
2. **Supabase** (supabase.com): banco de dados, login da equipe, tempo real e imagens. O plano grátis serve pra
   começar.
3. **Vercel** (vercel.com): deixa o painel e a sala no ar. Entre com a conta do GitHub.
   - O sistema precisa de um **agendador que roda a cada 1 minuto** (envia webhooks e e-mails e fecha as sessões).
     Na Vercel isso só existe no plano **Pro** (US$ 20/mês, que também é o plano certo pra uso comercial). No
     plano grátis (Hobby), a Vercel só aceita agendador uma vez por dia: aí você usa o agendador do próprio
     Supabase (passo 7.2).
4. **Bunny** (bunny.net), recomendado: hospeda e transmite os vídeos, com envio direto pelo painel. Cobra por uso
   (armazenamento e tráfego). Sem ele, você usa link do YouTube, do Vimeo ou de um arquivo MP4/HLS seu.
5. Opcionais:
   - **OpenRouter** (openrouter.ai) e **ElevenLabs** (elevenlabs.io): IA que gera o chat a partir da transcrição
     do vídeo e o agente que responde na aba Suporte. Pagos por uso.
   - **Resend** (resend.com): e-mails do just in time (inscrição confirmada, lembrete, "estamos começando"). Tem
     plano grátis com limite mensal. Precisa de um domínio seu verificado lá.
   - Um **domínio** (ex.: `seu-dominio.com.br`) pra ter endereços bonitos. Sem domínio, dá pra usar dois
     endereços `.vercel.app`.

## 2. Programas no seu computador

- **Node.js 20 ou mais novo** (nodejs.org) — roda o sistema.
- **Git** (git-scm.com) — baixa o código.
- **CLI do Supabase** — comandos do banco. Mac: `brew install supabase/tap/supabase`. Windows: pelo Scoop
  (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` e `scoop install supabase`).
- **CLI da Vercel** — `npm i -g vercel`.

> "CLI" é um programa que você usa digitando comandos no terminal.

## 3. Baixar o código

```bash
git clone https://github.com/matheustillimt-tech/vortex-webinar.git
cd vortex-webinar
npm install
cp .env.example .env.local
```

O arquivo `.env.local` guarda as suas chaves. Ele **nunca** vai pro GitHub (o `.gitignore` já bloqueia).

Recomendado: crie um repositório **privado** seu no GitHub e envie o código pra lá
(`git remote set-url origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git` e `git push -u origin main`).
É desse repositório que a Vercel vai publicar.

## 4. Criar o projeto no Supabase e aplicar o banco

1. No Supabase, clique em **New project**. Escolha um nome, uma senha forte pro banco (guarde) e a região
   **South America (São Paulo)**.
2. Em **Project Settings > API**, copie pro `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta!)
3. **Desligue o cadastro aberto**: em **Authentication > Sign In / Providers > Email**, desligue
   **Allow new users to sign up**. Gente nova da equipe entra só pela tela **Usuários** do painel, criada por um
   administrador. (O público da sala não usa login do Supabase: ele só se inscreve com nome, e-mail e telefone.)
4. No terminal, dentro da pasta do projeto:

```bash
supabase login
supabase link --project-ref SEU-PROJETO   # o pedaço da Project URL antes de .supabase.co; pede a senha do banco
supabase db push                          # cria as tabelas, as regras de acesso, o tempo real e a pasta "midias"
```

O `db push` aplica as migrações da pasta `supabase/migrations` em ordem. Este sistema não usa Edge Functions nem
`supabase functions deploy`, e não guarda nada com `supabase secrets set`: todas as chaves ficam na Vercel.

## 5. Todas as variáveis de ambiente

| Nome | Pra que serve | Onde pegar | Obrigatória? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | endereço do seu banco | Supabase > Project Settings > API > Project URL | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública do banco (login da equipe e telas) | Supabase > Project Settings > API > anon public | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secreta do servidor (sala, agendador, webhooks, MCP) | Supabase > Project Settings > API > service_role | sim |
| `CRYPTO_KEY` | embaralha no banco os cabeçalhos secretos dos webhooks | gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | sim |
| `SALA_TOKEN_SECRET` | assina o acesso de cada pessoa à sala (ninguém consegue forjar) | gere com o mesmo comando da `CRYPTO_KEY` (valor diferente) | sim |
| `CRON_SECRET` | senha que o agendador manda pra rodar o sistema | gere: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | sim |
| `NEXT_PUBLIC_PAINEL_URL` | endereço do painel, com `https://` e sem `/` no fim (vai nos links de webhook e do MCP) | o seu domínio do painel ou o `.vercel.app` (passo 6) | sim |
| `NEXT_PUBLIC_SALA_URL` | endereço da sala (o link que vai pro público). Tem que ser **diferente** do painel | o seu domínio da sala ou um segundo `.vercel.app` (passo 6) | sim |
| `NEXT_PUBLIC_NOME_SISTEMA` | nome no logo do painel e na aba do navegador | escolha (ex.: "Webinars da Minha Empresa") | não (padrão: "Vórtex Webinar") |
| `BUNNY_STREAM_LIBRARY_ID` | qual biblioteca do Bunny guarda os vídeos | Bunny > Stream > sua biblioteca > API > Video Library ID | não (sem as 3 do Bunny, o envio de vídeo fica desligado) |
| `BUNNY_STREAM_API_KEY` | chave da biblioteca do Bunny | Bunny > Stream > sua biblioteca > API > API Key | não |
| `BUNNY_STREAM_CDN_HOST` | endereço de entrega dos vídeos | Bunny > Stream > sua biblioteca > API > CDN Hostname (ex.: `vz-xxxxxxxx-xxx.b-cdn.net`) | não |
| `BUNNY_WEBHOOK_TOKEN` | palavra secreta do aviso "vídeo pronto" que o Bunny manda | gere com o comando do `CRON_SECRET` | não (sem ela, use "Atualizar status" no menu ⋮ do vídeo, na tela Vídeos) |
| `SALA_URL` | endereço mandado ao Bunny ao buscar a capa do vídeo | deixe vazio (usa o `NEXT_PUBLIC_SALA_URL`) | não |
| `OPENROUTER_API_KEY` | IA (gera o chat e responde como agente) | OpenRouter > Keys | não (sem ela, a IA fica desligada) |
| `OPENROUTER_TEXT_MODEL` | qual modelo de IA usar; vários separados por vírgula (o 1º é o principal, os outros reserva) | escolha em openrouter.ai/models (ex.: `anthropic/claude-sonnet-4.5`) | não (junto com a chave acima) |
| `ELEVENLABS_API_KEY` | transcreve o áudio do vídeo pra IA gerar o chat | ElevenLabs > API Keys | não (o agente funciona sem ela) |
| `RESEND_API_KEY` | envia os e-mails do just in time | Resend > API Keys | não (sem ela, os e-mails ficam desligados) |
| `EMAIL_FROM` | remetente dos e-mails, num domínio verificado no Resend | ex.: `aulas@seu-dominio.com.br` | não (junto com a chave acima) |

> Guarde a `CRYPTO_KEY`: se ela mudar, os cabeçalhos secretos dos webhooks já cadastrados deixam de abrir e
> precisam ser salvos de novo. Trocar o `SALA_TOKEN_SECRET` desloga da sala quem já estava inscrito.

As variáveis que começam com `NEXT_PUBLIC_` entram no sistema na hora da publicação: se mudar alguma depois,
**publique de novo** na Vercel.

Pra testar no seu computador antes de publicar: em `.env.local`, use `NEXT_PUBLIC_PAINEL_URL=http://localhost:3000`
e `NEXT_PUBLIC_SALA_URL=http://sala.localhost:3000`, rode `npm run dev` e abra http://localhost:3000 (painel). A sala
abre em http://sala.localhost:3000/nome-do-webinar.

## 6. Publicar na Vercel

1. Na Vercel, clique em **Add New > Project** e importe o seu repositório do GitHub.
2. Em **Environment Variables**, cadastre as variáveis da tabela acima.
3. **Plano grátis (Hobby)?** Antes de publicar, apague o bloco `"crons"` do arquivo `vercel.json` (deixe só
   `{ "regions": ["gru1"] }`), faça commit e push. Senão a Vercel recusa a publicação, porque o agendador de
   1 em 1 minuto é do plano Pro. Você liga o agendador pelo Supabase no passo 7.2.
4. Clique em **Deploy**.
5. **Os dois endereços.** Em **Settings > Domains** do projeto, adicione:
   - o endereço do **painel** (ex.: `painel.seu-dominio.com.br`) e
   - o endereço da **sala** (ex.: `aula.seu-dominio.com.br`).
   Com domínio próprio, a Vercel mostra os registros de DNS pra criar no lugar onde o seu domínio está registrado
   (Registro.br, Cloudflare, GoDaddy…). Sem domínio, adicione dois endereços `.vercel.app` livres (ex.:
   `meu-webinar.vercel.app` e `meu-webinar-aula.vercel.app`).
   O sistema reconhece a sala pelo endereço: tudo que chega pelo endereço do `NEXT_PUBLIC_SALA_URL` vira sala;
   o resto é painel.
6. Confira se `NEXT_PUBLIC_PAINEL_URL` e `NEXT_PUBLIC_SALA_URL` estão com esses endereços e publique de novo
   (**Deployments > Redeploy**).
7. No Supabase, em **Authentication > URL Configuration**, coloque o endereço do painel em **Site URL**.

Pela linha de comando dá pra fazer o mesmo: `vercel link`, `vercel env add NOME production` (pede o valor no
terminal), `vercel domains add ...` e `vercel --prod`.

## 7. O agendador (a cada 1 minuto)

Dois endereços fazem o trabalho de fundo e precisam ser chamados a cada minuto com o cabeçalho
`Authorization: Bearer <CRON_SECRET>`:

- `/api/cron/tick` — envia os webhooks das regras, manda os e-mails do just in time e fecha as sessões que
  terminaram (quem saiu antes, quem não viu a oferta).
- `/api/cron/ia` — avança a geração do chat por IA (só faz algo se a IA estiver ligada).

### 7.1 Vercel Pro

Nada a fazer: o `vercel.json` já traz os dois agendadores (`"schedule": "* * * * *"`) e a Vercel manda o
`CRON_SECRET` sozinha. Confira em **Settings > Cron Jobs**.

### 7.2 Plano grátis: agendador pelo Supabase

1. No Supabase, em **Database > Extensions**, ligue **pg_cron** e **pg_net**.
2. Abra o **SQL Editor** e rode o bloco abaixo, trocando os dois valores **ali mesmo** (o endereço do seu painel e
   o mesmo valor do `CRON_SECRET`). Eles ficam guardados no **Vault** do Supabase (cofre de segredos do banco), não
   no código:

```sql
-- 1) Guarda o endereço do painel e a senha do agendador no cofre (Vault).
select vault.create_secret('https://painel.seu-dominio.com.br', 'vortex_webinar_url');
select vault.create_secret('COLE-AQUI-O-CRON_SECRET', 'vortex_webinar_cron_secret');

-- 2) Chama o /api/cron/tick a cada minuto, lendo os dois valores do cofre.
select cron.schedule(
  'vortex-webinar-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_webinar_url') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_webinar_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- 3) Só se você ligou a IA: chama o /api/cron/ia a cada minuto.
select cron.schedule(
  'vortex-webinar-ia',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_webinar_url') || '/api/cron/ia',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_webinar_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

Pra conferir: `select * from cron.job_run_details order by start_time desc limit 5;`
Pra desligar: `select cron.unschedule('vortex-webinar-tick');` (e `'vortex-webinar-ia'`).

Outra opção grátis é um serviço de cron externo (ex.: cron-job.org) chamando os mesmos endereços a cada minuto,
com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

## 8. Criar o primeiro administrador

1. No Supabase, em **Authentication > Users > Add user > Create new user**, coloque o seu e-mail e uma senha e
   marque **Auto Confirm User**.
2. No **SQL Editor**, rode (com o seu nome e e-mail):

```sql
insert into public.usuarios (auth_id, nome, email, papel)
select id, 'Seu Nome', email, 'admin' from auth.users where email = 'voce@seu-dominio.com.br';
```

3. Abra o endereço do painel e entre com esse e-mail e senha. As próximas pessoas você cadastra na tela
   **Usuários**: **administrador** (mexe em tudo) ou **atendente** (só as Salas de Atendimento e o Dashboard).

## 9. Ligar as integrações

### Vídeos no Bunny (recomendado)

1. No Bunny, em **Stream**, crie uma biblioteca (região perto do seu público).
2. Na biblioteca, em **Encoding**, ligue **MP4 Fallback** (a IA usa o MP4 pra transcrever o vídeo).
3. Em **API**, copie o Library ID, a API Key e o CDN Hostname pras variáveis `BUNNY_STREAM_*`.
4. Em **Webhook**, coloque `https://painel.seu-dominio.com.br/api/bunny/webhook/<BUNNY_WEBHOOK_TOKEN>` (com o valor
   da variável no lugar). Assim o painel sabe na hora quando o vídeo terminou de processar.
5. No painel, em **Vídeos**, envie o primeiro vídeo. Também dá pra cadastrar um link externo (YouTube, Vimeo, MP4).

### Vendas reais (opcional)

Em **Configurações**, aba **Integrações nativas**, escolha a plataforma (Kiwify, Hotmart, Eduzz, Hubla,
TheMembers ou Vórtex Pay), cole o segredo/token que a plataforma mostra (a tela diz onde achar) e copie o
endereço de webhook de cada webinar. Cole esse endereço no evento de **compra aprovada** da plataforma. A venda
entra nas métricas de quem comprou (casando pelo e-mail ou telefone). O log de cada chamada fica na mesma tela.

Pro [Vórtex Pay](https://github.com/matheustillimt-tech/vortex-pay), use o endereço no webhook do produto, com o
mesmo token.

### Webhooks, pixels e prévia do link (opcional)

Em **Configurações**, aba **Integrações do webinar**, escolha o webinar:
- **WebHook**: regras que avisam outro sistema seu (CRM, automação de WhatsApp) quando alguém se inscreve, entra,
  fica até um minuto X, sai antes, chega na oferta, clica ou não vê a oferta. Cada regra tem "Enviar teste".
  Cada envio leva o cabeçalho `X-VortexWebinar-Disparo` (o mesmo id se a mesma tentativa chegar duas vezes).
- **Pixels**: Meta, TikTok, Google Tag Manager e um script seu.
- **WhatsApp**: imagem, título e descrição que aparecem quando o link é compartilhado.

### E-mails do just in time (opcional)

1. No Resend, verifique o seu domínio (ele mostra os registros de DNS) e crie uma API Key.
2. Preencha `RESEND_API_KEY` e `EMAIL_FROM` na Vercel e publique de novo.
3. No passo **Webinar** do assistente, na aba **Just in time**, edite os 3 e-mails (confirmação, lembrete e
   "estamos começando").

### IA (opcional)

Preencha `OPENROUTER_API_KEY`, `OPENROUTER_TEXT_MODEL` e (pra gerar chat) `ELEVENLABS_API_KEY` e publique de
novo. No webinar: passo **Chat > Gerar Chat com IA** e passo **Agente de IA**.

### MCP: operar pelo Claude (opcional)

Em **Configurações**, aba **Integrações MCP**, crie uma chave (`vw_...`) e siga o guia da tela pra conectar o Claude
Code ou o Claude Desktop no endereço `/api/mcp`. A chave aparece uma vez só: guarde num lugar seguro.

## 10. Checklist de teste

- [ ] Entrei no painel com o administrador.
- [ ] Em **Vídeos**, o vídeo enviado (ou o link) aparece como pronto.
- [ ] Criei um webinar, passei pelos 9 passos e marquei uma sessão única começando em poucos minutos.
- [ ] No passo **Pronto**, copiei o link da sala e abri numa janela anônima: caí no endereço da **sala** (não no
      login do painel), me inscrevi e vi a sala de espera.
- [ ] Na hora marcada, a sala abriu com o selo "Ao Vivo", o chat programado e (no momento certo) a oferta.
- [ ] Mandei uma mensagem na aba **Suporte** e respondi pela **Sala de Atendimento** do painel.
- [ ] Nas **Métricas** do webinar, o meu cadastro e o meu acesso aparecem.
- [ ] Com uma regra de webhook ligada, o envio aparece no log das integrações em até 1 minuto (prova que o
      agendador está rodando).

## 11. Problemas comuns

| O que acontece | O que fazer |
|---|---|
| A Vercel recusa a publicação falando de cron/"daily" | Você está no plano grátis: apague o bloco `"crons"` do `vercel.json` e use o passo 7.2. |
| O link da sala abre o login do painel | O endereço não bate com o `NEXT_PUBLIC_SALA_URL`. Confira a variável (com `https://`, sem `/` no fim), confira se o endereço está em Settings > Domains e publique de novo. |
| Painel e sala no mesmo endereço | Não funciona: a sala precisa de um endereço só dela (passo 6.5). |
| Erro "Variável de ambiente ausente" | Falta alguma variável obrigatória na Vercel (tabela do passo 5). Depois de cadastrar, publique de novo. |
| "CRYPTO_KEY precisa ter 32 bytes em base64" | Gere a chave de novo com o comando da tabela do passo 5. |
| Entro no painel, mas aparece "Seu acesso ainda não foi liberado" | O seu usuário não está na tabela `usuarios`. Rode o SQL do passo 8. |
| "permission denied" nas telas do painel | Rode `supabase db push` de novo: a última migração dá as permissões das tabelas. |
| Aparece "Envio desligado: falta configurar o Bunny Stream" | Faltam as 3 variáveis `BUNNY_STREAM_*` (depois de cadastrar, publique de novo). |
| O vídeo enviado fica "processando" pra sempre | Confira o webhook do Bunny (passo 9) e o `BUNNY_WEBHOOK_TOKEN`, ou clique em "Atualizar status" no menu ⋮ do vídeo. |
| "Gerar com IA" falha | Confira as variáveis da IA e se o **MP4 Fallback** está ligado na biblioteca do Bunny. Com link externo, só funciona se for um arquivo `.mp4`. |
| Webhooks e e-mails não saem | O agendador não está rodando. Confira o passo 7 e se o `CRON_SECRET` é o mesmo na Vercel e no agendador (resposta 401 = senha diferente). |
| E-mails não chegam | Confira se o domínio do `EMAIL_FROM` está verificado no Resend. |
| Alguém se cadastrou sozinho no login do painel | Desligue **Allow new users to sign up** (passo 4.3) e apague o usuário em Authentication > Users. Sem estar na tabela `usuarios`, ele não vê nada. |
| A Vercel reclama do tempo máximo da função `/api/cron/ia` | Em `app/api/cron/ia/route.ts`, baixe `maxDuration` de 300 para 60. |
