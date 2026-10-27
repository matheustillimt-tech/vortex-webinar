import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

// O Supabase tem o esquema `auth`, os papéis e a extensão; aqui simulamos só o que as migrações usam.
const PRELUDIO = `
  create role authenticated; create role anon; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  -- Realtime do Supabase: a publicação e o esquema \`realtime\` (só o que a migração do atendimento usa).
  create publication supabase_realtime;
  create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text not null, extension text not null default 'presence');
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRELUDIO);
  const dirMigracoes = path.join(__dirname, "../supabase/migrations");
  const arquivos = readdirSync(dirMigracoes).filter((f) => f.endsWith(".sql")).sort();
  for (const arquivo of arquivos) {
    const sql = readFileSync(path.join(dirMigracoes, arquivo), "utf8");
    // O PGlite não tem o esquema `storage` do Supabase (buckets, objects); migrações que só configuram
    // bucket (como a de mídias) não têm o que testar aqui e são puladas.
    if (/\bstorage\.\w+/.test(sql)) continue;
    await db.exec(sql);
  }
});

describe("migração inicial + endurecimento de RLS", () => {
  it("cria todas as tabelas do esquema", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "agendas", "agentes_ia", "api_uso", "audiencias", "auditoria", "chatbot", "chaves_api", "checkout_logs", "checkout_webhooks", "checkouts",
      "disparos", "emails_jit", "envios_email", "eventos", "geracoes_chat", "jit_config", "jit_horarios", "mensagens_simuladas",
      "mensagens_suporte", "ofertas", "paginas", "participantes", "regras", "retencao", "retencao_sessao", "sessoes",
      "tarjas_aviso", "telas_login", "testes_ab", "testes_ab_variacoes", "usuarios", "vendas", "vendas_simuladas", "videos", "webinar_video", "webinars",
    ]);
  });

  it("geracoes_chat tem as colunas da geração por blocos e o índice por status", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'geracoes_chat' order by 1",
    );
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual(
      expect.arrayContaining([
        "blocos",
        "bloco_atual",
        "mensagens_geradas",
        "fonte_url",
        "trabalhando_ate",
        "tentativas",
        "total_blocos",
      ]),
    );
    const { rows: indices } = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'geracoes_chat'",
    );
    expect(indices.map((i) => i.indexname)).toContain("geracoes_chat_status_created_at");
    expect(indices.map((i) => i.indexname)).toContain("geracoes_chat_uma_em_andamento_por_webinar");
  });

  it("geracoes_chat: só uma em andamento (fila|transcrevendo|gerando) por webinar, pelo índice único parcial", async () => {
    const { rows: webinars } = await db.query<{ id: string }>("select id from webinars limit 1");
    let webinarId = webinars[0]?.id as string | undefined;
    if (!webinarId) {
      const { rows } = await db.query<{ id: string }>(
        "insert into webinars (nome, slug) values ('x', 'x-teste-migracao') returning id",
      );
      webinarId = rows[0].id;
    }
    await db.query("insert into geracoes_chat (webinar_id, status, idioma, tom, intensidade) values ($1, 'fila', 'pt', 'natural', 'media')", [
      webinarId,
    ]);
    await expect(
      db.query("insert into geracoes_chat (webinar_id, status, idioma, tom, intensidade) values ($1, 'gerando', 'pt', 'natural', 'media')", [
        webinarId,
      ]),
    ).rejects.toThrow();
    // Uma "pronto" não conflita (fora da condição parcial do índice).
    await expect(
      db.query("insert into geracoes_chat (webinar_id, status, idioma, tom, intensidade) values ($1, 'pronto', 'pt', 'natural', 'media')", [
        webinarId,
      ]),
    ).resolves.toBeDefined();
    await db.query("delete from geracoes_chat where webinar_id = $1", [webinarId]);
  });

  it("liga RLS em todas", async () => {
    const { rows } = await db.query<{ relname: string }>(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(rows).toEqual([]);
  });

  it("slug do webinar é único", async () => {
    await db.exec("insert into webinars (nome, slug) values ('A', 'aula-a')");
    await expect(db.exec("insert into webinars (nome, slug) values ('B', 'aula-a')")).rejects.toThrow();
  });

  it("evento é único por sessão e tipo", async () => {
    const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('C', 'aula-c') returning id");
    const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w.id}', 'Ana') returning id`);
    const { rows: [s] } = await db.query<{ id: string }>(
      `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
    );
    await db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s.id}', '${w.id}', 'acessou_sala')`);
    await expect(db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s.id}', '${w.id}', 'acessou_sala')`)).rejects.toThrow();
  });

  it("updated_at muda no update", async () => {
    const { rows: [a] } = await db.query<{ updated_at: string }>("select updated_at from webinars where slug = 'aula-a'");
    await new Promise((r) => setTimeout(r, 10));
    const { rows: [b] } = await db.query<{ updated_at: string }>("update webinars set nome = 'A2' where slug = 'aula-a' returning updated_at");
    expect(new Date(b.updated_at).getTime()).toBeGreaterThan(new Date(a.updated_at).getTime());
  });

  it("somar_retencao insere e depois incrementa visualizacoes", async () => {
    const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Retenção', 'aula-retencao') returning id");
    await db.exec(`select public.somar_retencao('${w.id}', '2026-10-20', 5)`);
    const { rows: [depoisDoPrimeiro] } = await db.query<{ visualizacoes: number }>(
      `select visualizacoes from retencao where webinar_id = '${w.id}' and data = '2026-10-20' and minuto = 5`,
    );
    expect(depoisDoPrimeiro.visualizacoes).toBe(1);

    await db.exec(`select public.somar_retencao('${w.id}', '2026-10-20', 5)`);
    const { rows: [depoisDoSegundo] } = await db.query<{ visualizacoes: number }>(
      `select visualizacoes from retencao where webinar_id = '${w.id}' and data = '2026-10-20' and minuto = 5`,
    );
    expect(depoisDoSegundo.visualizacoes).toBe(2);
  });

  it("retencao_sessao: minuto é único por sessão (a API de sinal conta cada minuto uma vez)", async () => {
    const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('RS', 'aula-rs') returning id");
    const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w.id}', 'Bia') returning id`);
    const { rows: [s] } = await db.query<{ id: string }>(
      `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
    );
    await db.exec(`insert into retencao_sessao (sessao_id, minuto) values ('${s.id}', 3)`);
    await expect(db.exec(`insert into retencao_sessao (sessao_id, minuto) values ('${s.id}', 3)`)).rejects.toThrow();
  });

  it("auditoria não tem política de update/delete (nem pra admin): só o servidor com service role escreve", async () => {
    const { rows } = await db.query<{ cmd: string }>(
      "select cmd from pg_policies where schemaname = 'public' and tablename = 'auditoria' and cmd in ('UPDATE', 'DELETE', 'ALL')",
    );
    expect(rows).toEqual([]);
  });

  it("checkouts, regras e vendas não dão acesso a atendente (eh_membro)", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename in ('checkouts', 'regras', 'vendas')
         and (coalesce(qual, '') like '%eh_membro%' or coalesce(with_check, '') like '%eh_membro%')`,
    );
    expect(rows).toEqual([]);
  });

  it("mensagens_suporte e sessoes não têm mais política de insert/update/delete/all pra atendente (eh_membro): só a leitura", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
       where schemaname = 'public' and tablename in ('mensagens_suporte', 'sessoes')
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and (coalesce(qual, '') like '%eh_membro%' or coalesce(with_check, '') like '%eh_membro%')`,
    );
    expect(rows).toEqual([]);

    const { rows: leitura } = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename in ('mensagens_suporte', 'sessoes')
         and cmd = 'SELECT' and policyname = 'equipe_le'
         and coalesce(qual, '') like '%eh_membro%'`,
    );
    expect(leitura.map((r) => r.tablename).sort()).toEqual(["mensagens_suporte", "sessoes"]);
  });

  it("eh_admin() e eh_membro() travam o search_path", async () => {
    const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(
      "select proname, proconfig from pg_proc where proname in ('eh_admin', 'eh_membro') and pronamespace = 'public'::regnamespace",
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.proconfig).toEqual(['search_path=""']);
  });

  it("toda política que usa eh_admin()/eh_membro() chama a função como (select ...)", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string; coluna: string }>(
      `select tablename, policyname, 'qual' as coluna from pg_policies
       where schemaname = 'public' and (qual like '%eh_admin%' or qual like '%eh_membro%') and qual not ilike '%select%eh_%'
       union all
       select tablename, policyname, 'with_check' as coluna from pg_policies
       where schemaname = 'public' and (with_check like '%eh_admin%' or with_check like '%eh_membro%') and with_check not ilike '%select%eh_%'`,
    );
    expect(rows).toEqual([]);
  });

  describe("RLS em comportamento (admin x atendente x desconhecido)", () => {
    const adminAuthId = "11111111-1111-1111-1111-111111111111";
    const atendenteAuthId = "22222222-2222-2222-2222-222222222222";
    let webinarId: string;
    let participanteId: string;
    let sessaoId: string;

    beforeAll(async () => {
      // Superusuário monta o cenário (equivalente ao service role, que ignora RLS).
      await db.exec(`insert into auth.users (id, email) values ('${adminAuthId}', 'admin@teste.com')`);
      await db.exec(`insert into auth.users (id, email) values ('${atendenteAuthId}', 'atendente@teste.com')`);
      await db.exec(
        `insert into usuarios (auth_id, nome, email, papel, ativo) values ('${adminAuthId}', 'Admin', 'admin@teste.com', 'admin', true)`,
      );
      await db.exec(
        `insert into usuarios (auth_id, nome, email, papel, ativo) values ('${atendenteAuthId}', 'Atendente', 'atendente@teste.com', 'atendente', true)`,
      );
      const { rows: [w] } = await db.query<{ id: string }>(
        "insert into webinars (nome, slug) values ('RLS', 'rls-teste') returning id",
      );
      webinarId = w.id;
      const { rows: [p] } = await db.query<{ id: string }>(
        `insert into participantes (webinar_id, nome) values ('${webinarId}', 'Participante') returning id`,
      );
      participanteId = p.id;
      const { rows: [s] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${participanteId}', '${webinarId}', now()) returning id`,
      );
      sessaoId = s.id;
      await db.exec("insert into checkouts (plataforma) values ('kiwify')");

      // Mimetiza as permissões padrão do Supabase pra authenticated (sem elas, nem as políticas rodam).
      await db.exec("grant usage on schema public to authenticated");
      await db.exec("grant all on all tables in schema public to authenticated");
    });

    it("atendente lê webinars, não vê checkouts e não consegue escrever em mensagens_suporte", async () => {
      await db.exec("set role authenticated");
      await db.exec(`set app.uid = '${atendenteAuthId}'`);

      const { rows: webinars } = await db.query("select id from webinars");
      expect(webinars.length).toBeGreaterThan(0);

      const { rows: checkouts } = await db.query("select id from checkouts");
      expect(checkouts).toEqual([]);

      await expect(
        db.exec(
          `insert into mensagens_suporte (sessao_id, webinar_id, autor, texto) values ('${sessaoId}', '${webinarId}', 'atendente', 'oi')`,
        ),
      ).rejects.toThrow();

      await db.exec("reset role");
    });

    it("admin lê checkouts e consegue inserir em webinars", async () => {
      await db.exec("set role authenticated");
      await db.exec(`set app.uid = '${adminAuthId}'`);

      const { rows: checkouts } = await db.query("select id from checkouts");
      expect(checkouts.length).toBeGreaterThan(0);

      await expect(db.exec("insert into webinars (nome, slug) values ('RLS admin', 'rls-teste-admin')")).resolves.not.toThrow();

      await db.exec("reset role");
    });

    it("uid autenticado que não está em usuarios não vê nenhum webinar", async () => {
      await db.exec("set role authenticated");
      await db.exec("set app.uid = '33333333-3333-3333-3333-333333333333'");

      const { rows: webinars } = await db.query("select id from webinars");
      expect(webinars).toEqual([]);

      await db.exec("reset role");
    });
  });

  it("vídeo externo aceita origem 'externo' sem guid do Bunny", async () => {
    await db.exec("insert into videos (nome, origem, hls_url, status) values ('Ext', 'externo', 'https://x/y.m3u8', 'pronto')");
    await expect(db.exec("insert into videos (nome, origem) values ('Ruim', 'youtube')")).rejects.toThrow();
  });

  describe("fila de disparos", () => {
    it("pegar_disparos: só pega da fila com enviar_apos vencido, incrementa tentativas, ordem por enviar_apos", async () => {
      const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Fila', 'aula-fila') returning id");
      const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w.id}', 'Fia') returning id`);
      const { rows: [s1] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
      );
      const { rows: [s2] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
      );
      const { rows: [s3] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
      );
      const { rows: [r] } = await db.query<{ id: string }>(
        `insert into regras (webinar_id, gatilho, url) values ('${w.id}', 'acessou', 'https://x.com') returning id`,
      );

      const { rows: [d1] } = await db.query<{ id: string; tentativas: number }>(
        `insert into disparos (regra_id, sessao_id, enviar_apos) values ('${r.id}', '${s1.id}', now() - interval '2 minutes') returning id, tentativas`,
      );
      const { rows: [d2] } = await db.query<{ id: string }>(
        `insert into disparos (regra_id, sessao_id, enviar_apos) values ('${r.id}', '${s2.id}', now() - interval '1 minute') returning id`,
      );
      await db.query(`insert into disparos (regra_id, sessao_id, enviar_apos) values ('${r.id}', '${s3.id}', now() + interval '1 hour')`);
      expect(d1.tentativas).toBe(0);

      const { rows: pegos } = await db.query<{ id: string; tentativas: number; status: string }>("select * from public.pegar_disparos(10)");
      expect(pegos.map((x) => x.id).sort()).toEqual([d1.id, d2.id].sort()); // só os vencidos; o futuro (s3) fica de fora
      expect(pegos.every((x) => x.tentativas === 1)).toBe(true);
      expect(pegos.every((x) => x.status === "fila")).toBe(true); // só incrementa tentativas; quem chama grava o status

      // Reserva (lease): a mesma chamada empurra enviar_apos 3 min pra frente, então uma segunda chamada logo em
      // seguida (outro cron sobreposto) não pega os mesmos disparos de novo.
      const { rows: segundaChamada } = await db.query<{ id: string }>("select * from public.pegar_disparos(10)");
      expect(segundaChamada).toEqual([]);
      const { rows: reservados } = await db.query<{ ok: boolean }>(
        `select enviar_apos > now() + interval '2 minutes' and enviar_apos <= now() + interval '3 minutes' as ok from disparos where id in ('${d1.id}', '${d2.id}')`,
      );
      expect(reservados.every((x) => x.ok)).toBe(true);

      // Reserva vencida (a função morreu no meio): volta a ser pega, com mais uma tentativa.
      await db.query(`update disparos set enviar_apos = now() - interval '1 second' where id in ('${d1.id}', '${d2.id}')`);
      const { rows: terceiraChamada } = await db.query<{ id: string; tentativas: number }>("select * from public.pegar_disparos(10)");
      expect(terceiraChamada.map((x) => x.id).sort()).toEqual([d1.id, d2.id].sort());
      expect(terceiraChamada.every((x) => x.tentativas === 2)).toBe(true);

      // status != 'fila' sai da fila.
      await db.query(`update disparos set status = 'ok' where id = '${d1.id}'`);
      await db.query(`update disparos set enviar_apos = now() - interval '1 second' where id = '${d2.id}'`);
      const { rows: quartaChamada } = await db.query<{ id: string }>("select * from public.pegar_disparos(10)");
      expect(quartaChamada.map((x) => x.id)).toEqual([d2.id]);
    });

    it("sessões que já existiam antes da migração entram como avaliadas (o histórico não dispara abandonou/não viu)", async () => {
      // A coluna nasce com default false (sessões novas); a migração marca as antigas como avaliadas. Re-roda o
      // update da migração sobre uma sessão "antiga" simulada.
      const sql = readFileSync(path.join(__dirname, "../supabase/migrations/20261021090000_disparos_e_fim.sql"), "utf8");
      expect(sql).toMatch(/update public\.sessoes set avaliada_fim = true where avaliada_fim = false;/);
      const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Hist', 'aula-hist') returning id");
      const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w.id}', 'H') returning id`);
      const { rows: [s] } = await db.query<{ avaliada_fim: boolean }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning avaliada_fim`,
      );
      expect(s.avaliada_fim).toBe(false); // sessão nova (depois da migração) ainda será avaliada
    });

    it("registrar_sinal: max_segundo só cresce (greatest), devolve anterior/atual e grava a posição só no replay", async () => {
      const { rows: [w] } = await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Sinal', 'aula-sinal') returning id");
      const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w.id}', 'S') returning id`);
      const { rows: [s] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${w.id}', now()) returning id`,
      );

      const { rows: [r1] } = await db.query<{ anterior: number; atual: number }>(`select * from public.registrar_sinal('${s.id}', 120, false)`);
      expect(r1).toEqual({ anterior: 0, atual: 120 });
      const { rows: [r2] } = await db.query<{ anterior: number; atual: number }>(`select * from public.registrar_sinal('${s.id}', 60, true)`);
      expect(r2).toEqual({ anterior: 120, atual: 120 }); // voltou no vídeo: não diminui
      const { rows: [linha] } = await db.query<{ max_segundo: number; posicao_replay_seg: number | null; com_sinal: boolean }>(
        `select max_segundo, posicao_replay_seg, ultimo_sinal_em is not null as com_sinal from sessoes where id = '${s.id}'`,
      );
      expect(linha).toEqual({ max_segundo: 120, posicao_replay_seg: 60, com_sinal: true });

      const { rows: nenhuma } = await db.query(`select * from public.registrar_sinal('00000000-0000-0000-0000-000000000000', 10, false)`);
      expect(nenhuma).toEqual([]);
    });

    it("anon não executa registrar_sinal", async () => {
      await db.exec("set role anon");
      await expect(db.query("select * from public.registrar_sinal('00000000-0000-0000-0000-000000000000', 1, false)")).rejects.toThrow();
      await db.exec("reset role");
    });

    it("anon não executa pegar_disparos", async () => {
      await db.exec("set role anon");
      await expect(db.query("select * from public.pegar_disparos(10)")).rejects.toThrow();
      await db.exec("reset role");
    });
  });

  describe("just in time e e-mails", () => {
    async function sessaoNova(slug: string): Promise<{ w: string; s: string }> {
      const { rows: [w] } = await db.query<{ id: string }>(`insert into webinars (nome, slug, tipo_agenda) values ('JIT', '${slug}', 'jit') returning id`);
      const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome, email) values ('${w.id}', 'Ana', 'ana@x.com') returning id`);
      const { rows: [s] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao, jit_horario) values ('${p.id}', '${w.id}', now() + interval '1 hour', now() + interval '1 hour') returning id`,
      );
      return { w: w.id, s: s.id };
    }

    it("eventos aceita 'inscreveu_lp' e continua recusando tipo desconhecido", async () => {
      const { w, s } = await sessaoNova("jit-evento");
      await db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s}', '${w}', 'inscreveu_lp')`);
      await db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s}', '${w}', 'acessou_sala')`);
      await expect(db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s}', '${w}', 'inventado')`)).rejects.toThrow();
      const { rows } = await db.query<{ conname: string }>(
        "select conname from pg_constraint where conrelid = 'public.eventos'::regclass and contype = 'c'",
      );
      expect(rows.map((r) => r.conname)).toEqual(["eventos_tipo_check"]);
    });

    it("sessoes.jit_fuso: opcional, até 64 caracteres", async () => {
      const { s } = await sessaoNova("jit-fuso");
      await db.exec(`update sessoes set jit_fuso = 'Europe/Lisbon' where id = '${s}'`);
      const { rows: [l] } = await db.query<{ jit_fuso: string | null }>(`select jit_fuso from sessoes where id = '${s}'`);
      expect(l.jit_fuso).toBe("Europe/Lisbon");
      await expect(db.exec(`update sessoes set jit_fuso = '${"x".repeat(65)}' where id = '${s}'`)).rejects.toThrow();
      await expect(db.exec(`update sessoes set jit_fuso = '' where id = '${s}'`)).rejects.toThrow();
    });

    it("envios_email: um por sessão e tipo, checks de tipo/status, padrões e cascata", async () => {
      const { w, s } = await sessaoNova("jit-envios");
      const { rows: [e] } = await db.query<{ status: string; tentativas: number; erro: string | null; enviado_em: string | null }>(
        `insert into envios_email (sessao_id, webinar_id, tipo, enviar_em) values ('${s}', '${w}', 'inscricao', now()) returning *`,
      );
      expect(e).toMatchObject({ status: "fila", tentativas: 0, erro: null, enviado_em: null });
      await expect(db.exec(`insert into envios_email (sessao_id, webinar_id, tipo, enviar_em) values ('${s}', '${w}', 'inscricao', now())`)).rejects.toThrow();
      const { rows: ignorado } = await db.query(
        `insert into envios_email (sessao_id, webinar_id, tipo, enviar_em) values ('${s}', '${w}', 'inscricao', now()) on conflict (sessao_id, tipo) do nothing returning id`,
      );
      expect(ignorado).toEqual([]);
      await expect(db.exec(`insert into envios_email (sessao_id, webinar_id, tipo, enviar_em) values ('${s}', '${w}', 'outro', now())`)).rejects.toThrow();
      await expect(
        db.exec(`insert into envios_email (sessao_id, webinar_id, tipo, enviar_em, status) values ('${s}', '${w}', 'lembrete', now(), 'ok')`),
      ).rejects.toThrow();
      for (const st of ["enviado", "erro", "expirado"]) {
        await db.exec(`delete from envios_email where sessao_id = '${s}' and tipo = 'lembrete'`);
        await db.exec(`insert into envios_email (sessao_id, webinar_id, tipo, enviar_em, status) values ('${s}', '${w}', 'lembrete', now(), '${st}')`);
      }
      const { rows: indices } = await db.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'envios_email'");
      expect(indices.map((i) => i.indexname)).toContain("envios_email_status_enviar_em");

      // updated_at pelo trigger.
      await db.exec(`update envios_email set updated_at = now() - interval '1 day' where sessao_id = '${s}'`);
      const { rows: [u] } = await db.query<{ recente: boolean }>(
        `select updated_at > now() - interval '1 minute' as recente from envios_email where sessao_id = '${s}' and tipo = 'inscricao'`,
      );
      expect(u.recente).toBe(true);

      await db.exec(`delete from sessoes where id = '${s}'`);
      const { rows: sobrou } = await db.query(`select id from envios_email where sessao_id = '${s}'`);
      expect(sobrou).toEqual([]);
    });

    it("envios_email: RLS admin_tudo com (select public.eh_admin())", async () => {
      const { rows } = await db.query<{ policyname: string; qual: string; with_check: string }>(
        "select policyname, qual, with_check from pg_policies where tablename = 'envios_email'",
      );
      expect(rows.map((r) => r.policyname)).toEqual(["admin_tudo"]);
      expect(rows[0].qual).toMatch(/SELECT eh_admin\(\)/i);
      expect(rows[0].with_check).toMatch(/SELECT eh_admin\(\)/i);
    });

    it("pegar_emails: só fila vencida, em ordem, lease de 3 min e tentativas + 1", async () => {
      const ids: string[] = [];
      for (const [i, quando] of ["now() - interval '2 minutes'", "now() - interval '1 minute'", "now() + interval '1 hour'"].entries()) {
        const { w, s } = await sessaoNova(`jit-pegar-${i}`);
        const { rows: [e] } = await db.query<{ id: string }>(
          `insert into envios_email (sessao_id, webinar_id, tipo, enviar_em) values ('${s}', '${w}', 'lembrete', ${quando}) returning id`,
        );
        ids.push(e.id);
      }
      const { w: wErro, s: sErro } = await sessaoNova("jit-pegar-erro");
      await db.exec(`insert into envios_email (sessao_id, webinar_id, tipo, enviar_em, status) values ('${sErro}', '${wErro}', 'lembrete', now() - interval '1 minute', 'erro')`);

      const { rows: um } = await db.query<{ id: string; tentativas: number; status: string }>("select * from public.pegar_emails(1)");
      expect(um.map((x) => x.id)).toEqual([ids[0]]); // o mais antigo primeiro
      const { rows: resto } = await db.query<{ id: string; tentativas: number; status: string }>("select * from public.pegar_emails(10)");
      expect(resto.map((x) => x.id)).toEqual([ids[1]]); // o já reservado e o futuro ficam de fora; 'erro' também
      expect([...um, ...resto].every((x) => x.tentativas === 1 && x.status === "fila")).toBe(true);
      expect((await db.query("select * from public.pegar_emails(10)")).rows).toEqual([]);

      const { rows: reservados } = await db.query<{ ok: boolean }>(
        `select enviar_em > now() + interval '2 minutes' and enviar_em <= now() + interval '3 minutes' as ok from envios_email where id in ('${ids[0]}', '${ids[1]}')`,
      );
      expect(reservados.every((x) => x.ok)).toBe(true);
    });

    it("anon e authenticated não executam pegar_emails", async () => {
      for (const papel of ["anon", "authenticated"]) {
        await db.exec(`set role ${papel}`);
        await expect(db.query("select * from public.pegar_emails(10)")).rejects.toThrow();
        await db.exec("reset role");
      }
    });
  });

  describe("tempo real e atendimento", () => {
    const atendenteAuthId = "44444444-4444-4444-4444-444444444444";
    let usuarioAtendenteId: string;
    let webinarId: string;
    let outroWebinarId: string;

    async function novaSessao(webinar: string, nome: string): Promise<string> {
      const { rows: [p] } = await db.query<{ id: string }>(
        `insert into participantes (webinar_id, nome, email) values ('${webinar}', '${nome}', '${nome.toLowerCase()}@x.com') returning id`,
      );
      const { rows: [s] } = await db.query<{ id: string }>(
        `insert into sessoes (participante_id, webinar_id, inicio_sessao) values ('${p.id}', '${webinar}', now()) returning id`,
      );
      return s.id;
    }

    async function mensagem(sessao: string, webinar: string, autor: string, minuto: number, opcoes: { texto?: string | null; imagem?: string; apagada?: boolean; autorId?: string } = {}) {
      const texto = opcoes.texto === null ? "null" : `'${opcoes.texto ?? autor + " " + minuto}'`;
      const imagem = opcoes.imagem ? `'${opcoes.imagem}'` : "null";
      const { rows: [m] } = await db.query<{ id: string }>(
        `insert into mensagens_suporte (sessao_id, webinar_id, autor, autor_id, texto, imagem_url, apagada, created_at)
         values ('${sessao}', '${webinar}', '${autor}', ${opcoes.autorId ? `'${opcoes.autorId}'` : "null"}, ${texto}, ${imagem},
                 ${opcoes.apagada ? "true" : "false"}, '2026-10-20T12:00:00Z'::timestamptz + interval '${minuto} minutes') returning id`,
      );
      return m.id;
    }

    type LinhaConversa = {
      sessao_id: string;
      participante_nome: string;
      participante_email: string | null;
      atendente_nome: string | null;
      ultima_texto: string | null;
      ultima_imagem: boolean;
      ultima_autor: string;
      ultima_em: string;
      ultima_apagada: boolean;
      nao_lidas: number;
    };

    async function conversas(webinar: string, limite?: number): Promise<LinhaConversa[]> {
      const sql = limite === undefined
        ? `select * from public.conversas_atendimento('${webinar}')`
        : `select * from public.conversas_atendimento('${webinar}', ${limite})`;
      return (await db.query<LinhaConversa>(sql)).rows;
    }

    beforeAll(async () => {
      await db.exec(`insert into auth.users (id, email) values ('${atendenteAuthId}', 'bruno@teste.com')`);
      const { rows: [u] } = await db.query<{ id: string }>(
        `insert into usuarios (auth_id, nome, email, papel, ativo) values ('${atendenteAuthId}', 'Bruno', 'bruno@teste.com', 'atendente', true) returning id`,
      );
      usuarioAtendenteId = u.id;
      webinarId = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Atend', 'atend-e6') returning id")).rows[0].id;
      outroWebinarId = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Outro', 'outro-e6') returning id")).rows[0].id;
    });

    it("publica só mensagens_suporte no supabase_realtime (sessoes fica fora)", async () => {
      const { rows } = await db.query<{ tablename: string }>(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1",
      );
      expect(rows.map((r) => r.tablename)).toEqual(["mensagens_suporte"]);
    });

    it("re-aplicar a migração tira sessoes da publicação (versão antiga publicava) e não falha", async () => {
      await db.exec("alter publication supabase_realtime add table public.sessoes");
      const sql = readFileSync(path.join(__dirname, "../supabase/migrations/20261020200000_realtime_atendimento.sql"), "utf8");
      await db.exec(sql);
      const { rows } = await db.query<{ tablename: string }>(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1",
      );
      expect(rows.map((r) => r.tablename)).toEqual(["mensagens_suporte"]);
    });

    it("realtime.messages: membro só lê/escreve em tópicos atendimento:*", async () => {
      await db.exec("grant usage on schema realtime to authenticated");
      await db.exec("grant all on realtime.messages to authenticated");
      await db.exec("grant usage on all sequences in schema realtime to authenticated");
      await db.exec("insert into realtime.messages (topic) values ('atendimento:abc'), ('outra-coisa:abc')");

      await db.exec("set role authenticated");
      await db.exec(`set app.uid = '${atendenteAuthId}'`);
      await db.exec("set realtime.topic = 'atendimento:abc'");
      expect((await db.query("select id from realtime.messages")).rows.length).toBe(2); // tópico do canal, não da linha
      await expect(db.exec("insert into realtime.messages (topic) values ('atendimento:abc')")).resolves.not.toThrow();

      await db.exec("set realtime.topic = 'outra-coisa:abc'");
      expect((await db.query("select id from realtime.messages")).rows).toEqual([]);
      await expect(db.exec("insert into realtime.messages (topic) values ('outra-coisa:abc')")).rejects.toThrow();

      await db.exec("set app.uid = '33333333-3333-3333-3333-333333333333'");
      await db.exec("set realtime.topic = 'atendimento:abc'");
      expect((await db.query("select id from realtime.messages")).rows).toEqual([]);
      await db.exec("reset role");
      await db.exec("reset realtime.topic");
    });

    it("apagar mensagem (só apagada = true) mantém texto/imagem e passa no check; limpar os dois falharia", async () => {
      const sessao = await novaSessao(outroWebinarId, "Apaga");
      const id = await mensagem(sessao, outroWebinarId, "atendente", 0, { texto: "oi", autorId: usuarioAtendenteId });
      const { rows: [m] } = await db.query<{ apagada: boolean; texto: string }>(
        `update mensagens_suporte set apagada = true where id = '${id}' returning apagada, texto`,
      );
      expect(m).toEqual({ apagada: true, texto: "oi" });

      const idImagem = await mensagem(sessao, outroWebinarId, "atendente", 1, { texto: null, imagem: "https://x/y.jpg", autorId: usuarioAtendenteId });
      await expect(db.exec(`update mensagens_suporte set apagada = true where id = '${idImagem}'`)).resolves.not.toThrow();
      await expect(db.exec(`update mensagens_suporte set apagada = true, texto = null, imagem_url = null where id = '${idImagem}'`)).rejects.toThrow();
    });

    it("conversas_atendimento: não lidas = do participante depois da última do atendente (chatbot/ia não contam)", async () => {
      const sessao = await novaSessao(webinarId, "Ana");
      await mensagem(sessao, webinarId, "participante", 1);
      await mensagem(sessao, webinarId, "atendente", 2, { autorId: usuarioAtendenteId });
      await mensagem(sessao, webinarId, "participante", 3);
      await mensagem(sessao, webinarId, "chatbot", 4);
      await mensagem(sessao, webinarId, "participante", 5);
      await mensagem(sessao, webinarId, "ia", 6);

      const linha = (await conversas(webinarId)).find((c) => c.sessao_id === sessao)!;
      expect(linha.nao_lidas).toBe(2);
      expect(linha.ultima_autor).toBe("ia");
      expect(linha.ultima_texto).toBe("ia 6");
      expect(linha.participante_nome).toBe("Ana");
      expect(linha.participante_email).toBe("ana@x.com");
    });

    it("conversas_atendimento: sem resposta do atendente, todas do participante são não lidas; última apagada vem sem conteúdo", async () => {
      const sessao = await novaSessao(webinarId, "Bia");
      await db.exec(`update sessoes set atendente_id = '${usuarioAtendenteId}', status_atendimento = 'atendendo' where id = '${sessao}'`);
      await mensagem(sessao, webinarId, "participante", 10);
      await mensagem(sessao, webinarId, "participante", 11, { texto: null, imagem: "https://x/foto.jpg" });
      await mensagem(sessao, webinarId, "atendente", 9, { texto: "antes", autorId: usuarioAtendenteId, apagada: true });
      await mensagem(sessao, webinarId, "atendente", 12, { texto: "segredo", imagem: "https://x/a.jpg", autorId: usuarioAtendenteId, apagada: true });

      const linha = (await conversas(webinarId)).find((c) => c.sessao_id === sessao)!;
      expect(linha.ultima_apagada).toBe(true);
      expect(linha.ultima_texto).toBeNull();
      expect(linha.ultima_imagem).toBe(false);
      expect(linha.atendente_nome).toBe("Bruno");
      expect(linha.nao_lidas).toBe(0); // a última do atendente (mesmo apagada) é a resposta
    });

    it("conversas_atendimento: imagem sem texto vira ultima_imagem; sem resposta nenhuma conta tudo", async () => {
      const sessao = await novaSessao(webinarId, "Caio");
      await mensagem(sessao, webinarId, "participante", 20);
      await mensagem(sessao, webinarId, "participante", 21, { texto: null, imagem: "https://x/foto.jpg" });
      const linha = (await conversas(webinarId)).find((c) => c.sessao_id === sessao)!;
      expect(linha.ultima_imagem).toBe(true);
      expect(linha.ultima_texto).toBeNull();
      expect(linha.nao_lidas).toBe(2);
    });

    it("conversas_atendimento: só sessões com mensagem do participante, só deste webinar, mais recente primeiro, com limite", async () => {
      const soAtendente = await novaSessao(webinarId, "Dani");
      await mensagem(soAtendente, webinarId, "atendente", 50, { autorId: usuarioAtendenteId });
      const doOutro = await novaSessao(outroWebinarId, "Edu");
      await mensagem(doOutro, outroWebinarId, "participante", 60);

      const todas = await conversas(webinarId);
      const ids = todas.map((c) => c.sessao_id);
      expect(ids).not.toContain(soAtendente);
      expect(ids).not.toContain(doOutro);
      expect(todas.map((c) => c.participante_nome)).toEqual(["Caio", "Bia", "Ana"]);
      const tempos = todas.map((c) => new Date(c.ultima_em).getTime());
      expect([...tempos].sort((a, b) => b - a)).toEqual(tempos);

      expect((await conversas(webinarId, 2)).map((c) => c.participante_nome)).toEqual(["Caio", "Bia"]);
      expect((await conversas(outroWebinarId)).map((c) => c.sessao_id)).toEqual([doOutro]);
    });

    it("conversas_atendimento: anônimo não executa; atendente executa e a RLS vale", async () => {
      await db.exec("set role anon");
      await expect(db.query(`select * from public.conversas_atendimento('${webinarId}')`)).rejects.toThrow();
      await db.exec("reset role");

      await db.exec("set role authenticated");
      await db.exec(`set app.uid = '${atendenteAuthId}'`);
      expect((await db.query(`select * from public.conversas_atendimento('${webinarId}')`)).rows.length).toBe(3);
      await db.exec("set app.uid = '33333333-3333-3333-3333-333333333333'");
      expect((await db.query(`select * from public.conversas_atendimento('${webinarId}')`)).rows).toEqual([]);
      await db.exec("reset role");
    });

    it("turmas: virada às 06:00 de Brasília; conversas_atendimento_turma filtra a turma; turmas_atendimento lista as com conversa", async () => {
      const w = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Turmas', 'turmas-e6') returning id")).rows[0].id;
      async function sessaoEm(nome: string, inicio: string): Promise<string> {
        const id = await novaSessao(w, nome);
        await db.exec(`update sessoes set inicio_sessao = '${inicio}' where id = '${id}'`);
        return id;
      }
      // 22/10 19:30 e 23/10 00:40 de Brasília (madrugada ainda é a turma de 22/10); 23/10 19:10 é a turma de 23/10.
      const ontem = await sessaoEm("Ontem", "2026-10-22T22:30:00Z");
      const madrugada = await sessaoEm("Madrugada", "2026-10-23T03:40:00Z");
      const hoje = await sessaoEm("Hoje", "2026-10-23T22:10:00Z");
      const semPergunta = await sessaoEm("SoIa", "2026-10-23T22:15:00Z");
      for (const s of [ontem, madrugada, hoje]) await mensagem(s, w, "participante", 1);
      await mensagem(semPergunta, w, "ia", 1);

      expect((await db.query<{ d: string }>("select public.turma_atendimento('2026-10-23T08:59:00Z')::text as d")).rows[0].d).toBe("2026-10-22");
      expect((await db.query<{ d: string }>("select public.turma_atendimento('2026-10-23T09:00:00Z')::text as d")).rows[0].d).toBe("2026-10-23");

      const doDia = async (turma: string | null) =>
        (await db.query<{ participante_nome: string }>(`select * from public.conversas_atendimento_turma('${w}', ${turma ? `'${turma}'` : "null"})`)).rows
          .map((r) => r.participante_nome)
          .sort();
      expect(await doDia("2026-10-22")).toEqual(["Madrugada", "Ontem"]);
      expect(await doDia("2026-10-23")).toEqual(["Hoje"]);
      expect(await doDia("2026-10-24")).toEqual([]);
      expect(await doDia(null)).toEqual(["Hoje", "Madrugada", "Ontem"]);

      const { rows: turmas } = await db.query<{ turma: string; conversas: number }>(`select turma::text, conversas from public.turmas_atendimento('${w}')`);
      expect(turmas).toEqual([
        { turma: "2026-10-23", conversas: 1 },
        { turma: "2026-10-22", conversas: 2 },
      ]);

      await db.exec("set role anon");
      await expect(db.query(`select * from public.turmas_atendimento('${w}')`)).rejects.toThrow();
      await expect(db.query(`select * from public.conversas_atendimento_turma('${w}')`)).rejects.toThrow();
      await db.exec("reset role");
    });

    it("metricas_ao_vivo: conta online (sinal ≤ 60 s) ao vivo × replay e desktop × celular, sem teste nem outro webinar", async () => {
      const w = (await db.query<{ id: string }>("insert into webinars (nome, slug) values ('Métricas', 'metricas-e6') returning id")).rows[0].id;
      const casos: [string, string, string][] = [
        ["ao_vivo", "desktop", "now() - interval '5 seconds'"],
        ["ao_vivo", "mobile", "now() - interval '59 seconds'"],
        ["replay", "mobile", "now()"],
        ["teste", "desktop", "now()"],
        ["ao_vivo", "desktop", "now() - interval '2 minutes'"],
      ];
      for (const [modo, dispositivo, sinal] of casos) {
        const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w}', 'X') returning id`);
        await db.exec(
          `insert into sessoes (participante_id, webinar_id, inicio_sessao, modo, dispositivo, ultimo_sinal_em)
           values ('${p.id}', '${w}', now(), '${modo}', '${dispositivo}', ${sinal})`,
        );
      }
      const { rows: [m] } = await db.query(`select * from public.metricas_ao_vivo('${w}')`);
      expect(m).toEqual({ ao_vivo: 2, replay: 1, desktop: 1, mobile: 2 });
      const { rows: [vazio] } = await db.query(`select * from public.metricas_ao_vivo('${outroWebinarId}')`);
      expect(vazio).toEqual({ ao_vivo: 0, replay: 0, desktop: 0, mobile: 0 });
    });
  });

  describe("páginas e teste A/B", () => {
    it("paginas ganha html e css (texto, não nulo, padrão vazio, com limite de tamanho) e atualizado_por", async () => {
      const { rows } = await db.query<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>(
        "select column_name, is_nullable, column_default, data_type from information_schema.columns where table_schema = 'public' and table_name = 'paginas' and column_name in ('html', 'css', 'atualizado_por') order by 1",
      );
      expect(rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
        ["atualizado_por", "uuid", "YES"],
        ["css", "text", "NO"],
        ["html", "text", "NO"],
      ]);
      const { rows: [p] } = await db.query<{ html: string; css: string }>(
        "insert into paginas (nome, tipo, modelo) values ('LP', 'registro_jit', 'registro_form') returning html, css",
      );
      expect(p).toEqual({ html: "", css: "" });
      await expect(db.query(`insert into paginas (nome, tipo, modelo, html) values ('G', 'espera_jit', 'espera_jit', repeat('a', 307201))`)).rejects.toThrow();
      await expect(db.query(`insert into paginas (nome, tipo, modelo, css) values ('G', 'espera_jit', 'espera_jit', repeat('a', 102401))`)).rejects.toThrow();
      await expect(db.query(`insert into paginas (nome, tipo, modelo, html, css) values ('G', 'espera_jit', 'espera_jit', repeat('a', 307200), repeat('a', 102400))`)).resolves.toBeDefined();
    });

    it("atualizado_por aponta para usuarios e vira null quando o usuário sai", async () => {
      const uid = "99999999-0000-0000-0000-000000000011";
      await db.exec(`insert into auth.users (id, email) values ('${uid}', 'pag@x.com')`);
      const { rows: [u] } = await db.query<{ id: string }>(`insert into usuarios (auth_id, nome, email, papel) values ('${uid}', 'Pag', 'pag@x.com', 'admin') returning id`);
      const { rows: [p] } = await db.query<{ id: string }>(
        `insert into paginas (nome, tipo, modelo, atualizado_por) values ('P', 'espera_unica', 'espera_unica', '${u.id}') returning id`,
      );
      await expect(db.query("insert into paginas (nome, tipo, modelo, atualizado_por) values ('P', 'espera_unica', 'espera_unica', gen_random_uuid())")).rejects.toThrow();
      await db.exec(`delete from usuarios where id = '${u.id}'`);
      const { rows: [depois] } = await db.query<{ atualizado_por: string | null }>(`select atualizado_por from paginas where id = '${p.id}'`);
      expect(depois.atualizado_por).toBeNull();
    });

    it("índice de sessoes por teste_ab_id", async () => {
      const { rows } = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'sessoes_teste_ab'");
      expect(rows[0]?.indexdef).toMatch(/\(teste_ab_id, entrou_em\)/);
    });

    it("metricas_teste_ab: funil por variação (na ordem), só sessões do teste, no período, sem modo teste", async () => {
      const novoWebinar = async (slug: string) =>
        (await db.query<{ id: string }>(`insert into webinars (nome, slug) values ('${slug}', '${slug}') returning id`)).rows[0].id;
      const wa = await novoWebinar("ab-var-a");
      const wb = await novoWebinar("ab-var-b");
      const { rows: [t] } = await db.query<{ id: string }>(
        "insert into testes_ab (nome, slug, inicio, fim) values ('AB', 'ab-metricas', '2026-10-01', '2026-10-31') returning id",
      );
      const { rows: [outro] } = await db.query<{ id: string }>(
        "insert into testes_ab (nome, slug, inicio, fim) values ('AB2', 'ab-outro', '2026-10-01', '2026-10-31') returning id",
      );
      // Ordem invertida no insert: a saída vem pela `ordem`, não pela criação.
      await db.exec(`insert into testes_ab_variacoes (teste_id, webinar_id, ordem, percentual) values ('${t.id}', '${wb}', 1, 40), ('${t.id}', '${wa}', 0, 60)`);

      const sessao = async (w: string, teste: string | null, opts: { modo?: string; entrou?: string; max?: number } = {}) => {
        const { rows: [p] } = await db.query<{ id: string }>(`insert into participantes (webinar_id, nome) values ('${w}', 'X') returning id`);
        const { rows: [s] } = await db.query<{ id: string }>(
          `insert into sessoes (participante_id, webinar_id, inicio_sessao, entrou_em, modo, max_segundo, teste_ab_id, variacao_webinar_id)
           values ('${p.id}', '${w}', now(), '${opts.entrou ?? "2026-10-10T12:00:00Z"}', '${opts.modo ?? "ao_vivo"}', ${opts.max ?? 0},
                   ${teste ? `'${teste}'` : "null"}, ${teste ? `'${w}'` : "null"}) returning id`,
        );
        return s.id;
      };
      const ev = async (s: string, w: string, ...tipos: string[]) => {
        for (const tipo of tipos) await db.exec(`insert into eventos (sessao_id, webinar_id, tipo) values ('${s}', '${w}', '${tipo}')`);
      };

      const a1 = await sessao(wa, t.id, { max: 600 });
      await ev(a1, wa, "acessou_sala", "min_15", "pitch", "oferta", "clicou_oferta", "comprou");
      const a2 = await sessao(wa, t.id, { max: 300 });
      await ev(a2, wa, "acessou_sala", "min_15");
      await sessao(wa, t.id); // cadastrou e não entrou
      const b1 = await sessao(wb, t.id, { max: 120 });
      await ev(b1, wb, "acessou_sala");
      // Fora: modo teste, fora do período, sem teste, de outro teste.
      await ev(await sessao(wa, t.id, { modo: "teste", max: 999 }), wa, "acessou_sala", "comprou");
      await ev(await sessao(wa, t.id, { entrou: "2026-11-05T12:00:00Z", max: 999 }), wa, "acessou_sala");
      await ev(await sessao(wa, null, { max: 999 }), wa, "acessou_sala");
      await ev(await sessao(wb, outro.id, { max: 999 }), wb, "acessou_sala");

      await db.exec(
        `insert into vendas (webinar_id, sessao_id, plataforma, id_transacao, valor_centavos, bruto) values
           ('${wa}', '${a1}', 'hotmart', 'ab-1', 49700, '{}'),
           ('${wa}', '${a1}', 'hotmart', 'ab-2', 10000, '{}'),
           ('${wa}', null, 'hotmart', 'ab-3', 99999, '{}')`,
      );

      const { rows: [r] } = await db.query<{ m: unknown }>(
        `select public.metricas_teste_ab('${t.id}', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z') as m`,
      );
      expect(r.m).toEqual({
        variacoes: [
          {
            ordem: 0, webinarId: wa, nome: "ab-var-a", percentual: 60,
            cadastros: 3, acessouSala: 2, min15: 2, pitch: 1, oferta: 1, clicouOferta: 1, comprou: 1,
            vendas: 2, faturamentoCentavos: 59700, tempoMedioSeg: 450,
          },
          {
            ordem: 1, webinarId: wb, nome: "ab-var-b", percentual: 40,
            cadastros: 1, acessouSala: 1, min15: 0, pitch: 0, oferta: 0, clicouOferta: 0, comprou: 0,
            vendas: 0, faturamentoCentavos: 0, tempoMedioSeg: 120,
          },
        ],
      });

      const { rows: [vazio] } = await db.query<{ m: unknown }>(
        `select public.metricas_teste_ab(gen_random_uuid(), '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z') as m`,
      );
      expect(vazio.m).toEqual({ variacoes: [] });
    });

    it("metricas_teste_ab: security invoker, search_path vazio; anon não executa, authenticated sim", async () => {
      const { rows: [f] } = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        "select prosecdef, proconfig from pg_proc where proname = 'metricas_teste_ab'",
      );
      expect(f.prosecdef).toBe(false);
      expect(f.proconfig).toEqual(['search_path=""']);
      const { rows: [g] } = await db.query<{ anon: boolean; auth: boolean; pub: boolean }>(
        `select has_function_privilege('anon', 'public.metricas_teste_ab(uuid, timestamptz, timestamptz)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.metricas_teste_ab(uuid, timestamptz, timestamptz)', 'execute') as auth,
                has_function_privilege('service_role', 'public.metricas_teste_ab(uuid, timestamptz, timestamptz)', 'execute') as pub`,
      );
      expect(g).toEqual({ anon: false, auth: true, pub: true });
    });
  });
  describe("Tarjas de aviso", () => {
    async function webinarNovo(slug: string): Promise<string> {
      const { rows: [w] } = await db.query<{ id: string }>(`insert into webinars (nome, slug) values ('Tarjas', '${slug}') returning id`);
      return w.id;
    }

    it("colunas, padrões (15 s, topo, vermelho, ligada) e índice por (webinar_id, aparece_seg)", async () => {
      const w = await webinarNovo("tarjas-padroes");
      const { rows: [t] } = await db.query<Record<string, unknown>>(
        `insert into tarjas_aviso (webinar_id, texto, aparece_seg) values ('${w}', 'Não saia!', 2) returning *`,
      );
      expect(t).toMatchObject({ texto: "Não saia!", aparece_seg: 2, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true });
      const { rows: idx } = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'tarjas_aviso_webinar_aparece'");
      expect(idx[0]?.indexdef).toMatch(/\(webinar_id, aparece_seg\)/);
    });

    it("checks: texto 1–120, aparece ≥ 0, duração 3–600, posição e cor das listas", async () => {
      const w = await webinarNovo("tarjas-checks");
      const ins = (cols: string, vals: string) => db.exec(`insert into tarjas_aviso (webinar_id, ${cols}) values ('${w}', ${vals})`);
      await expect(ins("texto, aparece_seg", "'', 0")).rejects.toThrow();
      await expect(ins("texto, aparece_seg", `'${"a".repeat(121)}', 0`)).rejects.toThrow();
      await expect(ins("texto, aparece_seg", `'${"a".repeat(120)}', 0`)).resolves.not.toThrow();
      await expect(ins("texto, aparece_seg", "'x', -1")).rejects.toThrow();
      await expect(ins("texto, aparece_seg, duracao_seg", "'x', 0, 2")).rejects.toThrow();
      await expect(ins("texto, aparece_seg, duracao_seg", "'x', 0, 601")).rejects.toThrow();
      await expect(ins("texto, aparece_seg, duracao_seg", "'x', 0, 600")).resolves.not.toThrow();
      await expect(ins("texto, aparece_seg, posicao", "'x', 0, 'meio'")).rejects.toThrow();
      await expect(ins("texto, aparece_seg, posicao", "'x', 0, 'base'")).resolves.not.toThrow();
      await expect(ins("texto, aparece_seg, cor", "'x', 0, 'azul'")).rejects.toThrow();
      for (const cor of ["vermelho", "amarelo", "verde", "preto"]) {
        await expect(ins("texto, aparece_seg, cor", `'x', 0, '${cor}'`)).resolves.not.toThrow();
      }
    });

    it("updated_at pelo trigger e cascata ao apagar o webinar", async () => {
      const w = await webinarNovo("tarjas-cascata");
      await db.exec(`insert into tarjas_aviso (webinar_id, texto, aparece_seg) values ('${w}', 'x', 0)`);
      await db.exec(`update tarjas_aviso set updated_at = now() - interval '1 day' where webinar_id = '${w}'`);
      const { rows: [u] } = await db.query<{ recente: boolean }>(
        `select updated_at > now() - interval '1 minute' as recente from tarjas_aviso where webinar_id = '${w}'`,
      );
      expect(u.recente).toBe(true);
      await db.exec(`delete from webinars where id = '${w}'`);
      const { rows } = await db.query(`select id from tarjas_aviso where webinar_id = '${w}'`);
      expect(rows).toEqual([]);
    });

    it("RLS: admin_tudo com (select eh_admin()) e equipe_le com (select eh_membro())", async () => {
      const { rows } = await db.query<{ policyname: string; cmd: string; qual: string; with_check: string | null }>(
        "select policyname, cmd, qual, with_check from pg_policies where tablename = 'tarjas_aviso' order by policyname",
      );
      expect(rows.map((r) => [r.policyname, r.cmd])).toEqual([
        ["admin_tudo", "ALL"],
        ["equipe_le", "SELECT"],
      ]);
      expect(rows[0].qual).toMatch(/SELECT eh_admin\(\)/i);
      expect(rows[0].with_check).toMatch(/SELECT eh_admin\(\)/i);
      expect(rows[1].qual).toMatch(/SELECT eh_membro\(\)/i);
      const { rows: [rls] } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'tarjas_aviso'");
      expect(rls.relrowsecurity).toBe(true);
    });

    it("RLS em comportamento: atendente lê e não escreve; admin escreve", async () => {
      const w = await webinarNovo("tarjas-rls");
      await db.exec(`insert into tarjas_aviso (webinar_id, texto, aparece_seg) values ('${w}', 'Lida', 0)`);
      // Mesmos usuários do bloco "RLS em comportamento" (já existem: o beforeAll de lá rodou antes).
      await db.exec("grant all on public.tarjas_aviso to authenticated");
      await db.exec("set role authenticated");
      try {
        await db.exec("set app.uid = '22222222-2222-2222-2222-222222222222'");
        const { rows } = await db.query(`select id from tarjas_aviso where webinar_id = '${w}'`);
        expect(rows).toHaveLength(1);
        await expect(db.exec(`insert into tarjas_aviso (webinar_id, texto, aparece_seg) values ('${w}', 'Atendente', 0)`)).rejects.toThrow();

        await db.exec("set app.uid = '11111111-1111-1111-1111-111111111111'");
        await expect(db.exec(`insert into tarjas_aviso (webinar_id, texto, aparece_seg) values ('${w}', 'Admin', 0)`)).resolves.not.toThrow();

        await db.exec("set app.uid = '33333333-3333-3333-3333-333333333333'");
        const { rows: nada } = await db.query(`select id from tarjas_aviso where webinar_id = '${w}'`);
        expect(nada).toEqual([]);
      } finally {
        await db.exec("reset role");
      }
    });
  });
});

