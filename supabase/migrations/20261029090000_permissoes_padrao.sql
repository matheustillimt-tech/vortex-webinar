-- Permissões das tabelas para a API do Supabase, escritas por extenso.
-- Projetos do Supabase costumam liberar sozinhos as tabelas novas do esquema `public` para os papéis da API
-- ("expor tabelas automaticamente"). Se o seu projeto foi criado com essa opção desligada, sem estas linhas o
-- painel recebe "permission denied". Num projeto que já libera, nada muda. Quem decide o que cada pessoa vê
-- continua sendo o RLS (ligado em todas as tabelas): `authenticated` só alcança o que as políticas permitem e o
-- `anon` (visitante sem login) não recebe nada, porque o sistema nunca lê tabela sem login.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
