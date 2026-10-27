import { Bot, KeyRound } from "lucide-react";
import { env } from "@/src/lib/env";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { BotaoCopiar } from "../../_componentes/copiar";
import { Cartao, estiloCelula, Selo, Tabela } from "../../_componentes/ui";
import { ComoConectar, CriarChave, RevogarChave } from "../mcp/formulario";

type LinhaChave = { id: string; nome: string; permissao: "leitura" | "escrita"; prefixo: string; ultimo_uso: string | null; revogada_em: string | null; usuarios: { nome: string } | null };

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

/** Aba "MCP": as chaves que ligam um Claude (Claude Code, Claude Desktop ou outro cliente MCP) ao Vórtex Webinar, pra
 *  ele configurar webinars, o agente de IA e o chat, responder participantes e analisar métricas. A tabela
 *  `chaves_api` não abre pra RLS: lê com a service role (a página já conferiu que é admin). */
export async function IntegracoesMcp() {
  const urlMcp = `${env("NEXT_PUBLIC_PAINEL_URL").replace(/\/$/, "")}/api/mcp`;
  const { data: linhas, error } = await dbAdmin()
    .from("chaves_api")
    .select("id, nome, permissao, prefixo, ultimo_uso, revogada_em, usuarios(nome)")
    .order("created_at", { ascending: false });
  const chaves = (linhas ?? []) as unknown as LinhaChave[];

  return (
    <div className="space-y-6">
      <Cartao
        titulo="Conectar um Claude"
        icone={Bot}
        ajuda="Com a chave, o Claude configura webinars, o agente de IA e o chat, responde participantes e puxa métricas, retenção e o que as pessoas escreveram. Tudo que ele muda fica no Histórico de ações com (MCP)."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-suave px-3 py-2 text-sm">{urlMcp}</code>
            <BotaoCopiar texto={urlMcp} rotulo="Copiar endereço" />
          </div>
          <ComoConectar urlMcp={urlMcp} />
        </div>
      </Cartao>

      <Cartao titulo="Chaves do MCP" icone={KeyRound} ajuda="Uma chave por pessoa ou por Claude. A chave aparece uma vez só, na criação. Revogar corta o acesso na hora." acao={<CriarChave urlMcp={urlMcp} />}>
        {error && <p role="alert" className="mb-4 rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar as chaves. Tente de novo.</p>}
        <Tabela colunas={["Nome", "Permissão", "Chave", "Criada por", "Último uso", <span key="a" className="block text-right">Ação</span>]} vazio={chaves.length === 0 ? "Nenhuma chave ainda." : undefined}>
          {chaves.map((c) => (
            <tr key={c.id} className={c.revogada_em ? "text-texto-3" : ""}>
              <td className={`${estiloCelula} py-3 font-medium`}>
                <span className="flex flex-wrap items-center gap-2">
                  {c.nome}
                  {c.revogada_em && <Selo cor="neutro">Revogada</Selo>}
                </span>
              </td>
              <td className={estiloCelula}>{c.permissao === "escrita" ? "Leitura e escrita" : "Só leitura"}</td>
              <td className={`${estiloCelula} font-mono text-xs`}>vw_{c.prefixo}…</td>
              <td className={estiloCelula}>{c.usuarios?.nome ?? "—"}</td>
              <td className={`${estiloCelula} whitespace-nowrap`}>{data(c.ultimo_uso)}</td>
              <td className={`${estiloCelula} text-right`}>{!c.revogada_em && <RevogarChave id={c.id} nome={c.nome} />}</td>
            </tr>
          ))}
        </Tabela>
      </Cartao>
    </div>
  );
}
