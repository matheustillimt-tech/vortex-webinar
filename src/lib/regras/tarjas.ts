import { formatarDuracao, lerDuracao } from "./video";

// Tarja de aviso: faixa sobre o vídeo da sala com um aviso de retenção ("Nós vamos fechar a sala, não saia dela!").
// Regras puras: validação do formulário do painel e qual tarja aparece num segundo do vídeo.

export type PosicaoTarja = "topo" | "base";
export type CorTarja = "vermelho" | "amarelo" | "verde" | "preto";

export const POSICOES_TARJA: PosicaoTarja[] = ["topo", "base"];
export const CORES_TARJA: CorTarja[] = ["vermelho", "amarelo", "verde", "preto"];

export const TEXTO_TARJA_MAX = 120;
export const DURACAO_TARJA_MIN = 3;
export const DURACAO_TARJA_MAX = 600;
export const DURACAO_TARJA_PADRAO = 15;
export const LIMITE_TARJAS = 20;

/** Fundo e texto de cada cor na sala (amarelo com texto preto pra ter contraste). */
export const ESTILO_COR_TARJA: Record<CorTarja, { fundo: string; texto: string; rotulo: string }> = {
  vermelho: { fundo: "#DC2626", texto: "#FFFFFF", rotulo: "Vermelho" },
  amarelo: { fundo: "#F59E0B", texto: "#000000", rotulo: "Amarelo" },
  verde: { fundo: "#0A8452", texto: "#FFFFFF", rotulo: "Verde" },
  preto: { fundo: "#111827", texto: "#FFFFFF", rotulo: "Preto" },
};

export type DadosTarja = { texto: string; apareceSeg: number; duracaoSeg: number; posicao: PosicaoTarja; cor: CorTarja; ligada: boolean };

type Campos = Record<string, string | undefined>;

/** "Aparece em": h:mm:ss ou m:ss (o mesmo parser do chat e da oferta) ou só os segundos ("2"). */
export function lerMomentoTarja(texto: string): number | null {
  const t = texto.trim();
  if (/^\d+$/.test(t)) return Number(t);
  return lerDuracao(t);
}

/** Valida o formulário da tarja. `duracaoVideoSeg`: duração do vídeo do webinar (quando houver, o momento tem que
 *  cair dentro dele). O texto vira uma linha só (a tarja não tem quebra manual). */
export function validarTarja(c: Campos, duracaoVideoSeg: number | null): { erro: string } | { dados: DadosTarja } {
  const texto = (c.texto ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return { erro: "Escreva o texto da tarja." };
  if (texto.length > TEXTO_TARJA_MAX) return { erro: `Use até ${TEXTO_TARJA_MAX} caracteres.` };

  const momento = (c.aparece ?? "").trim();
  const apareceSeg = momento ? lerMomentoTarja(momento) : null;
  if (apareceSeg === null) return { erro: "Informe quando a tarja aparece (h:mm:ss)." };
  if (duracaoVideoSeg && duracaoVideoSeg > 0 && apareceSeg >= duracaoVideoSeg) {
    return { erro: `O vídeo tem ${formatarDuracao(duracaoVideoSeg)}: escolha um momento antes do fim.` };
  }

  const duracaoTexto = (c.duracao_seg ?? "").trim();
  const duracaoSeg = duracaoTexto ? Number(duracaoTexto) : DURACAO_TARJA_PADRAO;
  if (!/^\d*$/.test(duracaoTexto) || duracaoSeg < DURACAO_TARJA_MIN || duracaoSeg > DURACAO_TARJA_MAX) {
    return { erro: `A duração vai de ${DURACAO_TARJA_MIN} a ${DURACAO_TARJA_MAX} segundos.` };
  }

  const posicao = (c.posicao ?? "topo") as PosicaoTarja;
  if (!POSICOES_TARJA.includes(posicao)) return { erro: "Escolha a posição da tarja." };

  const cor = (c.cor ?? "vermelho") as CorTarja;
  if (!CORES_TARJA.includes(cor)) return { erro: "Escolha a cor da tarja." };

  // Formulário sem o campo "ligada" (o modal não tem): nasce ligada. Com o campo, vale o "on" do checkbox.
  const ligada = c.ligada === undefined ? true : c.ligada === "on";

  return { dados: { texto, apareceSeg, duracaoSeg, posicao, cor, ligada } };
}

/** Tarja visível no `segundo` do vídeo: `aparece <= segundo < aparece + duração`. Se duas se cruzam, vale a que
 *  apareceu por último (a mais nova cobre a anterior). */
export function tarjaAtiva<T extends { apareceSeg: number; duracaoSeg: number }>(tarjas: T[], segundo: number): T | null {
  let ativa: T | null = null;
  for (const t of tarjas) {
    if (segundo >= t.apareceSeg && segundo < t.apareceSeg + t.duracaoSeg) {
      if (!ativa || t.apareceSeg >= ativa.apareceSeg) ativa = t;
    }
  }
  return ativa;
}

/** h:mm:ss sempre com as horas (como os momentos do chat e da oferta no painel). */
export function formatarMomentoTarja(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
