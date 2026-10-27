import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

// Mesmo prelúdio de tests/migracao.test.ts (schemas `auth`/`realtime` simulados); arquivo próprio para as funções
// de métricas não inflar aquele arquivo.
const PRELUDIO = `
  create role authenticated; create role anon; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create publication supabase_realtime;
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text not null, extension text not null default 'presence');
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
`;

let db: PGlite;
let webinarId: string;
let outroWebinarId: string;

async function novaSessao(
  webinar: string,
  opts: { modo?: string; dispositivo?: string; pais?: string; entrouEm?: string; maxSegundo?: number } = {},
): Promise<string> {
  const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${webinar}', 'X') returning id`);
  const { rows: [s] } = await db.query<{ id: string }>(
    `insert into sessoes (participante_id, webinar_id, inicio_sessao, entrou_em, modo, dispositivo, pais, max_segundo)
     values ('${p.id}', '${webinar}', now(), ${opts.entrouEm ?? "now()"}, '${opts.modo ?? "ao_vivo"}', ${opts.dispositivo ? `'${opts.dispositivo}'` : "null"}, ${opts.pais ? `'${opts.pais}'` : "null"}, ${opts.maxSegundo ?? 0})
     returning id`,
  );
  return s.id;
}

async function evento(sessao: string, webinar: string, tipo: string, criadoEm = "now()"): Promise<void> {
  await db.exec(`insert into eventos (sessao_id, webinar_id, tipo, criado_em) values ('${sessao}', '${webinar}', '${tipo}', ${criadoEm})`);
}

async function venda(webinar: string, centavos: number, idTransacao: string, createdEm = "now()"): Promise<void> {
  await db.exec(
    `insert into vendas (webinar_id, plataforma, id_transacao, valor_centavos, bruto, created_at)
     values ('${webinar}', 'hotmart', '${idTransacao}', ${centavos}, '{}', ${createdEm})`,
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRELUDIO);
  const dirMigracoes = path.join(__dirname, "../supabase/migrations");
  const arquivos = readdirSync(dirMigracoes).filter((f) => f.endsWith(".sql")).sort();
  for (const arquivo of arquivos) {
    const sql = readFileSync(path.join(dirMigracoes, arquivo), "utf8");
    if (/\bstorage\.\w+/.test(sql)) continue;
    await db.exec(sql);
  }

  webinarId = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Métricas', 'metricas-e8') returning id")).rows[0].id;
  outroWebinarId = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Outro', 'outro-e8') returning id")).rows[0].id;

  // Dentro do período (hoje): 2 ao vivo (1 acessou a sala, comprou) + 1 replay (não acessou) + 1 teste (nunca conta).
  const s1 = await novaSessao(webinarId, { modo: "ao_vivo", dispositivo: "desktop", pais: "Brasil", maxSegundo: 120 });
  const s2 = await novaSessao(webinarId, { modo: "ao_vivo", dispositivo: "mobile", pais: "Brasil", maxSegundo: 300 });
  await novaSessao(webinarId, { modo: "replay", dispositivo: "mobile", pais: "Portugal" });
  await novaSessao(webinarId, { modo: "teste", dispositivo: "desktop", pais: "Brasil" });

  await evento(s1, webinarId, "acessou_sala");
  await evento(s1, webinarId, "comprou");
  await evento(s2, webinarId, "acessou_sala");
  await evento(s2, webinarId, "pitch");

  await venda(webinarId, 19700, "T1");
  await venda(webinarId, 9700, "T2");

  await db.exec(`select public.somar_retencao('${webinarId}', current_date, 1)`);
  await db.exec(`select public.somar_retencao('${webinarId}', current_date, 1)`);
  await db.exec(`select public.somar_retencao('${webinarId}', current_date, 2)`);

  // Fora do período (31 dias atrás): não deve entrar na contagem do período padrão de 7 dias.
  await novaSessao(webinarId, { modo: "ao_vivo", entrouEm: "now() - interval '31 days'" });

  // Outro webinar: isola a conta (não mistura em `metricas_webinar`, mas soma no `dashboard_geral`).
  const s3 = await novaSessao(outroWebinarId, { modo: "ao_vivo", dispositivo: "desktop", pais: "Chile", maxSegundo: 60 });
  await evento(s3, outroWebinarId, "acessou_sala");
  await venda(outroWebinarId, 5000, "T3");
});

const DE = "now() - interval '1 day'";
const ATE = "now() + interval '1 day'";

async function metricas(webinar: string, de = DE, ate = ATE) {
  const { rows: [r] } = await db.query<{ metricas_webinar: Record<string, unknown> }>(
    `select public.metricas_webinar('${webinar}', ${de}, ${ate}) as metricas_webinar`,
  );
  return r.metricas_webinar;
}

async function dashboard(de = DE, ate = ATE) {
  const { rows: [r] } = await db.query<{ dashboard_geral: Record<string, unknown> }>(`select public.dashboard_geral(${de}, ${ate}) as dashboard_geral`);
  return r.dashboard_geral;
}

