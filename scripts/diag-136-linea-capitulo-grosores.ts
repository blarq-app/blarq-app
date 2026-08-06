/**
 * Pendiente 136 — comparar el grosor de la línea negra que va debajo del título
 * de cada capítulo en el PDF de obra.
 *
 * SOLO LECTURA sobre la base viva: lee la cotización de obra de Casa Los
 * Algarrobos V1, renderiza el HTML tal cual lo hace la ruta de la app, y saca
 * un PDF por cada grosor pedido reemplazando únicamente el border-bottom de
 * `.cap` en el CSS ya generado. Nada se escribe en la base.
 *
 * Correr:
 *   npx dotenv -e ../../../.env.prod -- npx tsx scripts/diag-136-linea-capitulo-grosores.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import {
  getObraBaselineItems,
  computeChangeMarkers,
} from "../src/lib/presupuesto/versionDiff";

const prisma = new PrismaClient();

// Grosores a comparar. El primero es el actual (referencia).
const GROSORES = ["1px", "0.75px", "0.6px", "0.4px"];

const OUT = "/tmp/blarq-136-linea-capitulo";

async function main() {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`Base: ${host}`);

  const budget = await prisma.budgetVersion.findFirst({
    where: {
      type: "obra",
      version: "V1",
      project: { name: { contains: "Algarrobos" } },
    },
    include: {
      project: true,
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!budget) throw new Error("No se encontró la obra V1 de Casa Los Algarrobos");

  console.log(
    `Proyecto: ${budget.project.name} · ${budget.version} · ` +
      `${budget.obraChapters.length} capítulos · ${budget.obraItems.length} partidas`
  );

  const baseline = await getObraBaselineItems(budget);
  const markers = computeChangeMarkers(budget.obraItems, baseline);

  const html = renderObraHTML({
    project: budget.project,
    budget: {
      version: budget.version,
      date: budget.date,
      ggPercentage: budget.ggPercentage,
      utilityPercentage: budget.utilityPercentage,
      coverTitle: budget.coverTitle,
      coverSubtitle: budget.coverSubtitle,
      coverNote: budget.coverNote,
    },
    chapters: budget.obraChapters,
    items: budget.obraItems
      .filter((it) => !it.noCobrado)
      .map((it) => ({
        ...it,
        changeMarker: markers.get(it.lineageId)?.marker ?? null,
      })),
    paymentTerms: budget.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });

  // El CSS de `.cap` es la única regla con este border-bottom negro; las del
  // Cuadro Resumen (`.cuadro`) usan otro selector y quedan intactas.
  const REGLA_CAP = /(\.cap \{[^}]*?border-bottom: )([\d.]+px)( solid #36322C)/;
  if (!REGLA_CAP.test(html)) throw new Error("No se encontró la regla .cap en el CSS");

  fs.mkdirSync(OUT, { recursive: true });

  for (const grosor of GROSORES) {
    const variante = html.replace(REGLA_CAP, `$1${grosor}$3`);
    const pdf = await renderPDF(variante, {
      format: "A4",
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
    const file = path.join(OUT, `algarrobos-v1-cap-${grosor.replace(".", "_")}.pdf`);
    fs.writeFileSync(file, pdf);
    console.log(`${grosor.padStart(7)} → ${file} (${pdf.byteLength} bytes)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
