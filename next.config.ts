import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium contiene el binario de Chromium compilado para
  // AWS Lambda (~50 MB). Next.js debe tratarlo como "external" para que
  // NO lo intente bundle-ar al runtime serverless — si lo bundlea, el
  // binario se rompe y el endpoint /api/presupuestos/[id]/pdf devuelve
  // 500 en prod. En dev (mac) seguimos usando puppeteer regular.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "puppeteer"],
};

export default nextConfig;
