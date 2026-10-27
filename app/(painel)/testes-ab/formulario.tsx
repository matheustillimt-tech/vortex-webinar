"use client";
import { useActionState, useState } from "react";
import { gerarSlug } from "@/src/lib/regras/slug";
import { CORES_VARIACAO, LETRAS_VARIACAO, MAX_NOME_TESTE_AB, MAX_VARIACOES, MIN_VARIACOES } from "@/src/lib/regras/teste-ab";
import { Plus } from "lucide-react";
import { Botao, BotaoLink, Campo, estiloAcao, estiloInput, estiloSelect } from "../_componentes/ui";
import { criarTesteAb, editarTesteAb, type Resultado } from "./actions";

export type WebinarOpcao = { id: string; nome: string; slug: string; ativo: boolean };
export type ValoresTeste = {
  nome: string;
  slug: string;
  inicio: string;
  fim: string;
  fuso: string;
  variacoes: { webinarId: string; percentual: string }[];
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Quanto falta ou sobra para fechar 100%. */
function textoSoma(soma: number): { texto: string; ok: boolean } {
  if (soma === 100) return { texto: "Total: 100%", ok: true };
  return soma < 100 ? { texto: `Faltam ${100 - soma}% para fechar 100%`, ok: false } : { texto: `Sobram ${soma - 100}% (passou de 100%)`, ok: false };
}

function SeletorWebinar({
  indice,
  valor,
  webinars,
  usados,
  aoMudar,
}: {
  indice: number;
  valor: string;
  webinars: WebinarOpcao[];
  usados: Set<string>;
  aoMudar: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const termo = normalizar(busca.trim());
  const opcoes = webinars.filter((w) => w.id === valor || (w.ativo && (!termo || normalizar(`${w.nome} ${w.slug}`).includes(termo))));
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <input
        type="search"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar webinar pelo nome ou link"
        aria-label={`Buscar webinar da variação ${LETRAS_VARIACAO[indice]}`}
        className={estiloInput}
      />
      <select
        name="variacao_webinar"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label={`Webinar da variação ${LETRAS_VARIACAO[indice]}`}
        className={estiloSelect}
      >
        <option value="">{opcoes.length ? "Escolha o webinar" : "Nenhum webinar encontrado"}</option>
        {opcoes.map((w) => (
          <option key={w.id} value={w.id} disabled={w.id !== valor && usados.has(w.id)}>
            {w.nome} · /{w.slug}
            {!w.ativo ? " (arquivado)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FormularioTesteAb({
  id,
  inicial,
  webinars,
  fusos,
  prefixoLink,
  travado,
}: {
  /** Sem `id` = criar. */
  id?: string;
  inicial: ValoresTeste;
  webinars: WebinarOpcao[];
  fusos: { valor: string; rotulo: string }[];
  prefixoLink: string;
  /** O teste já tem participantes: variações só leitura (não vão no envio). */
  travado: boolean;
}) {
  const acao = id ? editarTesteAb.bind(null, id) : criarTesteAb;
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(acao, {});
  const [nome, setNome] = useState(inicial.nome);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugManual, setSlugManual] = useState(!!id);
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  const [fuso, setFuso] = useState(inicial.fuso);
  const [variacoes, setVariacoes] = useState(inicial.variacoes);

  const soma = variacoes.reduce((t, v) => t + (/^\d+$/.test(v.percentual.trim()) ? Number(v.percentual) : 0), 0);
  const resumoSoma = textoSoma(soma);
  const usados = new Set(variacoes.map((v) => v.webinarId).filter(Boolean));
  const nomeDe = (wid: string) => webinars.find((w) => w.id === wid)?.nome ?? "(webinar)";

  function mudarVariacao(i: number, campo: "webinarId" | "percentual", valor: string) {
    setVariacoes((vs) => vs.map((v, k) => (k === i ? { ...v, [campo]: valor } : v)));
  }

  return (
    <form action={enviar} className="max-w-3xl space-y-6">
      <Campo rotulo="Nome do teste*" contador={`${nome.length}/${MAX_NOME_TESTE_AB}`}>
        <input
          name="nome"
          required
          maxLength={MAX_NOME_TESTE_AB}
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            if (!slugManual) setSlug(gerarSlug(e.target.value));
          }}
          placeholder="Ex.: Headline nova × antiga"
          className={estiloInput}
        />
      </Campo>

      <Campo rotulo="Link*" dica="Letras minúsculas, números e hífen (3 a 60). Não pode ser idêntico ao link de um webinar.">
        <div className="flex h-9 items-center rounded-md border border-borda bg-superficie shadow-controle focus-within:border-marca focus-within:ring-2 focus-within:ring-marca/20">
          <span className="max-w-[60%] shrink-0 truncate pl-3 text-sm text-texto-3">{prefixoLink}</span>
          <input
            name="slug"
            required
            maxLength={60}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugManual(true);
            }}
            className="h-full w-full min-w-0 bg-transparent px-1 text-sm text-texto outline-none"
          />
        </div>
      </Campo>

      <div className="grid grid-cols-3 gap-4 max-tela-md:grid-cols-1">
        <Campo rotulo="De*">
          <input type="datetime-local" name="inicio" required value={inicio} onChange={(e) => setInicio(e.target.value)} className={estiloInput} />
        </Campo>
        <Campo rotulo="Até*">
          <input type="datetime-local" name="fim" required value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={estiloInput} />
        </Campo>
        <Campo rotulo="Fuso*">
          <select name="fuso" value={fuso} onChange={(e) => setFuso(e.target.value)} className={estiloSelect}>
            {fusos.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1.5 text-sm font-medium text-rotulo">Variações* (de {MIN_VARIACOES} a {MAX_VARIACOES} webinars)</legend>

        {travado ? (
          <>
            <p className="rounded-md border border-aviso/30 bg-aviso-fundo px-3 py-2 text-sm text-aviso">
              Este teste já tem participantes; as variações não podem mudar. Dá para editar o nome, o link e as datas.
            </p>
            <ul className="space-y-2">
              {variacoes.map((v, i) => (
                <li key={v.webinarId} className="flex items-center gap-3 rounded-lg border border-borda px-3 py-2 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded text-xs font-bold text-black" style={{ background: CORES_VARIACAO[i] }}>
                    {LETRAS_VARIACAO[i]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{nomeDe(v.webinarId)}</span>
                  <span className="tabular-nums text-vg-text-2">{v.percentual}%</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {variacoes.map((v, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-borda p-3 max-tela-sm:flex-wrap">
                <span className="mt-1.5 grid size-7 shrink-0 place-items-center rounded text-sm font-bold text-black" style={{ background: CORES_VARIACAO[i] }}>
                  {LETRAS_VARIACAO[i]}
                </span>
                <SeletorWebinar indice={i} valor={v.webinarId} webinars={webinars} usados={usados} aoMudar={(w) => mudarVariacao(i, "webinarId", w)} />
                <div className="w-24 shrink-0 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      name="variacao_percentual"
                      inputMode="numeric"
                      pattern="\d*"
                      value={v.percentual}
                      onChange={(e) => mudarVariacao(i, "percentual", e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                      aria-label={`Percentual da variação ${LETRAS_VARIACAO[i]}`}
                      className={`${estiloInput} text-right`}
                    />
                    <span className="text-sm text-vg-muted">%</span>
                  </div>
                  {variacoes.length > MIN_VARIACOES && (
                    <button type="button" className={estiloAcao.perigo} onClick={() => setVariacoes((vs) => vs.filter((_, k) => k !== i))}>
                      Remover
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {variacoes.length < MAX_VARIACOES ? (
                <Botao type="button" variante="secundario" icone={<Plus aria-hidden />} onClick={() => setVariacoes((vs) => [...vs, { webinarId: "", percentual: "" }])}>
                  Adicionar outro ({LETRAS_VARIACAO[variacoes.length]})
                </Botao>
              ) : (
                <span />
              )}
              <p aria-live="polite" className={`text-sm tabular-nums ${resumoSoma.ok ? "text-vg-ok" : "text-vg-aviso"}`}>
                {resumoSoma.texto}
              </p>
            </div>
          </>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={enviando}>{enviando ? "Salvando…" : id ? "Salvar alterações" : "Iniciar teste"}</Botao>
        <BotaoLink href={id ? `/testes-ab/${id}` : "/testes-ab"} variante="secundario">
          Cancelar
        </BotaoLink>
        {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      </div>
    </form>
  );
}
