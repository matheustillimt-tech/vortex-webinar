import { describe, expect, it } from "vitest";
import {
  agendaDeEmails,
  modelosPadrao,
  remetenteEmail,
  renderizarEmail,
  TIPOS_EMAIL,
  varsEmail,
  type VarsEmail,
} from "@/src/lib/regras/emails";
import { validarEmailJit } from "@/src/lib/regras/jit-form";

const vars: VarsEmail = {
  nome: "Ana",
  webinar: "Aula de IA",
  data: "segunda-feira, 2 de novembro",
  hora: "20:00",
  link: "https://sala.exemplo.com/aula?acesso=abc.def",
  minutos: "60",
};

describe("modelosPadrao", () => {
  it("tem os 3 tipos em pt-BR, válidos pelo validador do painel", () => {
    const m = modelosPadrao("pt-BR");
    expect(Object.keys(m).sort()).toEqual([...TIPOS_EMAIL].sort());
    for (const tipo of TIPOS_EMAIL) {
      const r = validarEmailJit({
        tipo,
        remetente_nome: m[tipo].remetenteNome,
        assunto: m[tipo].assunto,
        texto: m[tipo].texto,
        minutos_antes: m[tipo].minutosAntes === null ? undefined : String(m[tipo].minutosAntes),
      });
      expect("dados" in r).toBe(true);
      expect(m[tipo].texto).toContain("{{link}}");
    }
    expect(m.lembrete.minutosAntes).toBe(60);
    expect(m.inscricao.minutosAntes).toBeNull();
    expect(m.inscricao.assunto).toMatch(/inscrição/i);
  });

  it("outros idiomas também devolvem os 3 tipos", () => {
    expect(Object.keys(modelosPadrao("en")).sort()).toEqual([...TIPOS_EMAIL].sort());
    expect(Object.keys(modelosPadrao("es")).sort()).toEqual([...TIPOS_EMAIL].sort());
  });
});

