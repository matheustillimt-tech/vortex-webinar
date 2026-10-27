import type { Editor } from "grapesjs";
import type { BlocoVw } from "@/src/lib/regras/paginas";
import { PREVIA_BLOCO, ROTULO_BLOCO, urlEmbedVideo } from "@/src/lib/regras/paginas-editor";

// Tipos e blocos próprios do editor de páginas do Vórtex Webinar.

const BLOCOS = Object.keys(ROTULO_BLOCO) as BlocoVw[];

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** CSS só do canvas (nunca vai para o HTML/CSS salvos): caixas dos blocos dinâmicos e do vídeo. */
export const CSS_CANVAS = [
  "[data-vw]{display:block;min-height:44px;margin:6px 0;border:1px dashed rgba(34,197,94,.75);border-radius:10px;background:rgba(34,197,94,.08);cursor:default}",
  ".vw-ed-bloco{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:10px 14px;text-align:center;font:600 13px/1.3 Inter,system-ui,sans-serif;color:#86efac;pointer-events:none;user-select:none}",
  ".vw-ed-bloco span{font-weight:400;font-size:12px;opacity:.75}",
  ".vw-video iframe{pointer-events:none}",
  ".vw-video:empty::after{content:'Cole o link do vídeo (YouTube, Vimeo ou Bunny) em Propriedades';display:flex;height:100%;align-items:center;justify-content:center;padding:16px;text-align:center;font:13px Inter,system-ui,sans-serif;color:rgba(255,255,255,.6)}",
].join("");

const ESTILO_FILHO_VIDEO = { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", border: "0" };
const TRAVADO = { selectable: false, hoverable: false, layerable: false, draggable: false, droppable: false, copyable: false, removable: false, highlightable: false };

/** Ícones simples (Material Icons, já carregados pelo painel). */
const icone = (nome: string) => `<span class="material-icons" style="font-size:28px">${nome}</span>`;

const ICONE_BLOCO: Record<BlocoVw, string> = {
  titulo: "title",
  apresentador: "badge",
  "foto-apresentador": "account_circle",
  "data-sessao": "event",
  contagem: "timer",
  formulario: "assignment",
  horarios: "schedule",
  vagas: "linear_scale",
};

export function pluginVw(editor: Editor) {
  const dc = editor.DomComponents;

  // Bloco dinâmico: `<div data-vw="..."></div>`. Não aceita nada dentro, não é editável por dentro; o canvas mostra
  // uma caixa com o rótulo e uma prévia estática (só na view, nunca no HTML exportado).
  dc.addType("vw-bloco", {
    isComponent: (el) => (el && typeof el.getAttribute === "function" && el.getAttribute("data-vw") ? { type: "vw-bloco" } : false),
    model: {
      defaults: { tagName: "div", droppable: false, editable: false, traits: [], components: [] },
      init() {
        this.components().reset(); // conteúdo de prévia que veio no HTML não é do bloco
        const b = this.getAttributes()["data-vw"] as BlocoVw;
        this.set("name", `Bloco: ${ROTULO_BLOCO[b] ?? b}`);
      },
    },
    view: {
      onRender({ el, model }) {
        const b = model.getAttributes()["data-vw"] as BlocoVw;
        el.setAttribute("contenteditable", "false");
        el.innerHTML = `<div class="vw-ed-bloco"><strong>${escapar(ROTULO_BLOCO[b] ?? b)}</strong><span>${escapar(PREVIA_BLOCO[b] ?? "")}</span></div>`;
      },
    },
  });

  // Vídeo: caixa 16:9 com o iframe do YouTube/Vimeo/Bunny gerado a partir do link colado em Propriedades.
  dc.addType("vw-video", {
    isComponent: (el) => (el && el.classList && el.classList.contains("vw-video") ? { type: "vw-video" } : false),
    model: {
      defaults: {
        tagName: "div",
        name: "Vídeo",
        droppable: false,
        attributes: { class: "vw-video" },
        "url-video": "",
        traits: [{ type: "text", name: "url-video", label: "Link do vídeo", changeProp: true, placeholder: "https://www.youtube.com/watch?v=..." }],
        style: { position: "relative", width: "100%", "aspect-ratio": "16 / 9", background: "#111", "border-radius": "12px", overflow: "hidden" },
      },
      init() {
        const filho = this.components().at(0);
        const src = filho ? ((filho.getAttributes().src as string | undefined) ?? (filho.get("src") as string | undefined)) : undefined;
        if (!this.get("url-video") && src) this.set("url-video", src);
        this.on("change:url-video", () => this.trigger("vw:video"));
        this.on("vw:video", () => {
          const embed = urlEmbedVideo(String(this.get("url-video") ?? ""));
          this.components(
            embed
              ? [{ tagName: "iframe", type: "default", attributes: { src: embed, allow: "autoplay; fullscreen; picture-in-picture", allowfullscreen: "allowfullscreen", frameborder: "0" }, style: ESTILO_FILHO_VIDEO, ...TRAVADO }]
              : [],
          );
        });
        if (src) this.trigger("vw:video");
      },
    },
  });

  const bm = editor.Blocks;
  for (const b of BLOCOS) {
    bm.add(`vw-${b}`, {
      label: ROTULO_BLOCO[b],
      category: "Blocos do webinar",
      media: icone(ICONE_BLOCO[b]),
      content: { type: "vw-bloco", attributes: { "data-vw": b } },
    });
  }

  const basico = "Básicos";
  bm.add("vw-titulo-texto", {
    label: "Título",
    category: basico,
    media: icone("title"),
    content: { type: "text", tagName: "h2", content: "Escreva o título", style: { "font-size": "32px", "font-weight": "800", "line-height": "1.2", margin: "0 0 12px" } },
  });
  bm.add("vw-texto", {
    label: "Texto",
    category: basico,
    media: icone("notes"),
    content: { type: "text", tagName: "p", content: "Escreva aqui o texto.", style: { "font-size": "18px", margin: "0 0 12px" } },
  });
  bm.add("vw-imagem", {
    label: "Imagem",
    category: basico,
    media: icone("image"),
    activate: true,
    content: { type: "image", style: { "max-width": "100%", height: "auto", display: "block" } },
  });
  bm.add("vw-botao", {
    label: "Botão / link",
    category: basico,
    media: icone("smart_button"),
    content: {
      type: "link",
      content: "Quero participar",
      attributes: { href: "#" },
      style: { display: "inline-block", padding: "14px 28px", "border-radius": "10px", background: "#16a34a", color: "#ffffff", "font-weight": "700", "text-decoration": "none" },
    },
  });
  bm.add("vw-caixa", {
    label: "Caixa",
    category: basico,
    media: icone("crop_square"),
    content: {
      tagName: "div",
      style: { padding: "24px", "min-height": "80px", "border-radius": "16px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" },
    },
  });
  bm.add("vw-colunas", {
    label: "2 colunas",
    category: basico,
    media: icone("view_column"),
    content: {
      tagName: "div",
      style: { display: "flex", "flex-wrap": "wrap", gap: "24px" },
      components: [
        { tagName: "div", style: { flex: "1 1 280px", "min-height": "80px", padding: "12px" } },
        { tagName: "div", style: { flex: "1 1 280px", "min-height": "80px", padding: "12px" } },
      ],
    },
  });
  bm.add("vw-video", { label: "Vídeo", category: basico, media: icone("smart_display"), content: { type: "vw-video" } });
}