describe("chaves do MCP", () => {
  it("api_registrar_uso soma as chamadas do minuto e marca o último uso", async () => {
    const auth = "00000000-0000-0000-0000-0000000000a1";
    await db.query("insert into auth.users (id, email) values ($1, 'mcp@x.com')", [auth]);
    const { rows: u } = await db.query<{ id: string }>("insert into public.usuarios (auth_id, nome, email, papel) values ($1, 'Admin', 'mcp@x.com', 'admin') returning id", [auth]);
    const { rows: c } = await db.query<{ id: string }>(
      "insert into public.chaves_api (nome, permissao, prefixo, hash, criada_por) values ('Claude', 'escrita', 'abcdefgh', 'hash-1', $1) returning id",
      [u[0].id],
    );
    const id = c[0].id;
    const um = await db.query<{ api_registrar_uso: number }>("select public.api_registrar_uso($1)", [id]);
    const dois = await db.query<{ api_registrar_uso: number }>("select public.api_registrar_uso($1)", [id]);
    expect(um.rows[0].api_registrar_uso).toBe(1);
    expect(dois.rows[0].api_registrar_uso).toBe(2);
    const { rows } = await db.query<{ ultimo_uso: string | null }>("select ultimo_uso from public.chaves_api where id = $1", [id]);
    expect(rows[0].ultimo_uso).not.toBeNull();
  });

  it("permissão só aceita leitura ou escrita", async () => {
    await expect(db.query("insert into public.chaves_api (nome, permissao, prefixo, hash) values ('x', 'envio', 'p', 'hash-2')")).rejects.toThrow();
  });
});
