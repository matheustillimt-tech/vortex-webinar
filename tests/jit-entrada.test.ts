import { describe, expect, it } from "vitest";
import { decidirEntradaJit, escolherHorarioJit, expCookieJit, type EntradaJit } from "@/src/lib/regras/sala";
import {
  assinarToken,
  criarTokenAcesso,
  expTokenAcesso,
  linkDeAcesso,
  verificarToken,
  verificarTokenAcesso,
} from "@/src/lib/regras/sessao-token";
import { decidirRota } from "@/src/lib/regras/rota";
import { gatilhosDoEvento } from "@/src/lib/regras/regras-webhook";
import { gerarIcs } from "@/src/lib/regras/ics";
import { formatarHorarioJit, proximosHorariosJit, type ConfigJit } from "@/src/lib/regras/jit";
import { t } from "@/src/lib/regras/textos-sala";

const jit = new Date("2026-11-02T23:00:00Z");
const em = (min: number) => new Date(jit.getTime() + min * 60_000);

const BASE: EntradaJit = {
  webinarAtivo: true,
  temVideo: true,
  teste: false,
  replay: false,
  sessao: { modo: "ao_vivo", jitHorario: jit },
  duracaoSeg: 3600,
  agora: em(0),
};

describe("decidirEntradaJit", () => {
  it("webinar arquivado ou sem vídeo: indisponível", () => {
    expect(decidirEntradaJit({ ...BASE, webinarAtivo: false })).toBe("indisponivel");
    expect(decidirEntradaJit({ ...BASE, temVideo: false })).toBe("indisponivel");
  });

  it("sem sessão: página de inscrição", () => {
    expect(decidirEntradaJit({ ...BASE, sessao: null })).toBe("lp");
    expect(decidirEntradaJit({ ...BASE, sessao: null, replay: true })).toBe("lp");
  });

  it("sessão sem horário escolhido (ex.: de antes de virar JIT): página de inscrição", () => {
    expect(decidirEntradaJit({ ...BASE, sessao: { modo: "ao_vivo", jitHorario: null } })).toBe("lp");
  });

  it("janela do horário escolhido: espera antes, sala durante, encerrada depois", () => {
    expect(decidirEntradaJit({ ...BASE, agora: em(-30) })).toBe("espera");
    expect(decidirEntradaJit({ ...BASE, agora: em(-5) })).toBe("espera");
    expect(decidirEntradaJit({ ...BASE, agora: em(0) })).toBe("sala");
    expect(decidirEntradaJit({ ...BASE, agora: em(59) })).toBe("sala");
    expect(decidirEntradaJit({ ...BASE, agora: em(60) })).toBe("encerrada");
  });

  it("sem duração do vídeo: janela de 2 h", () => {
    expect(decidirEntradaJit({ ...BASE, duracaoSeg: null, agora: em(119) })).toBe("sala");
    expect(decidirEntradaJit({ ...BASE, duracaoSeg: null, agora: em(120) })).toBe("encerrada");
  });

  it("teste do Pronto e replay furam a janela", () => {
    expect(decidirEntradaJit({ ...BASE, teste: true, sessao: null })).toBe("criar_sessao_teste");
    expect(decidirEntradaJit({ ...BASE, replay: true, agora: em(600) })).toBe("sala");
    expect(decidirEntradaJit({ ...BASE, sessao: { modo: "replay", jitHorario: jit }, agora: em(600) })).toBe("sala");
    expect(decidirEntradaJit({ ...BASE, sessao: { modo: "teste", jitHorario: jit }, agora: em(-600) })).toBe("lp");
  });
});

