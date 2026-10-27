// Itens do chat: nome 14,5 px / 600 cinza #9CA3AF e
// texto 13 px / 500 quase preto; a própria mensagem com o nome na cor de marca + "(Eu)"; mensagem simulada de
// suporte numa faixa na cor de marca com o nome em negrito; venda simulada numa faixa amarela. Resposta da IA ou do
// atendente à pessoa: a mesma faixa da equipe, começando com `@Nome` (`mencao`).
// `live`: sala vertical (formato Live), com o vídeo em tela cheia por trás — texto branco com sombra, sem fundo.

export type TipoMensagem = "normal" | "eu" | "destaque";

const URL_NO_TEXTO = /(https?:\/\/[^\s<>"']+)/g;

/** Links `http(s)` do texto viram clicáveis (nova aba, sem `opener`); o resto fica como texto puro. */
function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(URL_NO_TEXTO);
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <a key={i} href={parte} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
            {parte}
          </a>
        ) : (
          parte
        ),
      )}
    </>
  );
}

export function ItemMensagem({
  nome,
  texto,
  imagemUrl,
  tipo,
  apagada,
  textoApagada,
  mencao,
  live,
}: {
  nome: string;
  texto: string | null;
  imagemUrl: string | null;
  tipo: TipoMensagem;
  apagada?: boolean;
  textoApagada?: string;
  /** Nome de quem está sendo respondido: aparece como `@Nome` em destaque antes do texto. */
  mencao?: string;
  live: boolean;
}) {
  const corpo = apagada ? (
    <span className="italic opacity-70">{textoApagada}</span>
  ) : (
    <>
      {mencao && (
        <span className={`mr-1 font-bold ${tipo === "destaque" ? "text-white underline underline-offset-2" : live ? "text-[#86D9B0]" : "text-marca"}`}>@{mencao}</span>
      )}
      {texto && <TextoComLinks texto={texto} />}
      {imagemUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagemUrl} alt="" className="mt-1.5 max-h-60 max-w-[70%] rounded-md object-contain" />
      )}
    </>
  );

  if (live) {
    const destaque = tipo === "destaque";
    return (
      <div className={`text-[13px] leading-5 font-medium break-words text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)] ${destaque ? "rounded-md bg-marca/90 px-2.5 py-1.5 [text-shadow:none]" : ""}`}>
        <span className={`mr-1 font-semibold ${tipo === "eu" ? "text-[#86D9B0]" : destaque ? "text-white" : "text-white/75"}`}>{nome}</span>
        {corpo}
      </div>
    );
  }

  if (tipo === "destaque") {
    return (
      <div className="rounded-md bg-marca px-3 py-2 text-white">
        <p className="text-[14.5px] leading-5 font-bold">{nome}</p>
        <div className="text-[13px] leading-5 font-medium break-words">{corpo}</div>
      </div>
    );
  }

  return (
    <div className="px-1">
      <p className={`text-[14.5px] leading-5 font-semibold ${tipo === "eu" ? "text-marca" : "text-[#9CA3AF]"}`}>{nome}</p>
      <div className="text-[13px] leading-5 font-medium break-words text-[rgb(2_2_2/0.92)]">{corpo}</div>
    </div>
  );
}

/** Venda simulada no chat: faixa amarela com o texto da venda. */
export function FaixaVenda({ texto, live }: { texto: string; live: boolean }) {
  return (
    <div
      className={
        live
          ? "rounded-md bg-[#FACC15]/90 px-2.5 py-1.5 text-[13px] leading-5 font-semibold break-words text-[#422006]"
          : "rounded-md border border-[#FDE68A] bg-[#FEF9C3] px-3 py-2 text-[13px] leading-5 font-semibold break-words text-[#854D0E]"
      }
    >
      {texto}
    </div>
  );
}
