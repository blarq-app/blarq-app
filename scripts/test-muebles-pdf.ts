/**
 * End-to-end test: pull muebles V5 from DB, render HTML, generate PDF.
 * Run: npx tsx scripts/test-muebles-pdf.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { renderMueblesHTML } from "../src/lib/pdf/MueblesPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";

const prisma = new PrismaClient();

async function main() {
  const b = await prisma.budgetVersion.findFirst({
    where: {
      type: "muebles",
      project: { name: { contains: "Lefevre" } },
    },
    include: {
      project: true,
      muebleChapters: {
        orderBy: { chapterNumber: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: { details: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!b) throw new Error("muebles budget not found");

  const html = renderMueblesHTML({
    project: b.project,
    budget: {
      version: b.version,
      date: b.date,
      observations: b.observations,
    },
    chapters: b.muebleChapters.map((ch) => ({
      chapterNumber: ch.chapterNumber,
      name: ch.name,
      items: ch.items.map((i) => ({
        itemNumber: i.itemNumber,
        name: i.name,
        descriptionGeneral: i.descriptionGeneral,
        quantity: i.quantity,
        clientPriceIva: i.clientPriceIva,
        details: i.details.map((d) => ({
          name: d.name,
          material: d.material,
        })),
      })),
    })),
    paymentTerms: b.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });

  fs.writeFileSync("/tmp/muebles.html", html);
  console.log(`Wrote /tmp/muebles.html (${html.length} bytes)`);

  const pdf = await renderPDF(html, {
    format: "A4",
    displayHeaderFooter: false,
    margin: { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" },
  });

  fs.writeFileSync("/tmp/muebles.pdf", pdf);
  console.log(`Wrote /tmp/muebles.pdf (${pdf.byteLength} bytes)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
