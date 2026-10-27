"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import { BOTAO_SALA, CAMPO_SALA, CampoSala } from "../../_ui/sala-ui";

export type SalaCadastro = {
  pedeEmail: boolean;
  emailObrigatorio: boolean;
  pedeTelefone: boolean;
  telefoneObrigatorio: boolean;
  placeholderNome: string;
  placeholderEmail: string;
  placeholderTelefone: string;
  botaoTexto: string;
  botaoCor: string;
  botaoCorTexto: string;
};

type Props = {
  idioma: Idioma;
  webinarId: string;
  cadastro: SalaCadastro;
  onCadastrado: (nome: string) => void;
  onFechar: () => void;
};

/** Mesmo formulário da tela de login (sem barra de vagas nem logo), usado quando uma sessão provisória (acesso
 *  facilitado) tenta enviar uma mensagem — precisa completar o cadastro primeiro (`POST /api/sala/cadastro`). */
export default function CadastroModal({ idioma, webinarId, cadastro, onCadastrado, onFechar }: Props) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const resp = await fetch("/api/sala/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ w: webinarId, nome, email, telefone }),
      });
      const dados = await resp.json().catch(() => null);
      if (!resp.ok) {
        setErro(dados?.erro ?? t(idioma, "erroInscricao"));
        return;
      }
      // Nome já validado/aparado pelo servidor (cai no digitado se a resposta não trouxer).
      onCadastrado(typeof dados?.nome === "string" ? dados.nome : nome.trim());
    } catch {
      setErro(t(idioma, "erroInscricao"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="relative flex w-full max-w-[440px] flex-col gap-4 rounded-xl bg-white p-6 text-texto shadow-cartao-sala">
        <button
          type="button"
          onClick={onFechar}
          aria-label={t(idioma, "fechar")}
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-texto-4 hover:bg-suave"
        >
          <X aria-hidden size={18} />
        </button>
        <CampoSala rotulo={t(idioma, "nome")}>
          <input value={nome} onChange={(ev) => setNome(ev.target.value)} placeholder={cadastro.placeholderNome} autoComplete="name" className={CAMPO_SALA} />
        </CampoSala>
        {cadastro.pedeEmail && (
          <CampoSala rotulo={t(idioma, "email")}>
            <input
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              type="email"
              inputMode="email"
              placeholder={cadastro.placeholderEmail}
              required={cadastro.emailObrigatorio}
              autoComplete="email"
              className={CAMPO_SALA}
            />
          </CampoSala>
        )}
        {cadastro.pedeTelefone && (
          <CampoSala rotulo={t(idioma, "telefone")}>
            <input
              value={telefone}
              onChange={(ev) => setTelefone(ev.target.value)}
              type="tel"
              inputMode="tel"
              placeholder={cadastro.placeholderTelefone}
              required={cadastro.telefoneObrigatorio}
              autoComplete="tel"
              className={CAMPO_SALA}
            />
          </CampoSala>
        )}

        {erro && (
          <p role="alert" className="text-sm font-medium text-erro">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className={`mt-1 ${BOTAO_SALA}`}
          style={{ backgroundColor: cadastro.botaoCor, color: cadastro.botaoCorTexto }}
        >
          {enviando ? t(idioma, "enviando") : cadastro.botaoTexto}
        </button>
      </form>
    </div>
  );
}