describe("renderizarEmail", () => {
  it("substitui as variáveis no assunto e no texto", () => {
    const r = renderizarEmail({ assunto: "{{nome}}, começa às {{hora}}", texto: "Oi {{ nome }}, {{webinar}} em {{data}} ({{minutos}} min)." }, vars);
    expect(r.assunto).toBe("Ana, começa às 20:00");
    expect(r.texto).toContain("Oi Ana, Aula de IA em segunda-feira, 2 de novembro (60 min).");
    expect(r.html).toContain("Oi Ana, Aula de IA em segunda-feira, 2 de novembro (60 min).");
  });

  it("escapa HTML dos valores e do texto", () => {
    const r = renderizarEmail({ assunto: "Oi {{nome}}", texto: "Olá {{nome}} <b>negrito</b> & cia" }, { ...vars, nome: '<script>alert("x")</script>' });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(r.html).toContain("&lt;b&gt;negrito&lt;/b&gt; &amp; cia");
    // Assunto e texto puro não são HTML: ficam como estão.
    expect(r.assunto).toBe('Oi <script>alert("x")</script>');
    expect(r.texto).toContain('<script>alert("x")</script>');
  });

  it("parágrafos viram <p> e quebra simples vira <br>", () => {
    const r = renderizarEmail({ assunto: "a", texto: "linha 1\nlinha 2\n\n\nparágrafo 2" }, vars);
    expect(r.html).toContain("linha 1<br>linha 2</p>");
    expect(r.html).toContain("parágrafo 2</p>");
    expect(r.html.match(/<p[ >]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("botão 'Acessar o webinar' com o link (escapado no href) e link no texto puro", () => {
    const r = renderizarEmail({ assunto: "a", texto: "Entre: {{link}}" }, { ...vars, link: "https://sala.exemplo.com/aula?acesso=a&b=1" });
    expect(r.html).toContain('href="https://sala.exemplo.com/aula?acesso=a&amp;b=1"');
    expect(r.html).toContain("Acessar o webinar");
    expect(r.texto).toContain("Entre: https://sala.exemplo.com/aula?acesso=a&b=1");
    expect(r.texto).toContain("Acessar o webinar: https://sala.exemplo.com/aula?acesso=a&b=1");
  });

  it("link que não é http/https: sem botão e {{link}} vazio", () => {
    const r = renderizarEmail({ assunto: "a", texto: "Entre: {{link}}" }, { ...vars, link: "javascript:alert(1)" });
    expect(r.html).not.toContain("javascript:");
    expect(r.html).not.toContain("Acessar o webinar");
    expect(r.texto).not.toContain("javascript:");
    expect(r.texto).not.toContain("Acessar o webinar");
  });

  it("variável desconhecida fica como está; assunto sem quebra de linha e cortado em 150", () => {
    const r = renderizarEmail({ assunto: "{{nome}}\n{{outra}}", texto: "{{outra}}" }, vars);
    expect(r.assunto).toBe("Ana {{outra}}");
    expect(r.texto).toContain("{{outra}}");
    const longo = renderizarEmail({ assunto: "{{nome}}".repeat(10) + "x".repeat(150), texto: "t" }, vars);
    expect(longo.assunto.length).toBe(150);
  });

  it("layout é um documento HTML completo", () => {
    const r = renderizarEmail({ assunto: "a", texto: "t" }, vars);
    expect(r.html.startsWith("<!doctype html>")).toBe(true);
    expect(r.html).toContain("</html>");
  });
});

describe("agendaDeEmails", () => {
  const jit = new Date("2026-11-02T23:00:00Z");

  it("com tempo de sobra: inscrição agora, lembrete X min antes e começando no horário", () => {
    const agora = new Date("2026-11-02T12:00:00Z");
    expect(agendaDeEmails(jit, agora, 60)).toEqual([
      { tipo: "inscricao", enviarEm: agora },
      { tipo: "lembrete", enviarEm: new Date("2026-11-02T22:00:00Z") },
      { tipo: "comecando", enviarEm: jit },
    ]);
  });

  it("faltando menos que os minutos do lembrete: sem lembrete", () => {
    const agora = new Date("2026-11-02T22:30:00Z");
    expect(agendaDeEmails(jit, agora, 60).map((x) => x.tipo)).toEqual(["inscricao", "comecando"]);
  });

  it("faltando exatamente os minutos do lembrete: sem lembrete (já seria agora, junto da inscrição)", () => {
    expect(agendaDeEmails(jit, new Date("2026-11-02T22:00:00Z"), 60).map((x) => x.tipo)).toEqual(["inscricao", "comecando"]);
  });

  it("horário já começou: só a inscrição", () => {
    expect(agendaDeEmails(jit, jit, 60).map((x) => x.tipo)).toEqual(["inscricao"]);
  });

  it("lembrete null ou ≤ 0: sem lembrete", () => {
    const agora = new Date("2026-11-02T12:00:00Z");
    expect(agendaDeEmails(jit, agora, null).map((x) => x.tipo)).toEqual(["inscricao", "comecando"]);
    expect(agendaDeEmails(jit, agora, 0).map((x) => x.tipo)).toEqual(["inscricao", "comecando"]);
  });
});

describe("varsEmail", () => {
  it("data por extenso e hora no fuso", () => {
    const v = varsEmail({
      nome: "Ana",
      webinar: "Aula",
      jitHorario: new Date("2026-11-02T23:00:00Z"),
      fuso: "America/Sao_Paulo",
      link: "https://x.com",
      minutos: 60,
    });
    expect(v).toEqual({ nome: "Ana", webinar: "Aula", data: "segunda-feira, 2 de novembro", hora: "20:00", link: "https://x.com", minutos: "60" });
  });

  it("fuso 'participante' ou inválido cai em Brasília", () => {
    const v = varsEmail({ nome: "A", webinar: "W", jitHorario: new Date("2026-11-02T23:00:00Z"), fuso: "participante", link: "", minutos: null });
    expect(v.hora).toBe("20:00");
    expect(v.minutos).toBe("");
  });
});

describe("varsEmail: indicação do fuso", () => {
  const base = { nome: "Ana", webinar: "Aula", link: "https://x.com", minutos: null, idioma: "pt-BR" as const };
  it("Brasília (ou 'participante' sem fuso): só HH:mm", () => {
    const d = new Date("2026-11-03T23:00:00Z");
    expect(varsEmail({ ...base, jitHorario: d, fuso: "America/Sao_Paulo" }).hora).toBe("20:00");
    expect(varsEmail({ ...base, jitHorario: d, fuso: "participante" }).hora).toBe("20:00");
  });
  it("outro fuso: cidade e GMT do dia (horário de verão incluído)", () => {
    expect(varsEmail({ ...base, jitHorario: new Date("2026-11-03T23:00:00Z"), fuso: "Europe/Lisbon" }).hora).toBe("23:00 (Lisbon, GMT+0)");
    expect(varsEmail({ ...base, jitHorario: new Date("2026-07-03T23:00:00Z"), fuso: "Europe/Lisbon" }).hora).toBe("00:00 (Lisbon, GMT+1)");
    expect(varsEmail({ ...base, jitHorario: new Date("2026-11-03T23:00:00Z"), fuso: "America/New_York" }).hora).toBe("18:00 (New York, GMT-5)");
  });
});

describe("remetenteEmail", () => {
  it("monta 'Nome <email>'", () => {
    expect(remetenteEmail("Vórtex", "aulas@exemplo.com.br")).toBe("Vórtex <aulas@exemplo.com.br>");
  });
  it("EMAIL_FROM já no formato 'Nome <email>': usa só o endereço", () => {
    expect(remetenteEmail("Paula", "Outro <aulas@exemplo.com.br>")).toBe("Paula <aulas@exemplo.com.br>");
  });
  it("tira caracteres de cabeçalho do nome; nome vazio vira só o endereço", () => {
    expect(remetenteEmail('A<b>"c\r\nd', "x@y.com")).toBe("Abc d <x@y.com>");
    expect(remetenteEmail("  ", "x@y.com")).toBe("x@y.com");
  });
  it("nome com vírgula, ponto ou parênteses vai entre aspas (senão vira outro endereço no From)", () => {
    expect(remetenteEmail("Vórtex, Aulas", "x@y.com")).toBe('"Vórtex, Aulas" <x@y.com>');
    expect(remetenteEmail("Dr. Ana (IA)", "x@y.com")).toBe('"Dr. Ana (IA)" <x@y.com>');
    expect(remetenteEmail("Ana\\Bia, IA", "x@y.com")).toBe('"AnaBia, IA" <x@y.com>');
  });
});
