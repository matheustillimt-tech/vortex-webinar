"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatarHorarioJit, proximosHorariosJit } from "@/src/lib/regras/jit";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaTelaLogin } from "@/src/lib/sala/dados";
import { inscrever, type ResultadoInscricao } from "./actions";
import { configDeSerial, horariosDeSerial, type ConfigJitSerial, type HorarioJitSerial } from "../_jit/serial";
import { fusoDoNavegador, useFusoAplicado } from "../_jit/fuso";
import { BOTAO_SALA, CAMPO_SALA, CampoSala } from "../_ui/sala-ui";

// Peças da inscrição do just in time, usadas pela tela padrão da `/lp` (`formulario.tsx`) e pelos blocos
// `formulario`/`horarios` da página do editor (que compartilham o mesmo horário escolhido).

/** Tudo que a inscrição precisa (serializável: vem do servidor). */
export type PropsInscricao = {
  slug: string;
  idioma: Idioma;
  tela: SalaTelaLogin;
  horarios: HorarioJitSerial[];
  config: ConfigJitSerial;
  iniciais: string[];
  agoraServidor: number;
  utms: Record<string, string>;
  teste: string | null;
};

export type HorariosJit = {
  opcoes: string[];
  escolhido: string;
  setEscolhido: (iso: string) => void;
  fusoNavegador: string;
  entrarDireto: boolean;
  /** "segunda-feira, 2 de novembro às 20:00" no fuso aplicado. */
  rotulo: (iso: string) => string;
  /** Horário que vai na inscrição. */
  horarioEnviado: string;
};

/** Horários oferecidos (recalculados no navegador com o fuso dele e a cada 30 s, pra nunca oferecer um horário que
 *  já passou; o servidor confere de novo na inscrição) e o escolhido. */
export function useHorariosJit(p: PropsInscricao): HorariosJit {
  const fuso = useFusoAplicado(p.config.fuso);
  const [fusoNavegador, setFusoNavegador] = useState("");
  const [opcoes, setOpcoes] = useState<string[]>(p.iniciais);
  const [escolhido, setEscolhido] = useState<string>(p.iniciais[0] ?? "");
  const deslocamento = useRef(p.agoraServidor - Date.now());

  const horarios = useMemo(() => horariosDeSerial(p.horarios), [p.horarios]);
  const config = useMemo(() => configDeSerial(p.config), [p.config]);

  useEffect(() => {
    const nav = fusoDoNavegador() ?? "";
    setFusoNavegador(nav);
    const calcular = () => {
      const agora = new Date(Date.now() + deslocamento.current);
      setOpcoes(proximosHorariosJit(horarios, config, agora, nav || undefined).map((d) => d.toISOString()));
    };
    calcular();
    const id = setInterval(calcular, 30_000);
    return () => clearInterval(id);
  }, [horarios, config]);

  useEffect(() => {
    if (!opcoes.includes(escolhido)) setEscolhido(opcoes[0] ?? "");
  }, [opcoes, escolhido]);

  const entrarDireto = p.config.exibicao === "entrar_direto";
  const rotulo = (iso: string) => {
    const { data, hora } = formatarHorarioJit(new Date(iso), fuso, p.idioma);
    return t(p.idioma, "dataHora", { data, hora });
  };
  return {
    opcoes,
    escolhido,
    setEscolhido,
    fusoNavegador,
    entrarDireto,
    rotulo,
    horarioEnviado: entrarDireto ? (opcoes[0] ?? "") : escolhido,
  };
}

/** Lista de horários (ou "próxima sessão", quando a configuração entra direto no mais próximo). `nome` = nome do
 *  campo quando a lista está dentro do formulário; fora dele (bloco `horarios`), o formulário manda o escolhido num
 *  campo oculto. */