describe("escolherHorarioJit", () => {
  const oferecidos = [em(60), em(120), em(180)];

  it("aceita um horário que está na lista oferecida agora", () => {
    expect(escolherHorarioJit(oferecidos, em(120).toISOString(), "todos")).toEqual(em(120));
  });

  it("horário fora da lista (passou, forjado, inválido): null", () => {
    expect(escolherHorarioJit(oferecidos, em(0).toISOString(), "todos")).toBeNull();
    expect(escolherHorarioJit(oferecidos, em(61).toISOString(), "todos")).toBeNull();
    expect(escolherHorarioJit(oferecidos, "amanhã", "todos")).toBeNull();
    expect(escolherHorarioJit(oferecidos, "", "proximo")).toBeNull();
  });

  it("entrar_direto: sem escolha, usa o próximo", () => {
    expect(escolherHorarioJit(oferecidos, "", "entrar_direto")).toEqual(em(60));
    expect(escolherHorarioJit([], "", "entrar_direto")).toBeNull();
  });

  it("recalculado com a configuração atual: horário que já passou não é aceito", () => {
    const cfg: ConfigJit = { fuso: "America/Sao_Paulo", esconderDe: null, esconderAte: null, fim: null, exibicao: "todos" };
    const horarios = [{ quando: "todo_dia" as const, hora: "20:00", intervaloMin: null, data: null, diaSemana: null }];
    const agora = new Date("2026-11-02T23:00:30Z"); // 20:00:30 em Brasília: o das 20:00 de hoje já passou
    const lista = proximosHorariosJit(horarios, cfg, agora);
    expect(escolherHorarioJit(lista, "2026-11-02T23:00:00.000Z", "todos")).toBeNull();
    expect(escolherHorarioJit(lista, "2026-11-03T23:00:00.000Z", "todos")).toEqual(new Date("2026-11-03T23:00:00Z"));
  });

  it("texto do erro nos 3 idiomas", () => {
    expect(t("pt-BR", "horarioIndisponivel")).toBe("Esse horário não está mais disponível.");
    expect(t("es", "horarioIndisponivel")).toBe("Ese horario ya no está disponible.");
    expect(t("en", "horarioIndisponivel")).toBe("That time is no longer available.");
  });
});

describe("expCookieJit", () => {
  const seg = (d: Date) => Math.floor(d.getTime() / 1000);

  it("vale até 12 h depois do fim da sessão escolhida", () => {
    expect(expCookieJit(jit, 3600, em(-3 * 24 * 60))).toBe(seg(em(60)) + 12 * 3600);
  });

  it("nunca menos que 12 h a partir de agora", () => {
    expect(expCookieJit(jit, 3600, em(600))).toBe(seg(em(600)) + 12 * 3600);
  });
});

