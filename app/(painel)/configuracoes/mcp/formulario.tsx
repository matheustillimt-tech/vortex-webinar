"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { BotaoCopiar } from "../../_componentes/copiar";
import { Modal } from "../../_componentes/modal";
import { useToast } from "../../_componentes/toast";
import { Botao, CampoSelecao, CampoTexto, Segmentos } from "../../_componentes/ui";
import { CHAVE_EXEMPLO, CLIENTES_MCP, instrucaoConexao, type ClienteMcp } from "@/src/lib/regras/conexao-mcp";
import { criarChaveMcp, revogarChaveMcp, type Resultado } from "./actions";

/** Passo a passo de cada Claude (Claude Code, Claude Desktop, outro cliente), com o texto pronto pra copiar. Sem
 *  `chave`, mostra `vw_SUA_CHAVE` no lugar (a chave de verdade só aparece na criação). */
export function ComoConectar({ urlMcp, chave }: { urlMcp: string; chave?: string }) {
  const [cliente, setCliente] = useState<ClienteMcp>("claude_code");
  const info = CLIENTES_MCP.find((c) => c.valor === cliente)!;
  const textoPronto = instrucaoConexao(cliente, urlMcp, chave ?? CHAVE_EXEMPLO);
  return (
    <div className="space-y-3">
      <Segmentos opcoes={CLIENTES_MCP} valor={cliente} aoMudar={setCliente} />
      <p className="text-sm text-texto-2">{info.passo}</p>
      <pre className="max-h-56 overflow-auto rounded-md bg-suave p-3 text-xs break-all whitespace-pre-wrap">{textoPronto}</pre>
      {chave ? (
        <BotaoCopiar texto={textoPronto} formato="botao" aviso="Copiado." />
      ) : (
        <p className="text-xs text-texto-3">Troque {CHAVE_EXEMPLO} pela chave criada em "Chaves do MCP" (ela já aparece no lugar certo na hora de criar).</p>
      )}
    </div>
  );
}

function FormularioNova({ urlMcp, aoFechar }: { urlMcp: string; aoFechar: () => void }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(criarChaveMcp, {});

  if (estado.chave) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-texto-2">Copie agora: a chave não aparece de novo. Escolha onde vai conectar.</p>
        <ComoConectar urlMcp={urlMcp} chave={estado.chave} />
        <div className="flex justify-end">
          <Botao type="button" onClick={aoFechar}>
            Pronto
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <form action={enviar} className="space-y-4">
      <CampoTexto rotulo="Nome da chave" name="nome" required maxLength={60} autoFocus placeholder="Claude da Ana" />
      <CampoSelecao rotulo="Permissão" name="permissao" defaultValue="escrita" info="Leitura só consulta (métricas, chat, configuração). Escrita também configura webinars e responde participantes.">
        <option value="escrita">Leitura e escrita</option>
        <option value="leitura">Só leitura</option>
      </CampoSelecao>
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <div className="flex flex-col-reverse gap-2 tela-sm:flex-row tela-sm:justify-end">
        <Botao type="button" variante="secundario" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao carregando={enviando}>Criar chave</Botao>
      </div>
    </form>
  );
}

export function CriarChave({ urlMcp }: { urlMcp: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [rodada, setRodada] = useState(0);
  const fechar = () => {
    setAberto(false);
    router.refresh();
  };
  return (
    <>
      <Botao
        tamanho="pequeno"
        className="h-9"
        icone={<Plus aria-hidden />}
        onClick={() => {
          setRodada((r) => r + 1);
          setAberto(true);
        }}
      >
        Criar chave
      </Botao>
      <Modal aberto={aberto} aoFechar={fechar} titulo="Nova chave do MCP">
        <FormularioNova key={rodada} urlMcp={urlMcp} aoFechar={fechar} />
      </Modal>
    </>
  );
}

export function RevogarChave({ id, nome }: { id: string; nome: string }) {
  const router = useRouter();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Botao type="button" tamanho="pequeno" variante="perigo" onClick={() => setAberto(true)}>
        Revogar
      </Botao>
      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        travado={pendente}
        titulo="Revogar chave?"
        descricao={`"${nome}" para de funcionar na hora. O Claude Code que usa essa chave perde o acesso.`}
        rodape={
          <>
            <Botao type="button" variante="secundario" onClick={() => setAberto(false)} disabled={pendente}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              variante="perigo"
              carregando={pendente}
              onClick={() =>
                iniciar(async () => {
                  const r = await revogarChaveMcp(id);
                  if (r.erro) toast.erro(r.erro);
                  else toast.sucesso("Chave revogada.");
                  setAberto(false);
                  router.refresh();
                })
              }
            >
              Revogar
            </Botao>
          </>
        }
      />
    </>
  );
}
