"use client";
import { useActionState, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Campo, CampoSelecao, erroArquivosDoFormulario, estiloInput } from "../../../_componentes/ui";
import { Acordeao, AvisoFormulario, Interruptor } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { salvarInicio, type Resultado } from "./actions";

type Idioma = "pt-BR" | "es" | "en";

type Valores = {
  nome: string;
  titulo: string;
  slug: string;
  idioma: Idioma;
  apresentadorNome: string;
  apresentadorAvatarUrl: string | null;
  acessoFacilitado: boolean;
  loginNaSala: boolean;
  sincronizarVideo: boolean;
};

const IDIOMAS: { valor: Idioma; rotulo: string }[] = [
  { valor: "pt-BR", rotulo: "🇧🇷 Português" },
  { valor: "es", rotulo: "🇪🇸 Espanhol" },
  { valor: "en", rotulo: "🇺🇸 Inglês" },
];

/** Prefixo do endereço mostrado dentro do campo do link (o domínio da sala em `NEXT_PUBLIC_SALA_URL`). */
function prefixoEndereco(salaUrl: string): string {
  const base = salaUrl.replace(/\/+$/, "");
  return `${base || "https://seu-dominio.com.br"}/`;
}

export function FormularioInicio({ idFormulario, webinarId, valores, salaUrl }: { idFormulario: string; webinarId: string; valores: Valores; salaUrl: string }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarInicio.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  // Se a última tentativa deu erro, usa o que a pessoa digitou; senão, o que está salvo.
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        nome: v.nome ?? valores.nome,
        titulo: v.titulo ?? valores.titulo,
        slug: v.slug ?? valores.slug,
        idioma: (v.idioma as Idioma) ?? valores.idioma,
        apresentadorNome: v.apresentador_nome ?? valores.apresentadorNome,
        apresentadorAvatarUrl: valores.apresentadorAvatarUrl,
        acessoFacilitado: v.acesso_facilitado === "on",
        loginNaSala: v.login_na_sala === "on",
        sincronizarVideo: v.sincronizar_video === "on",
      }
    : valores;
  const [nome, setNome] = useState(efetivos.nome);
  const [titulo, setTitulo] = useState(efetivos.titulo);
  const [slug, setSlug] = useState(efetivos.slug);
  const [apresentador, setApresentador] = useState(efetivos.apresentadorNome);
  const [previa, setPrevia] = useState<string | null>(efetivos.apresentadorAvatarUrl);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  // Remonta os campos (com os novos defaultValues) a cada tentativa, sem perder o que foi digitado.
  const chaveTentativa = estado.erro ?? "inicial";

  // A action falhou: o avatar escolhido não foi salvo, então a prévia não pode continuar mostrando ele. Depende
  // de `estado` (não de `estado.erro`) porque duas tentativas seguidas podem falhar com a mesma mensagem.
  useEffect(() => {
    if (estado.erro) setPrevia(valores.apresentadorAvatarUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  function aoEscolherAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setPrevia(URL.createObjectURL(arquivo));
  }

  function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    const erro = erroArquivosDoFormulario(e.currentTarget);
    setErroArquivo(erro);
    if (erro) e.preventDefault();
  }

  const prefixo = prefixoEndereco(salaUrl);

  return (
    <form id={idFormulario} action={enviar} onSubmit={aoEnviar} className="space-y-6" key={chaveTentativa}>
      <div className="grid gap-x-6 gap-y-5 tela-slg:grid-cols-2">
        <Campo rotulo="Nome do webinar" obrigatorio contador={`${nome.length} de 150`} dica="Só você vê este nome, no painel.">
          <input name="nome" className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} required />
        </Campo>

        <Campo rotulo="Título do webinar" contador={`${titulo.length} de 150`} dica="Aparece na sala e nas páginas.">
          <input name="titulo" className={estiloInput} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={150} />
        </Campo>

        <Campo rotulo="URL amigável" obrigatorio dica="Só letras minúsculas, números e hífen." className="tela-slg:col-span-2">
          <span className="flex w-full min-w-0 items-stretch overflow-hidden rounded-md border border-borda bg-superficie shadow-controle focus-within:border-marca focus-within:ring-2 focus-within:ring-marca/20">
            <span className="flex max-w-[60%] shrink-0 items-center truncate border-r border-linha bg-suave px-3 text-sm text-texto-3" title={prefixo}>
              {prefixo}
            </span>
            <input
              name="slug"
              aria-label="URL amigável"
              className="h-9 w-full min-w-0 bg-transparent px-3 text-sm text-texto outline-none"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </span>
        </Campo>

        <CampoSelecao rotulo="Escolha o idioma" name="idioma" defaultValue={efetivos.idioma} dica="Textos da sala, do login e dos e-mails.">
          {IDIOMAS.map((i) => (
            <option key={i.valor} value={i.valor}>
              {i.rotulo}
            </option>
          ))}
        </CampoSelecao>

        <Campo rotulo="Nome do apresentador" contador={`${apresentador.length} de 100`} dica="Aparece na sala de espera.">
          <input name="apresentador_nome" className={estiloInput} value={apresentador} onChange={(e) => setApresentador(e.target.value)} maxLength={100} />
        </Campo>

        <Campo rotulo="Foto do avatar" dica="JPG, PNG ou WebP, quadrada." className="tela-slg:col-span-2">
          <span className="flex items-center gap-4 max-tela-sm:flex-col max-tela-sm:items-start">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-borda bg-suave text-apagado">
              {previa ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previa} alt="" className="size-full object-cover" />
              ) : (
                <UserRound size={28} aria-hidden />
              )}
            </span>
            <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" onChange={aoEscolherAvatar} className={estiloInput} />
          </span>
        </Campo>
      </div>

      <Acordeao titulo="Opções avançadas" aberto={efetivos.acessoFacilitado || efetivos.loginNaSala || efetivos.sincronizarVideo}>
        <p className="text-sm font-medium text-texto">Forma de acesso à sala</p>
        <Interruptor
          name="acesso_facilitado"
          defaultChecked={efetivos.acessoFacilitado}
          rotulo="Acesso facilitado"
          descricao="A pessoa entra direto na sala, sem confirmar o e-mail."
        />
        <Interruptor
          name="login_na_sala"
          defaultChecked={efetivos.loginNaSala}
          rotulo="Fazer o login dentro da sala"
          descricao="Pede os dados dentro da sala. Exige o acesso facilitado."
        />
        <Interruptor
          name="sincronizar_video"
          defaultChecked={efetivos.sincronizarVideo}
          rotulo="Sincronizar vídeo com o tempo de início do webinar"
          descricao="Quem entra atrasado cai no ponto atual do vídeo."
        />
      </Acordeao>

      <AvisoFormulario erro={erroArquivo ?? estado.erro} ok={estado.ok ? "Início salvo." : null} />
    </form>
  );
}