describe("token de acesso (link do e-mail)", () => {
  const SEGREDO = "segredo-teste";
  const agoraSeg = Math.floor(Date.now() / 1000);

  it("válido: devolve sessão, webinar e expiração", () => {
    const token = criarTokenAcesso({ s: "sess-1", w: "web-1", exp: agoraSeg + 60 }, SEGREDO);
    expect(verificarTokenAcesso(token, SEGREDO, agoraSeg)).toEqual({ s: "sess-1", w: "web-1", exp: agoraSeg + 60 });
  });

  it("expirado: null", () => {
    const token = criarTokenAcesso({ s: "sess-1", w: "web-1", exp: agoraSeg - 1 }, SEGREDO);
    expect(verificarTokenAcesso(token, SEGREDO, agoraSeg)).toBeNull();
  });

  it("de outro webinar: o `w` do token é o outro (quem chama compara com o webinar da sala)", () => {
    const token = criarTokenAcesso({ s: "sess-1", w: "web-2", exp: agoraSeg + 60 }, SEGREDO);
    expect(verificarTokenAcesso(token, SEGREDO, agoraSeg)?.w).toBe("web-2");
  });

  it("assinatura adulterada ou outro segredo: null", () => {
    const token = criarTokenAcesso({ s: "sess-1", w: "web-1", exp: agoraSeg + 60 }, SEGREDO);
    expect(verificarTokenAcesso(token, "outro", agoraSeg)).toBeNull();
    const [dados] = token.split(".");
    const outro = Buffer.from(JSON.stringify({ s: "sess-2", w: "web-1", exp: agoraSeg + 60 })).toString("base64url");
    expect(verificarTokenAcesso(`${outro}.${token.split(".")[1]}`, SEGREDO, agoraSeg)).toBeNull();
    expect(verificarTokenAcesso(`${dados}.`, SEGREDO, agoraSeg)).toBeNull();
    expect(verificarTokenAcesso("lixo", SEGREDO, agoraSeg)).toBeNull();
  });

  it("token do cookie não vale como acesso, e o de acesso não vale como cookie", () => {
    const cookie = assinarToken({ s: "sess-1", w: "web-1", exp: agoraSeg + 60 }, SEGREDO);
    expect(verificarToken(cookie, SEGREDO, agoraSeg)).not.toBeNull();
    expect(verificarTokenAcesso(cookie, SEGREDO, agoraSeg)).toBeNull();
    const acesso = criarTokenAcesso({ s: "sess-1", w: "web-1", exp: agoraSeg + 60 }, SEGREDO);
    expect(verificarToken(acesso, SEGREDO, agoraSeg)).toBeNull();
  });

  it("expira 12 h depois do horário escolhido", () => {
    expect(expTokenAcesso(jit)).toBe(Math.floor(jit.getTime() / 1000) + 12 * 3600);
  });

  it("link: <SALA_URL>/<slug>?acesso=<token>", () => {
    expect(linkDeAcesso("https://aovivo.exemplo.com/", "turma-1", "abc.def")).toBe("https://aovivo.exemplo.com/turma-1?acesso=abc.def");
  });
});

describe("rotas do JIT no domínio da sala", () => {
  it("/<slug>/lp e /<slug>/inscrito são servidas pela sala", () => {
    const cfg = { hostSala: "aovivo.exemplo.com" };
    expect(decidirRota("aovivo.exemplo.com", "/turma-1/lp", cfg)).toEqual({ tipo: "sala", caminho: "/s/turma-1/lp" });
    expect(decidirRota("aovivo.exemplo.com", "/turma-1/inscrito", cfg)).toEqual({ tipo: "sala", caminho: "/s/turma-1/inscrito" });
  });
});

describe("gatilhosDoEvento", () => {
  it("inscreveu_lp dispara as regras de inscrição na página", () => {
    expect(gatilhosDoEvento("inscreveu_lp")).toEqual(["inscreveu_lp"]);
  });
});

describe("formatarHorarioJit", () => {
  it("data por extenso e hora no fuso", () => {
    expect(formatarHorarioJit(jit, "America/Sao_Paulo", "pt-BR")).toEqual({ data: "segunda-feira, 2 de novembro", hora: "20:00" });
    expect(formatarHorarioJit(jit, "Europe/Lisbon", "en")).toEqual({ data: "Monday, November 2", hora: "23:00" });
  });

  it("'participante' ou fuso inválido: Brasília", () => {
    expect(formatarHorarioJit(jit, "participante").hora).toBe("20:00");
    expect(formatarHorarioJit(jit, "Marte/Base").hora).toBe("20:00");
  });
});

describe("gerarIcs", () => {
  it("evento com início, fim, título e link (texto escapado)", () => {
    const ics = gerarIcs({
      titulo: "Aula, ao vivo; parte 1",
      inicio: jit,
      fim: em(60),
      link: "https://aovivo.exemplo.com/turma-1?acesso=a.b",
      uid: "vw-1@vortexwebinar",
      agora: new Date("2026-11-01T10:00:00.123Z"),
    });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261102T230000Z\r\n");
    expect(ics).toContain("DTEND:20261103T000000Z\r\n");
    expect(ics).toContain("DTSTAMP:20261101T100000Z\r\n");
    expect(ics).toContain("SUMMARY:Aula\\, ao vivo\\; parte 1\r\n");
    expect(ics).toContain("URL:https://aovivo.exemplo.com/turma-1?acesso=a.b\r\n");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
