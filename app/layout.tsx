import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: NOME_SISTEMA,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      {/* 13 px no body é o tamanho de base da sala do participante. O painel, o editor e o
          login definem 14 px nos próprios layouts. */}
      <body className="min-h-screen font-sans text-[13px] antialiased">{children}</body>
    </html>
  );
}
