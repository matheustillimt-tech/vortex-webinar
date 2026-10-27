# Vórtex Webinar

Sistema de webinar automático (perpétuo): você grava a aula uma vez e ela passa como se fosse ao vivo, nos dias e
horários que você escolher, com chat, oferta, vendas e atendimento acontecendo na sala.

## O que ele faz

- **Webinar perpétuo**: o vídeo gravado roda como transmissão ao vivo. Quem entra atrasado cai no ponto certo do
  vídeo, sem botão de voltar nem de adiantar, com o selo **"Ao Vivo"** e um contador de pessoas assistindo.
- **Agenda que se repete**: sessão única, todo dia, de segunda a sexta, toda semana ou **just in time** (a pessoa
  escolhe um dos próximos horários e a sessão começa minutos depois). Fuso horário por webinar.
- **Telas da jornada**: página de inscrição, confirmação (com botão de salvar na agenda), sala de espera com
  contagem regressiva, a sala e a tela de fim. Também dá pra montar páginas próprias de inscrição e de espera
  num **editor visual** (arrasta e solta).
- **Chat programado pelo segundo do vídeo**: mensagens que aparecem em momentos certos da aula. Você cadastra uma
  a uma, importa de uma **planilha** (.xlsx) ou pede pra **IA gerar** a partir da transcrição do vídeo.
- **Vendas simuladas**: avisos de "Fulano acabou de comprar" no chat, também pelo segundo do vídeo.
- **Oferta na hora certa**: a aba de oferta (com banner, preço "de/por", contagem e botão de compra) aparece no
  momento do vídeo que você marcar. Também tem tarjas de aviso, barra de vagas e sorteio.
- **Atendimento ao vivo**: a pessoa fala com a equipe pela aba **Suporte** da sala, e a equipe responde pela
  **Sala de Atendimento** do painel, em tempo real.
- **Agente de IA**: responde as dúvidas na aba Suporte com base nas instruções, produtos e perguntas frequentes
  que você escreve. Dá pra testar antes de ligar.
- **Métricas**: funil (inscritos, entraram, chegaram na oferta, clicaram, compraram), retenção minuto a minuto,
  ao vivo × replay, dispositivos, países, faturamento, e um **painel ao vivo** com mapa de quem está assistindo
  agora. Exportação em planilha.
