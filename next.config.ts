import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium contiene el binario de Chromium compilado para
  // AWS Lambda (~50 MB). Next.js debe tratarlo como "external" para que
  // NO lo intente bundle-ar al runtime serverless. En dev (mac) seguimos
  // usando puppeteer regular.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "puppeteer"],
  // CRÍTICO para Vercel: aunque sea external, Next.js sin esto NO copia
  // la carpeta /bin (con los .br comprimidos de Chromium) al deployment.
  // Sin estos archivos, executablePath() falla con "input directory does
  // not exist". outputFileTracingIncludes fuerza la inclusión para esa
  // ruta específica.
  outputFileTracingIncludes: {
    "/api/presupuestos/[id]/pdf": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
};

export default nextConfig;
