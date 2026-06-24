// VERIFICACIÓN READ-ONLY contra la base VIVA (ep-shy-morning vía .env.prod).
// Carga Paseo del Sena V2 (obra) y muestra cómo quedan los capítulos, zonas,
// orden y subtotales con la lógica NUEVA (compartida editor↔PDF). No escribe
// nada. Correr: npx tsx scripts/verify-sena-zonas.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.prod", override: true });

import { PrismaClient } from "@prisma/client";
import { OBRA_CHAPTERS } from "../src/lib/utils";
import { annotateZones } from "../src/lib/presupuesto/zones";

const prisma = new PrismaClient();

async function main() {
  // Marcador de base viva: #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 } });
  console.log(`Marcador base viva → #64 = ${p64?.name ?? "(no existe)"}`);
  if (!p64 || !/sena/i.test(p64.name)) {
    console.error("NO estoy en la base viva (esperaba #64 = Paseo del Sena). Aborto.");
    process.exit(1);
  }

  const proj = await prisma.project.findFirst({
    where: { name: { contains: "Sena", mode: "insensitive" } },
  });
  if (!proj) throw new Error("No encontré el proyecto Sena");

  const budgets = await prisma.budgetVersion.findMany({
    where: { projectId: proj.id, type: "obra" },
    orderBy: { version: "asc" },
    include: { obraItems: { orderBy: { sortOrder: "asc" } } },
  });
  console.log(
    `Proyecto: ${proj.name} (#${proj.numeroProyecto}) — versiones obra: ${budgets
      .map((b) => b.version)
      .join(", ")}\n`
  );

  // Elegir V2 si existe, sino la última.
  const budget =
    budgets.find((b) => /v?2/i.test(b.version)) ?? budgets[budgets.length - 1];
  if (!budget) throw new Error("Sin versión de obra");
  console.log(`=== Versión analizada: ${budget.version} (${budget.status}) ===\n`);

  const items = budget.obraItems;

  // Reflow de capítulos igual que editor y PDF: OBRA_CHAPTERS, salta vacíos.
  const chapters = (
    Object.entries(OBRA_CHAPTERS) as [string, { label: string; pdfLabel: string }][]
  )
    .map(([key, ch]) => ({
      key,
      label: ch.label,
      pdfLabel: ch.pdfLabel,
      items: items
        .filter((i) => i.chapter === key)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((ch) => ch.items.length > 0)
    .map((ch, i) => ({ ...ch, index: i + 1 }));

  for (const ch of chapters) {
    console.log(
      `Cap ${ch.index}  editor:"${ch.label}"  pdf:"${ch.pdfLabel}"`
    );
    const { rows, zoneSubtotals, showZoneSubtotals } = annotateZones(ch.items);
    rows.forEach((row, idx) => {
      if (row.isZoneStart) {
        const sub = showZoneSubtotals
          ? "  [subtotal " +
            (zoneSubtotals.get(row.zone ?? "") ?? 0).toLocaleString("es-CL") +
            "]"
          : "";
        console.log(`   ── ${row.zone}${sub}`);
      }
      const inherited = !row.item.subChapter && row.zone ? " (heredó zona)" : "";
      console.log(
        `      ${ch.index}.${idx + 1}  ${row.item.name}  $${Math.round(
          row.item.total
        ).toLocaleString("es-CL")}${inherited}`
      );
    });
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