- **Integrações**:
  - **webhooks** (avisos automáticos pra outro sistema seu, como CRM ou automação de WhatsApp) quando alguém se
    inscreve, entra, fica até um certo minuto, sai antes, vê a oferta, clica ou não vê a oferta;
  - **pixels** da Meta (Facebook/Instagram), do TikTok e o Google Tag Manager, além de um script seu;
  - **prévia do link** no WhatsApp e nas redes (imagem, título e descrição);
  - **vendas de verdade por webhook de checkout**: Kiwify, Hotmart, Eduzz, Hubla, TheMembers e o
    [Vórtex Pay](https://github.com/matheustillimt-tech/vortex-pay) (checkout aberto do Grupo Vórtex). A venda
    entra nas métricas de quem comprou;
  - **MCP**: conecta o Claude (Claude Code ou Claude Desktop) pra configurar webinars, responder participantes e
    analisar métricas conversando.
- **Biblioteca de vídeos** no Bunny Stream (envio direto do painel) ou por link externo (YouTube, Vimeo, MP4).
- **Teste A/B**: um link só que divide o público entre dois ou mais webinars e compara os resultados.
- **Equipe**: administradores e atendentes, com **histórico de ações** (quem mudou o quê e quando).

## Como funciona

Você e a sua equipe usam um **painel** na internet (feito em Next.js e publicado na Vercel). O público entra por
um **segundo endereço**, o da sala (ex.: `aula.seu-dominio.com.br`), servido pelo mesmo sistema. Tudo que você
cadastra fica num banco de dados no **Supabase**. Os vídeos ficam no **Bunny Stream** (ou num link seu). A cada
minuto, um **agendador** (cron) chama o sistema, que envia os webhooks, manda os e-mails do just in time e fecha
as sessões que terminaram.

## Com o que é feito

- **Next.js 15 + React 19 + TypeScript** (o painel, a sala e as rotas da API)
- **Tailwind CSS 4** (o visual)
- **Supabase** (banco de dados Postgres, login da equipe, tempo real do atendimento e a pasta de imagens `midias`)
- **Bunny Stream** (vídeos), **GrapesJS** (editor de páginas), **hls.js** (player), **Leaflet** (mapa)
- **OpenRouter** e **ElevenLabs** (IA, opcionais), **Resend** (e-mails, opcional)
- **Vercel** (onde tudo fica no ar, com o agendador de 1 em 1 minuto)
- **Vitest** (testes automáticos)

## De quais contas você precisa

| Conta | Pra quê | Tem plano grátis? |
|---|---|---|
| GitHub | guardar a sua cópia do código | sim |
| Supabase | banco de dados, login e imagens | sim (bom pra começar) |
| Vercel | deixar o painel e a sala no ar | sim, mas o plano grátis é pra uso pessoal e o agendador de 1 em 1 minuto só vem no **Pro** (US$ 20/mês). No grátis, use o agendador do Supabase (explicado no INSTALACAO.md) |
| Um domínio (opcional) | endereços bonitos pro painel e pra sala | pago à parte; sem domínio, dá pra usar dois endereços `.vercel.app` |
| Bunny (bunny.net) | hospedar e transmitir os vídeos | não tem plano grátis: cobra por uso (armazenamento e tráfego). Opcional se você usar link do YouTube/Vimeo/MP4 |
| OpenRouter + ElevenLabs | IA: gerar o chat e o agente que responde na sala | pagos por uso. Opcionais |
| Resend | e-mails do just in time (confirmação e lembretes) | sim (até um limite de envios por mês). Opcional |

Opcional também: conta na Kiwify, Hotmart, Eduzz, Hubla, TheMembers ou o Vórtex Pay, se quiser registrar as vendas
reais.

## Instalar com o Claude Code

Abra o Claude Code na aba **Code**, numa **pasta vazia**, e cole este prompt. Ele confere o seu computador, baixa
o código e instala tudo com você, um passo de cada vez. Ele nunca vai pedir pra você colar senha ou chave no chat.

```text
Você vai me ajudar a instalar o Vórtex Webinar, um sistema de webinar automático (vídeo gravado que passa como se
fosse ao vivo), código aberto em https://github.com/matheustillimt-tech/vortex-webinar. Eu não sou programador:
explique cada passo em português simples, um de cada vez, e espere eu dizer "pronto" antes de seguir.

REGRAS QUE VOCÊ NUNCA QUEBRA
- Nunca me peça pra colar chave, senha ou token aqui no chat. Quando precisar de um segredo:
  (a) abra o arquivo .env.local pra mim (com o comando `open -e .env.local` no Mac ou `notepad .env.local` no
      Windows) e me diga em qual linha colar, ou
  (b) rode no MEU terminal `vercel env add NOME production` ou `supabase secrets set ...`, que pedem o valor lá,
      sem passar pelo chat.
- Nunca suba o arquivo .env.local pro GitHub.
- Antes de qualquer comando que publica algo ou mexe no banco (supabase db push, vercel --prod), me diga o que vai
  acontecer e espere meu OK.
- Se algum comando der erro, leia a mensagem, me explique em uma frase e proponha a correção.

PASSO 1 — Conferir o computador
Confira se tenho Node.js 20 ou mais novo, Git, a CLI do Supabase e a CLI da Vercel (`node -v`, `git --version`,
`supabase --version`, `vercel --version`). Instale o que faltar, explicando antes:
- Mac: Homebrew (`brew install node git supabase/tap/supabase`) e `npm i -g vercel`.
- Windows: `winget install OpenJS.NodeJS.LTS Git.Git`, `npm i -g vercel` e a CLI do Supabase pelo Scoop
  (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` e `scoop install supabase`).

PASSO 2 — Baixar o código
Rode `git clone https://github.com/matheustillimt-tech/vortex-webinar.git .` (com o ponto, pra baixar nesta
pasta), depois `npm install`. Copie `.env.example` para `.env.local`.

PASSO 3 — Contas (uma de cada vez, esperando eu terminar cada uma)
1. GitHub (github.com): pra guardar a minha cópia do código. Me ajude a criar um repositório PRIVADO meu e a
   enviar o código pra ele (`git remote set-url origin ...` e `git push -u origin main`).
2. Supabase (supabase.com, plano grátis serve pra começar): crie um projeto novo (região São Paulo). Me mostre
   onde ficam, em Project Settings > API, a URL do projeto e as chaves anon e service_role, e me faça colar no
   .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
   IMPORTANTE: em Authentication > Sign In / Providers > Email, desligue "Allow new users to sign up" (só o
   administrador cadastra gente nova, pela tela Usuários do painel).
3. Vercel (vercel.com): onde o painel e a sala ficam no ar. Entre com a conta do GitHub. Explique que o
   agendador de 1 em 1 minuto do arquivo vercel.json só funciona no plano Pro; no plano grátis vamos usar o
   agendador do Supabase (passo 8).
4. Bunny (bunny.net), se eu quiser enviar os vídeos pelo painel: crie uma biblioteca no Bunny Stream, ligue
   "MP4 Fallback" em Encoding (a IA precisa dele pra transcrever) e me faça colar no .env.local o Library ID, a
   API Key e o CDN Hostname (BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_STREAM_CDN_HOST). Se eu
   preferir usar só link do YouTube/Vimeo, pule.
5. Opcionais, só se eu quiser agora: OpenRouter + ElevenLabs (IA) e Resend (e-mails do just in time). Me
   explique o que cada um faz e me faça colar as chaves no .env.local (ver a lista no .env.example).

