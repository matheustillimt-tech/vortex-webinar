# Prompt de instalação (Claude Code)

Abra o **Claude Code** na aba **Code**, numa **pasta vazia** do seu computador, e cole o texto abaixo inteiro.
O Claude vai instalar o Vórtex Webinar junto com você, um passo de cada vez. Ele nunca vai pedir pra você colar
senha ou chave no chat: você cola direto no arquivo `.env.local` (ele abre o arquivo pra você) ou digita no
terminal quando a Vercel pedir.

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

Se preferir fazer sem o Claude, siga o [INSTALACAO.md](INSTALACAO.md).
