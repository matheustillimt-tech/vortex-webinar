-- Vórtex Webinar: endurece as regras de acesso (RLS) do esquema inicial.
-- Não editar 20261019120000_inicial.sql (já aplicada em produção): tudo daqui pra frente é migração nova.

-- 1) Atendente deixa de escrever direto: mensagens e sessões passam a ser escritas pelo servidor com a
--    service role (que ignora RLS). Atendente mantém só a leitura (equipe_le).
drop policy if exists equipe_escreve_mensagens on public.mensagens_suporte;
drop policy if exists equipe_atualiza_mensagens on public.mensagens_suporte;
drop policy if exists equipe_atualiza_sessoes on public.sessoes;

-- 2) eh_membro()/eh_admin() com search_path travado (''), qualificando tudo por dentro.
create or replace function public.eh_membro() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo)
$$;

create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo and papel = 'admin')
$$;

-- 3) Toda política que chama eh_admin()/eh_membro() passa a chamar como `(select ...)`, pra o Postgres
--    avaliar a função uma vez por statement (e não uma vez por linha). Mesmo nome, mesmo comando, mesma
--    tabela, mesma semântica — só muda a forma da chamada.
do $$
declare
  pol record;
  usa_select boolean;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%eh_admin%' or coalesce(qual, '') like '%eh_membro%'
        or coalesce(with_check, '') like '%eh_admin%' or coalesce(with_check, '') like '%eh_membro%')
  loop
    usa_select := coalesce(pol.qual, '') like '%(select%eh_%' or coalesce(pol.with_check, '') like '%(select%eh_%';
    if usa_select then
      continue;
    end if;

    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    execute format(
      'create policy %I on %I.%I as %s for %s to %s %s %s',
      pol.policyname,
      pol.schemaname,
      pol.tablename,
      case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      pol.cmd,
      array_to_string(pol.roles, ', '),
      case when pol.qual is null then '' else
        'using (' || regexp_replace(
          regexp_replace(pol.qual, '(public\.)?eh_admin\(\)', '(select public.eh_admin())', 'g'),
          '(public\.)?eh_membro\(\)', '(select public.eh_membro())', 'g'
        ) || ')'
      end,
      case when pol.with_check is null then '' else
        'with check (' || regexp_replace(
          regexp_replace(pol.with_check, '(public\.)?eh_admin\(\)', '(select public.eh_admin())', 'g'),
          '(public\.)?eh_membro\(\)', '(select public.eh_membro())', 'g'
        ) || ')'
      end
    );
  end loop;
end $$;
