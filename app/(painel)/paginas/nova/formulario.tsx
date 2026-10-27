"use client";
import { useActionState, useState } from "react";
import { Check, LayoutTemplate } from "lucide-react";
import { Botao, BotaoLink, CampoTexto } from "../../_componentes/ui";
import { criarPagina, type Resultado } from "../actions";

type Modelo = { id: string; tipo: string; nome: string; descricao: string };

/** "Criar nova Página": nome e, por tipo, os cartões de modelo com "Escolher esse"; "Continuar" cria e
 *  abre o editor. O tipo sai do modelo escolhido. */
export function FormularioNovaPagina({ tipoInicial, tipos, modelos }: { tipoInicial: string; tipos: { valor: string; rotulo: string }[]; modelos: Modelo[] }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(criarPagina, {});
  const [nome, setNome] = useState(estado.valores?.nome ?? "");
  const inicial = modelos.find((m) => m.id === estado.valores?.modelo) ?? modelos.find((m) => m.tipo === (estado.valores?.tipo || tipoInicial)) ?? modelos[0];
  const [modelo, setModelo] = useState<Modelo | undefined>(inicial);

  return (
    <form action={enviar} className="space-y-8">
      <CampoTexto
        rotulo="Nome da página"
        name="nome"
        required
        maxLength={120}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        contador={`${nome.length} de 120`}
        placeholder="Ex.: Registro aulão de novembro"
        classeCampo="max-w-xl"
      />
      <input type="hidden" name="tipo" value={modelo?.tipo ?? ""} />
      <input type="hidden" name="modelo" value={modelo?.id ?? ""} />

      {tipos.map((t) => {
        const doTipo = modelos.filter((m) => m.tipo === t.valor);
        if (doTipo.length === 0) return null;
        return (
          <section key={t.valor} className="space-y-3">
            <h2 className="text-base font-semibold text-titulo">{t.rotulo}</h2>
            <div className="grid grid-cols-3 gap-4 max-tela-lg:grid-cols-2 max-tela-sm:grid-cols-1">
              {doTipo.map((m) => {
                const escolhido = modelo?.id === m.id;
                return (
                  <div key={m.id} className={`flex flex-col overflow-hidden rounded-lg border bg-superficie transition-colors ${escolhido ? "border-marca ring-2 ring-marca/30" : "border-borda"}`}>
                    <div className="grid h-32 place-items-center bg-suave text-apagado">
                      <LayoutTemplate size={40} aria-hidden />
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-texto">{m.nome}</p>
                        <p className="mt-1 text-xs text-texto-3">{m.descricao}</p>
                      </div>
                      <Botao type="button" variante={escolhido ? "principal" : "secundario"} aria-pressed={escolhido} icone={escolhido ? <Check aria-hidden /> : undefined} onClick={() => setModelo(m)}>
                        {escolhido ? "Escolhido" : "Escolher esse"}
                      </Botao>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-linha pt-6 max-tela-sm:[&>*]:w-full">
        {estado.erro && <p role="alert" className="mr-auto text-sm text-erro">{estado.erro}</p>}
        <BotaoLink href="/paginas" variante="secundario">
          Cancelar
        </BotaoLink>
        <Botao variante="contorno" carregando={enviando} disabled={!modelo || !nome.trim()}>
          Continuar
        </Botao>
      </div>
    </form>
  );
}
