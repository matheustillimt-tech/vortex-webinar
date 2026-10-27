-- Ajustes de `metricas_webinar`/`dashboard_geral` (20261021120000_metricas.sql: migração já
-- aplicada não se edita, a correção vem num arquivo novo). Três correções, mesmo corpo fora isso:
--   1. Retenção: o limite superior (`p_ate`) é EXCLUSIVO (começo do dia seguinte ao período); comparar
--      `data <= (p_ate at time zone 'America/Sao_Paulo')::date` incluía esse dia seguinte inteiro na soma.
--      Troca pra `<` (mesma regra de bordas do resto da função).
--   2. Eventos contados pelo cohort da sessão (quem entrou no período), sem o corte adicional
--      `e.criado_em < p_ate`: um evento de uma sessão que entrou dentro do período mas aconteceu depois de
--      `p_ate` (ex.: comprou um dia depois) estava sendo descartado do funil/eventos por engano.
--   3. Índices que faltavam pras consultas por data: `sessoes (entrou_em)` e `eventos (criado_em)`.

create index if not exists sessoes_entrou_em on public.sessoes (entrou_em);
create index if not exists eventos_criado_em on public.eventos (criado_em);

create or replace function public.metricas_webinar(p_webinar uuid, p_de timestamptz, p_ate timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with sess as (
    select * from public.sessoes
    where webinar_id = p_webinar and modo <> 'teste' and entrou_em >= p_de and entrou_em < p_ate
  ),
  ev as (
    select e.* from public.eventos e
    join sess s on s.id = e.sessao_id
    where e.webinar_id = p_webinar
  ),
  venda as (
    select * from public.vendas
    where webinar_id = p_webinar and created_at >= p_de and created_at < p_ate
  ),
  acessaram as (
    select s.* from sess s where exists (select 1 from ev e where e.sessao_id = s.id and e.tipo = 'acessou_sala')
  )
  select jsonb_build_object(
    'cadastros', (select count(*) from sess),
    'eventos', (
      select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb)
      from (select tipo, count(*) as n from ev group by tipo) t
    ),
    'porDia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'aoVivo', ao_vivo, 'replay', replay) order by dia), '[]'::jsonb)
      from (
        select (entrou_em at time zone 'America/Sao_Paulo')::date as dia,
               count(*) filter (where modo = 'ao_vivo') as ao_vivo,
               count(*) filter (where modo = 'replay') as replay
        from sess
        group by 1
      ) t
    ),
    'dispositivos', jsonb_build_object(
      'desktop', (select count(*) from sess where dispositivo = 'desktop'),
      'mobile', (select count(*) from sess where dispositivo = 'mobile')
    ),
    'paises', (
      select coalesce(jsonb_agg(jsonb_build_object('pais', pais, 'total', total)), '[]'::jsonb)
      from (
        select pais, count(*) as total from sess where pais is not null group by pais order by total desc limit 10
      ) t
    ),
    'retencao', (
      select coalesce(jsonb_agg(jsonb_build_object('minuto', minuto, 'visualizacoes', visualizacoes) order by minuto), '[]'::jsonb)
      from (
        select minuto, sum(visualizacoes) as visualizacoes
        from public.retencao
        where webinar_id = p_webinar and data >= (p_de at time zone 'America/Sao_Paulo')::date and data < (p_ate at time zone 'America/Sao_Paulo')::date
        group by minuto
      ) t
    ),
    'vendas', jsonb_build_object(
      'total', (select count(*) from venda),
      'faturamentoCentavos', (select coalesce(sum(valor_centavos), 0) from venda)
    ),
    'tempoMedioSeg', (select coalesce(round(avg(max_segundo)), 0) from acessaram)
  );
$$;

revoke all on function public.metricas_webinar(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metricas_webinar(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.dashboard_geral(p_de timestamptz, p_ate timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with sess as (
    select * from public.sessoes where modo <> 'teste' and entrou_em >= p_de and entrou_em < p_ate
  ),
  ev as (
    select e.* from public.eventos e
    join sess s on s.id = e.sessao_id
  ),
  venda as (
    select * from public.vendas where created_at >= p_de and created_at < p_ate
  ),
  acessaram as (
    select s.* from sess s where exists (select 1 from ev e where e.sessao_id = s.id and e.tipo = 'acessou_sala')
  )
  select jsonb_build_object(
    'cadastros', (select count(*) from sess),
    'eventos', (
      select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb)
      from (select tipo, count(*) as n from ev group by tipo) t
    ),
    'porDia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'aoVivo', ao_vivo, 'replay', replay) order by dia), '[]'::jsonb)
      from (
        select (entrou_em at time zone 'America/Sao_Paulo')::date as dia,
               count(*) filter (where modo = 'ao_vivo') as ao_vivo,
               count(*) filter (where modo = 'replay') as replay
        from sess
        group by 1
      ) t
    ),
    'dispositivos', jsonb_build_object(
      'desktop', (select count(*) from sess where dispositivo = 'desktop'),
      'mobile', (select count(*) from sess where dispositivo = 'mobile')
    ),
    'paises', (
      select coalesce(jsonb_agg(jsonb_build_object('pais', pais, 'total', total)), '[]'::jsonb)
      from (
        select pais, count(*) as total from sess where pais is not null group by pais order by total desc limit 10
      ) t
    ),
    'retencao', (
      select coalesce(jsonb_agg(jsonb_build_object('minuto', minuto, 'visualizacoes', visualizacoes) order by minuto), '[]'::jsonb)
      from (
        select minuto, sum(visualizacoes) as visualizacoes
        from public.retencao
        where data >= (p_de at time zone 'America/Sao_Paulo')::date and data < (p_ate at time zone 'America/Sao_Paulo')::date
        group by minuto
      ) t
    ),
    'vendas', jsonb_build_object(
      'total', (select count(*) from venda),
      'faturamentoCentavos', (select coalesce(sum(valor_centavos), 0) from venda)
    ),
    'tempoMedioSeg', (select coalesce(round(avg(max_segundo)), 0) from acessaram),
    'porWebinar', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'nome', w.nome,
        'cadastros', coalesce(c.cadastros, 0),
        'acessos', coalesce(a.acessos, 0),
        'vendas', coalesce(v.n, 0),
        'faturamentoCentavos', coalesce(v.total, 0)
      ) order by w.nome), '[]'::jsonb)
      from public.webinars w
      left join (select webinar_id, count(*) as cadastros from sess group by webinar_id) c on c.webinar_id = w.id
      left join (select webinar_id, count(*) as acessos from acessaram group by webinar_id) a on a.webinar_id = w.id
      left join (select webinar_id, count(*) as n, sum(valor_centavos) as total from venda group by webinar_id) v on v.webinar_id = w.id
      where exists (select 1 from sess s where s.webinar_id = w.id) or exists (select 1 from venda ve where ve.webinar_id = w.id)
    )
  );
$$;

revoke all on function public.dashboard_geral(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_geral(timestamptz, timestamptz) to authenticated, service_role;
