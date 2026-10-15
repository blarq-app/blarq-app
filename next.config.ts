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
  // not exist" y renderPDF.ts cae al plan B: bajar el navegador de GitHub
  // en cada arranque frío (lento, y se cae si GitHub se cae — pasó el
  // 2026-09-21 con un 504).
  //
  // Las claves son globs (picomatch) contra la ruta. La clave exacta con
  // "[id]" que había antes NO incluía nada: medido con `VERCEL=1 next build`
  // y mirando el .nft.json de cada ruta (0 archivos del bin). Con `**` sí
  // (4 archivos en las 7 rutas). No encontré el motivo exacto dentro de
  // Next — picomatch en aislado coincide con ambas — así que no cambiar a
  // rutas exactas sin volver a medir. Con `**` se cubren las 7 rutas que
  // generan PDF (presupuestos, EPs, facturas, lista de compra, liquidación,
  // gastos F22) y el maestro; el resto de /api no carga los 68 MB.
  outputFileTracingIncludes: {
    "/api/**/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/**/maestro": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
