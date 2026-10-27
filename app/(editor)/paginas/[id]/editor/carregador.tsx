"use client";
import dynamic from "next/dynamic";
import type { PropsEditor } from "./editor";

// O GrapesJS mexe no `window`/`document` ao carregar: só no navegador, e só nesta rota.
const Editor = dynamic(() => import("./editor").then((m) => m.EditorDePagina), {
  ssr: false,
  loading: () => <div className="grid h-screen place-items-center text-vg-muted">Carregando o editor…</div>,
});

export function CarregadorEditor(props: PropsEditor) {
  return <Editor {...props} />;
}
