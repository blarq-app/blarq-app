// Sync local de PDFs oficiales del SII para facturas recibidas que aún no
// tienen pdfContent en BD.
//
// Corre LOCALMENTE (laptop de MJ) porque requiere cert digital + browser real
// para pasar el WAF del SII. NO va a Vercel.
//
// Uso:
//   npx tsx scripts/sync-sii-pdfs.ts                # baja todas las pendientes
//   npx tsx scripts/sync-sii-pdfs.ts --limit 10     # solo las primeras 10
//   npx tsx scripts/sync-sii-pdfs.ts --dry-run      # no escribe a BD
//   npx tsx scripts/sync-sii-pdfs.ts --headed       # ver el browser
//   npx tsx scripts/sync-sii-pdfs.ts --refetch-failed  # reintenta DTEs que
//                                                       # antes no aparecían
//
// Lógica:
//   1. Login + selección BLARQ
//   2. Bajar listado completo del SII (todas las páginas) → map por DTE
//   3. Para cada Invoice recibida sin pdfContent:
//      - Si la encontramos en el map → bajar PDF + guardar
//      - Si NO → marcar pdfFetchedAt sin pdfContent (= probó y no aparece)
//   4. Reportar resumen
//
// Recordatorio: tras un agregado de campos en Prisma, hay que reiniciar el
// dev server (no basta con prisma generate).

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  openSiiSession,
  closeSiiSession,
  loadAllSiiCodigos,
  downloadSiiPdf,
} from "../src/lib/sii/siiBrowser";

// Ventana (en días) durante la cual una factura que NO aparece en el listado
// del SII se sigue reintentando en cada corrida automática. Las facturas
// recién emitidas a veces tardan en publicarse en el listado; con esto se
// auto-curan. Pasada la ventana, asumimos que no va a aparecer y la marcamos
// como intentada para no reintentar para siempre.
const RETRY_WINDOW_DAYS = 30;

interface CliArgs {
  limit: number | null;
  dryRun: boolean;
  headed: boolean;
  refetchFailed: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = { limit: null, dryRun: false, headed: false, refetchFailed: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") out.limit = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") out.dryRun = true;
    else if (args[i] === "--headed") out.headed = true;
    else if (args[i] === "--refetch-failed") out.refetchFailed = true;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log(`Sync SII PDFs — limit=${args.limit ?? "all"} dryRun=${args.dryRun} headed=${args.headed} refetchFailed=${args.refetchFailed}`);

  // 1. Buscar Invoices recibidas pendientes.
  // Default: pdfContent null Y pdfFetchedAt null (= nunca se intentó).
  // Con --refetch-failed: incluye también las que se intentaron y fallaron
  // (pdfContent null Y pdfFetchedAt no null).
  const where = {
    type: "recibida",
    pdfContent: null,
    ...(args.refetchFailed ? {} : { pdfFetchedAt: null }),
    rutIssuer: { not: null },
    folioNumber: { not: null },
    tipoDoc: { not: null },
  };
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: "desc" },
    take: args.limit ?? undefined,
    select: {
      id: true,
      tipoDoc: true,
      folioNumber: true,
      rutIssuer: true,
      businessName: true,
      issueDate: true,
    },
  });

  console.log(`Encontradas ${invoices.length} facturas pendientes.\n`);
  if (invoices.length === 0) {
    console.log("Nada que hacer.");
    return;
  }

  // 2. Login + bajar listado completo.
  console.log("→ Abriendo sesión SII (login mTLS + warmup)…");
  const sii = await openSiiSession({ headless: !args.headed });

  try {
    console.log("→ Bajando listado completo del SII (paginado)…");
    const codigos = await loadAllSiiCodigos(sii, { maxPages: 20 });
    console.log(`  ${codigos.size} DTEs encontrados en listado SII.\n`);

    // 3. Iterar facturas y bajar PDFs.
    let okCount = 0;
    let notInListing = 0;
    let errCount = 0;

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const rut = String(inv.rutIssuer).split("-")[0]; // sin DV
      const key = `${rut}|${inv.folioNumber}|${inv.tipoDoc}`;
      const match = codigos.get(key);
      const tag = `[${i + 1}/${invoices.length}] ${inv.businessName ?? "?"} ${inv.tipoDoc}/${inv.folioNumber}`;

      if (!match) {
        // No aparece en el listado del SII esta vez. Puede ser que todavía no
        // esté publicada (factura reciente) o que quede fuera de las páginas
        // que bajamos. NO la marcamos como "ya intentada" si es reciente:
        // dejamos pdfFetchedAt en null para que las próximas corridas la
        // reintenten (se auto-cura cuando el SII la publica). Solo nos
        // rendimos con las viejas (> RETRY_WINDOW_DAYS), para no reintentar
        // para siempre las que nunca van a aparecer.
        const ageDays =
          (Date.now() - new Date(inv.issueDate).getTime()) / (1000 * 60 * 60 * 24);
        const giveUp = ageDays > RETRY_WINDOW_DAYS;
        console.log(
          `  ${tag} → ❌ no aparece en listado SII${
            giveUp ? " (vieja, no se reintenta)" : " (reciente, se reintenta luego)"
          }`
        );
        notInListing++;
        if (!args.dryRun && giveUp) {
          await prisma.invoice.update({
            where: { id: inv.id },
            data: { pdfFetchedAt: new Date() }, // marca probado, sin pdfContent
          });
        }
        continue;
      }

      try {
        // Pequeño delay anti-WAF entre PDFs.
        if (i > 0) await new Promise((r) => setTimeout(r, 1200));
        const pdf = await downloadSiiPdf(sii, match.codigo);
        console.log(`  ${tag} → ✅ ${(pdf.length / 1024).toFixed(0)}KB (CODIGO=${match.codigo})`);
        if (!args.dryRun) {
          await prisma.invoice.update({
            where: { id: inv.id },
            data: {
              siiCodigo: match.codigo,
              pdfContent: pdf,
              pdfFetchedAt: new Date(),
            },
          });
        }
        okCount++;
      } catch (e) {
        console.log(`  ${tag} → ⚠️  error: ${(e as Error).message}`);
        errCount++;
      }
    }

    console.log(`\nResumen: ${okCount} bajadas OK, ${notInListing} no aparecen en SII, ${errCount} con error.`);
    if (args.dryRun) console.log("(dry-run: no se escribió nada en BD)");
  } finally {
    await closeSiiSession(sii);
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
