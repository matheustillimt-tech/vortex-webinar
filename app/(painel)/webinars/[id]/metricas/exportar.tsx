"use client";
// Botão "Exportar" das Métricas do webinar (menu): Participantes por momento (modal com até 2
// eventos), Todos os participantes, Conversas e Vendas. Baixa o .xlsx das rotas `/api/webinars/[id]/exportar/*`
// com o período da tela.
import { useState } from "react";
import { ChevronDown, Download, Filter, MessagesSquare, ShoppingCart, Users } from "lucide-react";
import { Modal } from "../../../_componentes/modal";
import { useToast } from "../../../_componentes/toast";
import { Botao, estiloBotao } from "../../../_componentes/ui";
import { MenuAcoes } from "../../../_componentes/menu-acoes";

export function ExportarMetricas({ webinarId, query, eventos }: { webinarId: string; query: string; eventos: { tipo: string; rotulo: string }[] }) {
  const toast = useToast();
  const [momento, setMomento] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const base = `/api/webinars/${webinarId}/exportar`;

  function baixar(url: string) {
    window.location.href = url;
    toast.sucesso("Gerando a planilha…", "O download começa em instantes.");
  }

  function alternar(tipo: string) {
    setEscolhidos((atual) => (atual.includes(tipo) ? atual.filter((t) => t !== tipo) : atual.length >= 2 ? atual : [...atual, tipo]));
  }

  return (
    <>
      <MenuAcoes
        gatilho={{
          classe: estiloBotao("secundario"),
          conteudo: (
            <>
              <Download aria-hidden />
              Exportar
              <ChevronDown aria-hidden />
            </>
          ),
        }}
        itens={[
          { rotulo: "Participantes por momento", icone: Filter, aoClicar: () => setMomento(true) },
          { rotulo: "Todos os participantes", icone: Users, aoClicar: () => baixar(`${base}/participantes?${query}`) },
          { rotulo: "Conversas", icone: MessagesSquare, aoClicar: () => baixar(`${base}/conversas?${query}`) },
          { rotulo: "Vendas", icone: ShoppingCart, aoClicar: () => baixar(`${base}/vendas?${query}`) },
        ]}
      />
      <Modal
        aberto={momento}
        aoFechar={() => setMomento(false)}
        titulo="Escolha os filtros"
        descricao="Lista quem passou por todos os momentos escolhidos (até 2), no período da tela."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setMomento(false)}>
              Cancelar
            </Botao>
            <Botao
              disabled={escolhidos.length === 0}
              onClick={() => {
                setMomento(false);
                baixar(`${base}/momento?${query}&eventos=${escolhidos.join(",")}`);
              }}
            >
              Gerar lista personalizada
            </Botao>
          </>
        }
      >
        <fieldset className="grid grid-cols-2 gap-2 max-tela-sm:grid-cols-1">
          <legend className="sr-only">Momentos</legend>
          {eventos.map((e) => {
            const marcado = escolhidos.includes(e.tipo);
            return (
              <label
                key={e.tipo}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${marcado ? "border-marca bg-marca-linha" : "border-borda hover:bg-suave"} ${!marcado && escolhidos.length >= 2 ? "opacity-50" : ""}`}
              >
                <input type="checkbox" checked={marcado} disabled={!marcado && escolhidos.length >= 2} onChange={() => alternar(e.tipo)} />
                {e.rotulo}
              </label>
            );
          })}
        </fieldset>
        <p className="text-xs text-texto-4">{escolhidos.length} de 2 escolhidos</p>
      </Modal>
    </>
  );
}