describe("metricas_webinar", () => {
  it("conta cadastros excluindo o modo teste e sessões fora do período", async () => {
    const m = await metricas(webinarId);
    expect(m.cadastros).toBe(3);
  });

  it("conta eventos por tipo", async () => {
    const m = await metricas(webinarId);
    expect(m.eventos).toEqual({ acessou_sala: 2, comprou: 1, pitch: 1 });
  });

  it("agrupa por dia (ao vivo × replay) no fuso de Brasília", async () => {
    const m = await metricas(webinarId);
    expect(m.porDia as unknown[]).toHaveLength(1);
    const [dia] = m.porDia as { dia: string; aoVivo: number; replay: number }[];
    expect(dia.aoVivo).toBe(2);
    expect(dia.replay).toBe(1);
  });

  it("conta dispositivos", async () => {
    const m = await metricas(webinarId);
    expect(m.dispositivos).toEqual({ desktop: 1, mobile: 2 });
  });

  it("lista top países", async () => {
    const m = await metricas(webinarId);
    expect(m.paises).toEqual(
      expect.arrayContaining([
        { pais: "Brasil", total: 2 },
        { pais: "Portugal", total: 1 },
      ]),
    );
  });

  it("soma a retenção por minuto no período", async () => {
    const m = await metricas(webinarId);
    expect(m.retencao).toEqual([
      { minuto: 1, visualizacoes: 2 },
      { minuto: 2, visualizacoes: 1 },
    ]);
  });

  it("retenção: o dia do limite exclusivo (p_ate) não entra — mesma borda de sessões/eventos (Revisão final)", async () => {
    // Webinar isolado: não mexe na contagem dos testes acima/abaixo que usam `webinarId` com o período padrão.
    const w = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Retenção borda', 'retencao-borda-e8') returning id")).rows[0].id;
    await db.exec(`select public.somar_retencao('${w}', '2026-01-10', 3)`);
    await db.exec(`select public.somar_retencao('${w}', '2026-01-11', 3)`); // dia do p_ate: fora do período
    const m = await metricas(w, "'2026-01-01T00:00:00-03:00'::timestamptz", "'2026-01-11T00:00:00-03:00'::timestamptz");
    expect(m.retencao).toEqual([{ minuto: 3, visualizacoes: 1 }]); // só o dia 10
  });

  it("conta um evento de uma sessão do período mesmo acontecendo depois de p_ate (cohort da sessão, Revisão final)", async () => {
    // Datas fixas no passado (não "now()"): fica isolado do período padrão usado pelos testes de dashboard_geral.
    const w = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Cohort evento', 'cohort-evento-e8') returning id")).rows[0].id;
    const s = await novaSessao(w, { modo: "ao_vivo", entrouEm: "'2000-06-10T10:00:00Z'::timestamptz" });
    await evento(s, w, "oferta", "'2000-06-15T10:00:00Z'::timestamptz"); // depois de p_ate, mas a sessão entrou dentro do período
    const m = await metricas(w, "'2000-06-01T00:00:00-03:00'::timestamptz", "'2000-06-11T00:00:00-03:00'::timestamptz");
    expect((m.eventos as Record<string, number>).oferta).toBe(1);
  });

  it("soma vendas e faturamento", async () => {
    const m = await metricas(webinarId);
    expect(m.vendas).toEqual({ total: 2, faturamentoCentavos: 29400 });
  });

  it("tempo médio é a média de max_segundo só de quem acessou a sala", async () => {
    const m = await metricas(webinarId);
    expect(m.tempoMedioSeg).toBe(210); // (120 + 300) / 2
  });

  it("não mistura com outro webinar", async () => {
    const m = await metricas(webinarId);
    expect((m.eventos as Record<string, number>).acessou_sala).toBe(2);
  });

  it("fora do período dado, não conta", async () => {
    const m = await metricas(webinarId, "now() - interval '40 days'", "now() - interval '35 days'");
    expect(m.cadastros).toBe(0);
  });

  it("anônimo não executa (revoke)", async () => {
    await db.exec("set role anon");
    await expect(db.query(`select public.metricas_webinar('${webinarId}', ${DE}, ${ATE})`)).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("dashboard_geral", () => {
  it("soma os mesmos blocos de todos os webinars e lista porWebinar", async () => {
    const d = await dashboard();
    expect(d.cadastros).toBe(4); // 3 do webinar principal (sem o antigo/fora do período) + 1 do outro
    expect(d.vendas).toEqual({ total: 3, faturamentoCentavos: 34400 });

    const porWebinar = d.porWebinar as { id: string; nome: string; cadastros: number; acessos: number; vendas: number; faturamentoCentavos: number }[];
    const principal = porWebinar.find((w) => w.id === webinarId)!;
    const outro = porWebinar.find((w) => w.id === outroWebinarId)!;
    expect(principal).toEqual({ id: webinarId, nome: "Métricas", cadastros: 3, acessos: 2, vendas: 2, faturamentoCentavos: 29400 });
    expect(outro).toEqual({ id: outroWebinarId, nome: "Outro", cadastros: 1, acessos: 1, vendas: 1, faturamentoCentavos: 5000 });
  });

  it("conta um evento de uma sessão do período mesmo acontecendo depois de p_ate (cohort da sessão, Revisão final)", async () => {
    const w = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Cohort dashboard', 'cohort-dashboard-e8') returning id")).rows[0].id;
    const s = await novaSessao(w, { modo: "ao_vivo", entrouEm: "'2001-06-10T10:00:00Z'::timestamptz" });
    await evento(s, w, "oferta", "'2001-06-15T10:00:00Z'::timestamptz");
    const d = await dashboard("'2001-06-01T00:00:00-03:00'::timestamptz", "'2001-06-11T00:00:00-03:00'::timestamptz");
    expect((d.eventos as Record<string, number>).oferta).toBe(1);
  });

  it("anônimo não executa (revoke)", async () => {
    await db.exec("set role anon");
    await expect(db.query(`select public.dashboard_geral(${DE}, ${ATE})`)).rejects.toThrow();
    await db.exec("reset role");
  });
});
