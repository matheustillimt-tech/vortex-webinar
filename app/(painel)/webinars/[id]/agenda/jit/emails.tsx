"use client";
import { useActionState, useRef, useState } from "react";
import { Botao, Campo, estiloInput } from "../../../../_componentes/ui";
import { enviarTesteEmailJit, salvarEmailJit, type Resultado } from "./actions";

export type ValoresEmail = { remetenteNome: string; assunto: string; texto: string; minutosAntes: string };

type Props = {
  webinarId: string;
  tipo: "inscricao" | "lembrete" | "comecando";
  titulo: string;
  quando: string;
  valores: ValoresEmail;
  padrao: ValoresEmail;
  variaveis: string[];
  emailLigado: boolean;
  aviso: string;
  maxAssunto: number;
  maxTexto: number;
};

export function CartaoEmail({ webinarId, tipo, titulo, quando, valores, padrao, variaveis, emailLigado, aviso, maxAssunto, maxTexto }: Props) {
  const [estadoSalvar, salvar, salvando] = useActionState<Resultado, FormData>(salvarEmailJit.bind(null, webinarId), {});
  const [estadoTeste, testar, testando] = useActionState<Resultado, FormData>(enviarTesteEmailJit.bind(null, webinarId), {});
  const [campos, setCampos] = useState<ValoresEmail>(valores);
  const [restaurado, setRestaurado] = useState(false);
  const assuntoRef = useRef<HTMLInputElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const ultimoCampo = useRef<"assunto" | "texto">("texto");

  const mudar = (k: keyof ValoresEmail, valor: string) => {
    setRestaurado(false);
    setCampos((c) => ({ ...c, [k]: valor }));
  };

  /** Insere `{{variavel}}` no cursor do último campo usado (assunto ou texto). */
  function inserir(nome: string) {
    const alvo = ultimoCampo.current;
    const el = alvo === "assunto" ? assuntoRef.current : textoRef.current;
    const atual = campos[alvo];
    const marca = `{{${nome}}}`;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    mudar(alvo, atual.slice(0, ini) + marca + atual.slice(fim));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  }

  const vars = variaveis.filter((n) => n !== "minutos" || tipo === "lembrete");

  return (
    <form action={salvar} className="space-y-4" aria-label={titulo}>
      <input type="hidden" name="tipo" value={tipo} />
      <p className="text-xs text-texto-3">{quando}</p>
      <div className="grid gap-4 tela-md:grid-cols-2">
        <Campo rotulo="Nome do remetente">
          <input name="remetente_nome" className={estiloInput} maxLength={80} value={campos.remetenteNome} onChange={(e) => mudar("remetenteNome", e.target.value)} />
        </Campo>
        {tipo === "lembrete" && (
          <Campo rotulo="Minutos antes" dica="Entre 5 e 1440. Quem se inscreve mais perto que isso não recebe o lembrete.">
            <input name="minutos_antes" inputMode="numeric" className={estiloInput} value={campos.minutosAntes} onChange={(e) => mudar("minutosAntes", e.target.value)} />
          </Campo>
        )}
      </div>
      <Campo rotulo="Assunto" contador={`${campos.assunto.length}/${maxAssunto}`}>
        <input
          ref={assuntoRef}
          name="assunto"
          className={estiloInput}
          maxLength={maxAssunto}
          value={campos.assunto}
          onFocus={() => (ultimoCampo.current = "assunto")}
          onChange={(e) => mudar("assunto", e.target.value)}
        />
      </Campo>
      <Campo rotulo="Texto" dica="Linha em branco separa parágrafos. O botão “Acessar o webinar” entra no fim, com o link de cada pessoa." contador={`${campos.texto.length}/${maxTexto}`}>
        <textarea
          ref={textoRef}
          name="texto"
          rows={8}
          className={estiloInput}
          maxLength={maxTexto}
          value={campos.texto}
          onFocus={() => (ultimoCampo.current = "texto")}
          onChange={(e) => mudar("texto", e.target.value)}
        />
      </Campo>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-vg-muted">Inserir:</span>
        {vars.map((n) => (
          <button
            key={n}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => inserir(n)}
            className="rounded border border-vg-line-2 px-2 py-0.5 font-mono text-xs text-vg-text-2 hover:text-vg-text"
          >
            {`{{${n}}}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={salvando}>{salvando ? "Salvando…" : "Salvar e-mail"}</Botao>
        <Botao type="button" variante="secundario" onClick={() => { setCampos(padrao); setRestaurado(true); }}>
          Restaurar padrão
        </Botao>
        <Botao type="submit" variante="secundario" formAction={testar} disabled={!emailLigado || testando} title={emailLigado ? undefined : aviso}>
          {testando ? "Enviando…" : "Enviar teste para mim"}
        </Botao>
      </div>
      {!emailLigado && <p className="text-xs text-vg-aviso">{aviso}</p>}
      {restaurado && <p className="text-sm text-vg-muted">Texto padrão de volta. Salve para manter.</p>}
      {estadoSalvar.erro && <p className="text-sm text-vg-erro">{estadoSalvar.erro}</p>}
      {estadoSalvar.ok && <p className="text-sm text-vg-ok">E-mail salvo.</p>}
      {estadoTeste.erro && <p className="text-sm text-vg-erro">Teste: {estadoTeste.erro}</p>}
      {estadoTeste.mensagem && <p className="text-sm text-vg-ok">{estadoTeste.mensagem}</p>}
    </form>
  );
}