PASSO 4 — Gerar as chaves internas
Gere CRYPTO_KEY e SALA_TOKEN_SECRET com
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (um valor diferente pra cada),
CRON_SECRET com `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` e, se eu usar o Bunny,
BUNNY_WEBHOOK_TOKEN do mesmo jeito que o CRON_SECRET. Grave direto no .env.local, sem mostrar os valores no chat.

PASSO 5 — Criar o banco
Rode `supabase login`, depois `supabase link --project-ref <id do projeto>` (o id é o pedaço da URL antes de
.supabase.co) e, com o meu OK, `supabase db push`. Isso cria todas as tabelas, as regras de acesso, o tempo real
do atendimento e a pasta de imagens `midias`. Confira se terminou sem erro.

PASSO 6 — Os dois endereços
O sistema usa dois endereços: um pro painel (equipe) e outro pra sala (público). Me pergunte se tenho domínio.
- Com domínio: painel em algo como painel.meudominio.com.br e sala em aula.meudominio.com.br.
- Sem domínio: dois endereços da Vercel no mesmo projeto, como meu-webinar.vercel.app (painel) e
  meu-webinar-aula.vercel.app (sala).
Grave em NEXT_PUBLIC_PAINEL_URL e NEXT_PUBLIC_SALA_URL no .env.local (com https://, sem / no fim).

PASSO 7 — Publicar na Vercel
Rode `vercel link` (projeto novo, ligado ao meu repositório). Cadastre cada variável preenchida do .env.local na
Vercel com `vercel env add NOME production` (o valor é digitado no terminal, não no chat). Se eu estiver no plano
grátis, apague o bloco "crons" do vercel.json antes de publicar (senão a Vercel recusa) e faça commit. Publique
com `vercel --prod`. Depois, em Settings > Domains do projeto na Vercel, me ajude a adicionar os DOIS endereços do
passo 6 (com domínio próprio, me diga quais registros de DNS criar). No Supabase, em Authentication > URL
Configuration, coloque o endereço do painel em Site URL. Publique de novo se mudou alguma variável.

PASSO 8 — Agendador (só se eu estiver no plano grátis da Vercel)
No Supabase, em Database > Extensions, ligue pg_cron e pg_net. Depois me passe o SQL do INSTALACAO.md
(seção "Agendador pelo Supabase") pra eu colar no SQL Editor do Supabase, trocando os valores lá mesmo.

PASSO 9 — Primeiro administrador
No Supabase, em Authentication > Users > Add user, eu crio o meu usuário (e-mail e senha, marcando
"Auto Confirm User"). Depois me passe pra colar no SQL Editor (eu troco nome e e-mail lá):
  insert into public.usuarios (auth_id, nome, email, papel)
  select id, 'MEU NOME', email, 'admin' from auth.users where email = 'MEU-EMAIL';
Abra o endereço do painel e me ajude a entrar.

PASSO 10 — Integrações
Se eu usar o Bunny: no painel do Bunny, na biblioteca, em Webhook, me ajude a colocar
<endereço do painel>/api/bunny/webhook/<BUNNY_WEBHOOK_TOKEN> (o valor eu copio do .env.local, sem colar aqui).
Checkout, webhooks, pixels e MCP ficam em Configurações no painel: me mostre onde, se eu quiser ligar agora.

PASSO 11 — Checklist
Faça comigo o checklist do INSTALACAO.md: cadastrar um vídeo, criar um webinar de teste começando em poucos
minutos, abrir o link da sala numa janela anônima, me inscrever, ver a sala abrir, mandar uma mensagem na aba
Suporte e responder pela Sala de Atendimento. No fim, me diga o que ficou pronto e o que eu ainda preciso fazer.
```

O mesmo texto está em [PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

## Instalar na mão

O passo a passo completo, com todas as variáveis, está em **[INSTALACAO.md](INSTALACAO.md)**.

## Estrutura de pastas (resumo)

```
app/
  (painel)/        telas do painel: dashboard, webinars (assistente de 9 passos), teste A/B, páginas, vídeos,
                   salas de atendimento, histórico, usuários, configurações (checkouts, webhooks, pixels, MCP)
  (editor)/        editor visual de páginas (GrapesJS)
  s/               a sala do público: inscrição, espera, sala, páginas montadas no editor, link do teste A/B
  api/             rotas do servidor: agendador (cron), sala, checkouts, webhook do Bunny, exportações, MCP
  login/           tela de entrada da equipe
src/lib/
  regras/          regras de negócio (funções puras, com teste)
  sala/            dados e sessão da sala do público
  mcp/             servidor MCP e as ferramentas
  bunny/ ia/ email/  conversa com Bunny, OpenRouter/ElevenLabs e Resend
  supabase/        clientes do banco
supabase/
  migrations/      o banco inteiro, em ordem
tests/             testes automáticos (Vitest)
middleware.ts      separa o painel da sala pelo endereço e exige login no painel
vercel.json        o agendador de 1 em 1 minuto
```

## Licença

MIT. Veja [LICENSE](LICENSE). Você pode usar, mudar e vender a sua versão.

---

Feito pelo Grupo Vórtex · entregue na Plataforma Vórtex IA
