import type { NextConfig } from "next";

const config: NextConfig = {
  // Importação de planilha (.xlsx) de chat/vendas simulados vai até 4 MB (o padrão das Server Actions é 1 MB);
  // o teto é 4 MB porque a Vercel limita o corpo de uma requisição serverless a 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default config;