export function ListaHorarios({ h, idioma, nome }: { h: HorariosJit; idioma: Idioma; nome?: string }) {
  if (h.opcoes.length === 0) return <p className="text-center text-sm opacity-70">{t(idioma, "semHorarios")}</p>;
  if (h.entrarDireto) {
    return (
      <div className="rounded-md border border-borda bg-white px-4 py-3 text-center text-texto">
        <p className="text-xs font-semibold tracking-wide text-marca uppercase">{t(idioma, "proximaSessao")}</p>
        <p className="mt-1 text-base font-medium first-letter:uppercase">{h.rotulo(h.opcoes[0])}</p>
        {nome && <input type="hidden" name={nome} value={h.opcoes[0]} />}
      </div>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 w-full text-sm font-medium">{t(idioma, "escolhaHorario")}</legend>
      {h.opcoes.map((iso) => (
        <label
          key={iso}
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-base text-texto shadow-controle transition-colors ${
            h.escolhido === iso ? "border-marca bg-marca-linha font-medium" : "border-borda bg-white hover:bg-suave"
          }`}
        >
          <input
            type="radio"
            name={nome ?? "vw-horario-escolha"}
            value={iso}
            checked={h.escolhido === iso}
            onChange={() => h.setEscolhido(iso)}
            className="h-4 w-4 shrink-0 accent-marca"
          />
          <span className="first-letter:uppercase">{h.rotulo(iso)}</span>
        </label>
      ))}
    </fieldset>
  );
}

const ESTADO_INICIAL: ResultadoInscricao = {};

/** Formulário de inscrição. Com `mostrarHorarios = false` (a página tem o bloco `horarios`), não repete a lista: o
 *  horário escolhido lá vai num campo oculto. `rotulos`: labels acima dos campos (tela padrão, no cartão branco); no
 *  bloco do editor só os placeholders, porque o fundo é o da página. */
export function CamposInscricao({ p, h, mostrarHorarios, rotulos = false }: { p: PropsInscricao; h: HorariosJit; mostrarHorarios: boolean; rotulos?: boolean }) {
  const [estado, acao, pendente] = useActionState(inscrever.bind(null, p.slug), ESTADO_INICIAL);
  const rotulo = (chave: "nome" | "email" | "telefone") => (rotulos ? t(p.idioma, chave) : undefined);
  return (
    <form action={acao} className="flex w-full flex-col gap-4">
      <input type="hidden" name="utms" value={JSON.stringify(p.utms)} />
      <input type="hidden" name="fuso" value={h.fusoNavegador} />
      {p.teste && <input type="hidden" name="teste" value={p.teste} />}

      {mostrarHorarios ? (
        <ListaHorarios h={h} idioma={p.idioma} nome="horario" />
      ) : (
        <input type="hidden" name="horario" value={h.horarioEnviado} />
      )}

      <CampoSala rotulo={rotulo("nome")}>
        <input name="nome" placeholder={p.tela.placeholderNome} defaultValue={estado.valores?.nome ?? ""} autoComplete="name" className={CAMPO_SALA} />
      </CampoSala>
      {p.tela.pedeEmail && (
        <CampoSala rotulo={rotulo("email")}>
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder={p.tela.placeholderEmail}
            defaultValue={estado.valores?.email ?? ""}
            required={p.tela.emailObrigatorio}
            autoComplete="email"
            className={CAMPO_SALA}
          />
        </CampoSala>
      )}
      {p.tela.pedeTelefone && (
        <CampoSala rotulo={rotulo("telefone")}>
          <input
            name="telefone"
            type="tel"
            inputMode="tel"
            placeholder={p.tela.placeholderTelefone}
            defaultValue={estado.valores?.telefone ?? ""}
            required={p.tela.telefoneObrigatorio}
            autoComplete="tel"
            className={CAMPO_SALA}
          />
        </CampoSala>
      )}

      {estado.erro && (
        <p role="alert" className="text-sm font-medium text-erro">
          {estado.erro}
        </p>
      )}

      <button
        type="submit"
        disabled={pendente || h.opcoes.length === 0}
        className={`mt-2 ${BOTAO_SALA}`}
        style={{ backgroundColor: p.tela.botaoCor, color: p.tela.botaoCorTexto }}
      >
        {pendente ? (
          t(p.idioma, "enviando")
        ) : (
          <>
            {t(p.idioma, "inscrever")}
            <ArrowRight aria-hidden size={20} />
          </>
        )}
      </button>
    </form>
  );
}
