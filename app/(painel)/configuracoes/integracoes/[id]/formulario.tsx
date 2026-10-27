"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Botao, estiloAcao, estiloInput, Selo, Tabela } from "../../../_componentes/ui";
import { BotaoEnvio } from "../../../_componentes/botao-envio";
import { GATILHOS, rotuloGatilho, type Gatilho } from "@/src/lib/regras/regras-webhook";
import { adicionarRegra, alternarRegra, editarRegra, enviarTesteRegra, excluirRegra, type Resultado, type ResultadoTeste } from "./actions";
import { SENTINELA_HEADER } from "./sentinela";
import type { ItemRegra } from "./page";

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const COM_TEMPO: Gatilho[] = ["permaneceu", "abandonou"];

const MODELO_CORPO = '{"nome":"{{NOME}}","email":"{{EMAIL}}","telefone":"{{TELEFONE}}","evento":"{{TAG}}","data":"{{DATA}}","utms":"{{UTMS}}","tempo":"{{TEMPO}}"}';
const VARIAVEIS = ["{{NOME}}", "{{EMAIL}}", "{{TELEFONE}}", "{{TAG}}", "{{DATA}}", "{{UTMS}}", "{{TEMPO}}", "{{WEBINAR}}"];

function segundosParaHms(seg: number | null): string {
  if (seg === null) return "";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** `original`: a chave com que o header foi salvo (só nas linhas que vieram do banco) — vai num campo escondido
 *  pra action achar o segredo certo quando o valor volta como "•••", mesmo com linhas removidas/reordenadas. */
type LinhaPar = { chave: string; valor: string; original?: string };

function ListaPares({
  rotulo,
  nomePrefixo,
  linhas,
  aoMudar,
  comOriginal = false,
}: {
  rotulo: string;
  nomePrefixo: string;
  linhas: LinhaPar[];
  aoMudar: (l: LinhaPar[]) => void;
  comOriginal?: boolean;
}) {
  function atualizar(i: number, campo: "chave" | "valor", v: string) {
    const nova = linhas.slice();
    nova[i] = { ...nova[i], [campo]: v };
    aoMudar(nova);
  }
  function remover(i: number) {
    aoMudar(linhas.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-rotulo">{rotulo}</p>
      {linhas.map((l, i) => (
        <div key={i} className="flex gap-2">
          {comOriginal && <input type="hidden" name={`${nomePrefixo}_original`} value={l.original ?? ""} />}
          <input
            name={`${nomePrefixo}_chave`}
            className={estiloInput}
            placeholder="chave"
            value={l.chave}
            maxLength={100}
            onChange={(e) => atualizar(i, "chave", e.target.value)}
          />
          <input
            name={`${nomePrefixo}_valor`}
            className={estiloInput}
            placeholder="valor"
            value={l.valor}
            maxLength={2000}
            onChange={(e) => atualizar(i, "valor", e.target.value)}
          />
          <button type="button" onClick={() => remover(i)} className={estiloAcao.perigo}>
            Remover
          </button>
        </div>
      ))}
      {linhas.length < 20 && (
        <button type="button" onClick={() => aoMudar([...linhas, { chave: "", valor: "" }])} className={estiloAcao.normal}>
          Adicionar linha
        </button>
      )}
    </div>
  );
}

type Valores = {
  gatilho: Gatilho;
  valorSeg: string;
  url: string;
  metodo: string;
  corpo: string;
};

function FormularioItem({
  webinarId,
  action,
  valores,
  headersIniciais,
  paramsIniciais,
  rotuloBotao,
  aoSalvar,
  aoCancelar,
}: {
  webinarId: string;
  action: (prev: Resultado, form: FormData) => Promise<Resultado>;
  valores: Valores;
  headersIniciais: LinhaPar[];
  paramsIniciais: LinhaPar[];
  rotuloBotao: string;
  aoSalvar?: () => void;
  aoCancelar?: () => void;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(action, {});
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        gatilho: (v.gatilho as Gatilho) ?? valores.gatilho,
        valorSeg: v.valor_seg ?? valores.valorSeg,
        url: v.url ?? valores.url,
        metodo: v.metodo ?? valores.metodo,
        corpo: v.corpo ?? valores.corpo,
      }
    : valores;
  const chaveTentativa = estado.erro ?? "inicial";

  const [gatilho, setGatilho] = useState<Gatilho>(efetivos.gatilho);
  const [corpo, setCorpo] = useState(efetivos.corpo);
  const [headers, setHeaders] = useState<LinhaPar[]>(headersIniciais);
  const [params, setParams] = useState<LinhaPar[]>(paramsIniciais);

  useEffect(() => {
    if (estado.ok && aoSalvar) aoSalvar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.ok]);

  return (
    <form action={enviar} className="space-y-3" key={chaveTentativa}>
      <div className="grid gap-3 tela-md:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-rotulo">Gatilho</span>
          <select name="gatilho" className={estiloInput} value={gatilho} onChange={(e) => setGatilho(e.target.value as Gatilho)}>
            {GATILHOS.map((g) => (
              <option key={g} value={g}>
                {rotuloGatilho(g)}
              </option>
            ))}
          </select>
        </label>
        {COM_TEMPO.includes(gatilho) && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-rotulo">Tempo (h:mm:ss)</span>
            <input name="valor_seg" className={estiloInput} defaultValue={efetivos.valorSeg} placeholder="0:30" />
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-rotulo">Método</span>
          <select name="metodo" className={estiloInput} defaultValue={efetivos.metodo}>
            {METODOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-rotulo">URL</span>
        <input name="url" className={estiloInput} defaultValue={efetivos.url} placeholder="https://..." />
      </label>

      <ListaPares rotulo="Headers" nomePrefixo="header" linhas={headers} aoMudar={setHeaders} comOriginal />
      <ListaPares rotulo="Params" nomePrefixo="param" linhas={params} aoMudar={setParams} />

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-rotulo">Corpo</span>
        <div className="flex flex-wrap gap-1.5">
          {VARIAVEIS.map((vr) => (
            <button key={vr} type="button" onClick={() => setCorpo((c) => c + vr)} className="rounded border border-vg-line-2 px-1.5 py-0.5 text-xs text-vg-text-2 hover:bg-suave">
              {vr}
            </button>
          ))}
          <button type="button" onClick={() => setCorpo(MODELO_CORPO)} className="rounded border border-vg-line-2 px-1.5 py-0.5 text-xs text-vg-accent hover:bg-suave">
            Usar modelo padrão
          </button>
        </div>
        <textarea name="corpo" className={estiloInput} rows={4} value={corpo} maxLength={10000} onChange={(e) => setCorpo(e.target.value)} />
      </label>

      <div className="flex items-center gap-3">
        <Botao disabled={enviando}>{enviando ? "Salvando…" : rotuloBotao}</Botao>
        {aoCancelar && (
          <button type="button" onClick={aoCancelar} className={estiloAcao.neutro}>
            Cancelar
          </button>
        )}
        {estado.erro && <p className="text-sm text-vg-erro">{estado.erro}</p>}
      </div>
    </form>
  );
}

function BotaoTeste({ webinarId, regraId }: { webinarId: string; regraId: string }) {
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" disabled={pendente} className={estiloAcao.normal} onClick={() => iniciar(async () => setResultado(await enviarTesteRegra(webinarId, regraId)))}>
        {pendente ? "Enviando…" : "Enviar teste"}
      </button>
      {resultado && "erro" in resultado && <span className="text-xs text-vg-erro">{resultado.erro}</span>}
      {resultado && "status" in resultado && (
        <span className="max-w-xs truncate text-xs text-vg-muted" title={resultado.corpo}>
          {resultado.status} · {resultado.corpo}
        </span>
      )}
    </div>
  );
}

const SELO_RESULTADO: Record<"ok" | "erro" | "fila", { cor: "ok" | "erro" | "aviso"; texto: string }> = {
  ok: { cor: "ok", texto: "ok" },
  erro: { cor: "erro", texto: "erro" },
  fila: { cor: "aviso", texto: "na fila" },
};

function LinhaRegra({ webinarId, item }: { webinarId: string; item: ItemRegra }) {
  const [editando, setEditando] = useState(false);
  const excluirAction = excluirRegra.bind(null, webinarId);
  const alternarAction = alternarRegra.bind(null, webinarId);

  if (editando) {
    return (
      <tr>
        <td colSpan={6} className="p-3">
          <FormularioItem
            webinarId={webinarId}
            action={editarRegra.bind(null, webinarId, item.id)}
            valores={{ gatilho: item.gatilho, valorSeg: segundosParaHms(item.valor_seg), url: item.url, metodo: item.metodo, corpo: item.corpo ?? "" }}
            headersIniciais={item.headers_chaves.map((chave) => ({ chave, valor: SENTINELA_HEADER, original: chave }))}
            paramsIniciais={Object.entries(item.params).map(([chave, valor]) => ({ chave, valor }))}
            rotuloBotao="Salvar"
            aoSalvar={() => setEditando(false)}
            aoCancelar={() => setEditando(false)}
          />
        </td>
      </tr>
    );
  }

  const resultado = item.ultimo_resultado ? SELO_RESULTADO[item.ultimo_resultado] : null;

  return (
    <tr>
      <td className="px-3 py-2.5">{rotuloGatilho(item.gatilho)}</td>
      <td className="max-w-[260px] truncate px-3 py-2.5 text-vg-text-2">{item.url}</td>
      <td className="px-3 py-2.5">{item.metodo}</td>
      <td className="px-3 py-2.5">
        <Selo cor={item.ativa ? "ok" : "neutro"}>{item.ativa ? "Ativa" : "Desativada"}</Selo>
      </td>
      <td className="px-3 py-2.5">{resultado ? <Selo cor={resultado.cor}>{resultado.texto}</Selo> : <span className="text-vg-muted">—</span>}</td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setEditando(true)} className={estiloAcao.normal}>
            Editar
          </button>
          <form action={alternarAction}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="ativa" value={item.ativa ? "1" : "0"} />
            <BotaoEnvio className={estiloAcao.neutro}>
              {item.ativa ? "Desativar" : "Ativar"}
            </BotaoEnvio>
          </form>
          <BotaoTeste webinarId={webinarId} regraId={item.id} />
          <form action={excluirAction}>
            <input type="hidden" name="id" value={item.id} />
            <BotaoEnvio className={estiloAcao.perigo} pendente="Excluindo…">
              Excluir
            </BotaoEnvio>
          </form>
        </div>
      </td>
    </tr>
  );
}

export function ListaRegras({ webinarId, itens }: { webinarId: string; itens: ItemRegra[] }) {
  const [mostrarNovo, setMostrarNovo] = useState(itens.length === 0);

  return (
    <div className="space-y-4">
      {itens.length > 0 && (
        <Tabela colunas={["Gatilho", "URL", "Método", "Status", "Último", "Ações"]}>
          {itens.map((item) => (
            <LinhaRegra key={item.id} webinarId={webinarId} item={item} />
          ))}
        </Tabela>
      )}

      {mostrarNovo ? (
        <div className="rounded-lg border border-vg-line p-3">
          <FormularioItem
            webinarId={webinarId}
            action={adicionarRegra.bind(null, webinarId)}
            valores={{ gatilho: "acessou", valorSeg: "", url: "", metodo: "POST", corpo: "" }}
            headersIniciais={[]}
            paramsIniciais={[]}
            rotuloBotao="Adicionar"
            aoSalvar={() => setMostrarNovo(false)}
            aoCancelar={itens.length > 0 ? () => setMostrarNovo(false) : undefined}
          />
        </div>
      ) : (
        <Botao type="button" variante="secundario" onClick={() => setMostrarNovo(true)}>
          Nova regra
        </Botao>
      )}
    </div>
  );
}
