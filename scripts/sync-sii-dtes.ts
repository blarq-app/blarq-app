// Sync local de facturas del SII → app, leyendo directo del Registro de
// Compras y Ventas con el certificado digital de BLARQ.
//
// Es el gemelo de scripts/sync-sii-pdfs.ts: corre en la mac de MJ (donde el
// cert vive y el WAF del SII no bloquea), y escribe a la base que se le
// indique vía DATABASE_URL. El botón "Sincronizar SII" de la app hace lo
// mismo desde Vercel — este script es el camino confiable si la nube falla.
//
// Uso:
//   npx tsx scripts/sync-sii-dtes.ts                       # mes actual, ambos tipos
//   npx tsx scripts/sync-sii-dtes.ts --from 2026-04-01 --to 2026-04-30
//   npx tsx scripts/sync-sii-dtes.ts --type recibida
//   DATABASE_URL="<prod>" npx tsx scripts/sync-sii-dtes.ts  # apuntar a prod

import "dotenv/config";
import { runSiiSync } from "../src/lib/sii/runSiiSync";
import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fromDate =
    arg("from") ??
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const toDate = arg("to");
  const type = arg("type") as "emitida" | "recibida" | undefined;
  const types = type ? [type] : undefined;

  console.log(`[sync-sii-dtes] desde ${fromDate} hasta ${toDate ?? "hoy"} — ${type ?? "ambos tipos"}`);
  const result = await runSiiSync({ fromDate, toDate, types });

  if (result.mockMode) {
    console.warn("[sync-sii-dtes] MODO MOCK — no hay certificado configurado, no se leyó del SII real.");
  }
  console.log(
    `[sync-sii-dtes] OK — creadas ${result.created}, actualizadas ${result.updated}, sin cambio ${result.unchanged}, NCs linkeadas ${result.ncLinked}`
  );
}

main()
  .catch((e) => {
    console.error("[sync-sii-dtes] Error:", (e as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
