import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";

export const metadata: Metadata = { title: `Entrar · ${NOME_SISTEMA}`, robots: { index: false, follow: false } };

export default function LayoutLogin({ children }: { children: React.ReactNode }) {
  return children;
}
