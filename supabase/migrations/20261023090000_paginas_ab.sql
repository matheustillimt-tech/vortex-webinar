-- Editor de páginas (GrapesJS) e teste A/B.

-- 1) Páginas: além do projeto do GrapesJS (`componentes`, para reabrir no editor), guarda o resultado publicado
--    (`html`/`css`, gerados por `editor.getHtml()`/`getCss()` no salvar). A sala sanitiza o HTML no servidor antes
--    de mostrar; o limite de tamanho (300 KB de HTML, 100 KB de CSS, em bytes) é conferido também aqui.
--    `atualizado_por`: quem salvou por último (some se o usuário for removido).
alter table public.paginas
  add column html text not null default '' check (octet_length(html) <= 307200),
  add column css text not null default '' check (octet_length(css) <= 102400),
  add column atualizado_por uuid references public.usuarios(id) on delete set null;

-- 2) Sessões por teste A/B (métricas comparadas e "este teste já tem participantes").
create index if not exists sessoes_teste_ab on public.sessoes (teste_ab_id, entrou_em) where teste_ab_id is not null;

-- 3) Métricas comparadas do teste A/B: uma linha por variação, na `ordem` (A, B, C, D). Mesmas regras de
--    `metricas_webinar` (20261021150000_metricas_ajustes.sql): cohort de quem entrou em [p_de, p_ate), modo `teste`
--    fora, eventos e vendas das sessões do cohort sem corte de data adicional. A sessão é da variação pelo
--    `variacao_webinar_id` gravado na entrada pelo `/t/<slug>` (cai no `webinar_id` se vier nulo). Vendas contam só
--    as casadas com a sessão (`vendas.sessao_id`): venda sem sessão não tem como ser atribuída a uma variação.
--    `tempoMedioSeg`: média do `max_segundo` de quem acessou a sala.
create or replace function public.metricas_teste_ab(p_teste uuid, p_de timestamptz, p_ate timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with var as (
    select v.ordem, v.webinar_id, v.percentual, w.nome
    from public.testes_ab_variacoes v
    join public.webinars w on w.id = v.webinar_id
    where v.teste_id = p_teste
  ),
  sess as (
    select s.id, coalesce(s.variacao_webinar_id, s.webinar_id) as variacao, s.max_segundo
    from public.sessoes s
    where s.teste_ab_id = p_teste and s.modo <> 'teste' and s.entrou_em >= p_de and s.entrou_em < p_ate
  ),
  ev as (
    select s.variacao, e.sessao_id, e.tipo
    from public.eventos e
    join sess s on s.id = e.sessao_id
  ),
  funil as (
    select variacao,
           count(distinct sessao_id) filter (where tipo = 'acessou_sala') as acessou_sala,
           count(distinct sessao_id) filter (where tipo = 'min_15') as min_15,
           count(distinct sessao_id) filter (where tipo = 'pitch') as pitch,
           count(distinct sessao_id) filter (where tipo = 'oferta') as oferta,
           count(distinct sessao_id) filter (where tipo = 'clicou_oferta') as clicou_oferta,
           count(distinct sessao_id) filter (where tipo = 'comprou') as comprou
    from ev
    group by variacao
  ),
  cadastros as (
    select variacao, count(*) as n from sess group by variacao
  ),
  tempo as (
    select s.variacao, round(avg(s.max_segundo)) as media
    from sess s
    where exists (select 1 from ev e where e.sessao_id = s.id and e.tipo = 'acessou_sala')
    group by s.variacao
  ),
  venda as (
    select s.variacao, count(*) as n, sum(ve.valor_centavos) as total
    from public.vendas ve
    join sess s on s.id = ve.sessao_id
    group by s.variacao
  )
  select jsonb_build_object(
    'variacoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordem', var.ordem,
        'webinarId', var.webinar_id,
        'nome', var.nome,
        'percentual', var.percentual,
        'cadastros', coalesce(c.n, 0),
        'acessouSala', coalesce(f.acessou_sala, 0),
        'min15', coalesce(f.min_15, 0),
        'pitch', coalesce(f.pitch, 0),
        'oferta', coalesce(f.oferta, 0),
        'clicouOferta', coalesce(f.clicou_oferta, 0),
        'comprou', coalesce(f.comprou, 0),
        'vendas', coalesce(vd.n, 0),
        'faturamentoCentavos', coalesce(vd.total, 0),
        'tempoMedioSeg', coalesce(t.media, 0)
      ) order by var.ordem)
      from var
      left join cadastros c on c.variacao = var.webinar_id
      left join funil f on f.variacao = var.webinar_id
      left join tempo t on t.variacao = var.webinar_id
      left join venda vd on vd.variacao = var.webinar_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.metricas_teste_ab(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metricas_teste_ab(uuid, timestamptz, timestamptz) to authenticated, service_role;
