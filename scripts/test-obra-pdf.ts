/**
 * End-to-end test: pull V5 from DB, render HTML, generate PDF.
 * Run: npx tsx scripts/test-obra-pdf.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";

const prisma = new PrismaClient();

async function main() {
  const b = await prisma.budgetVersion.findFirst({
    where: { version: "V5", project: { name: { contains: "Lefevre" } } },
    include: {
      project: true,
      obraItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!b) throw new Error("V5 not found");

  const html = renderObraHTML({
    project: b.project,
    budget: {
      version: b.version,
      date: b.date,
      ggPercentage: b.ggPercentage,
      utilityPercentage: b.utilityPercentage,
    },
    items: b.obraItems,
    paymentTerms: b.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });

  fs.writeFileSync("/tmp/obra-v5.html", html);
  console.log(`Wrote /tmp/obra-v5.html (${html.length} bytes)`);

  const pdf = await renderPDF(html, {
    format: "A4",
    displayHeaderFooter: false,
    margin: { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" },
  });

  fs.writeFileSync("/tmp/obra-v5.pdf", pdf);
  console.log(`Wrote /tmp/obra-v5.pdf (${pdf.byteLength} bytes)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
