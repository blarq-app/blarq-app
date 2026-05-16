import "dotenv/config";
import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import { parseArtefactos } from "../src/lib/import/parseArtefactos";

const ART =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/60_PORTOFINO 4208 (ANGELICA OVALLE)/5- PRESUPUESTO/V6/V6_ARTEFACTOS_PORTOFINO_26.02.26.xlsx";

(async () => {
  // 1. App
  const project = await prisma.project.findFirst({ where: { name: "Portofino" } });
  if (!project) return console.log("no project");
  const budget = await prisma.budgetVersion.findFirst({
    where: { projectId: project.id, type: "artefactos", version: "V6" },
    include: { artefactoItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!budget) return console.log("no artefactos V6");

  const appSan = budget.artefactoItems.filter((i) => i.subcategory === "sanitario");
  console.log("=== APP — artefactos sanitario ===");
  let appTotal = 0;
  for (const it of appSan) {
    const sub = it.clientPrice * it.quantity;
    appTotal += sub;
    console.log(
      `  ${(it.name || "").slice(0, 24).padEnd(24)} qty=${String(it.quantity).padStart(2)} cp=$${String(Math.round(it.clientPrice)).padStart(9)} subtotal=$${String(Math.round(sub)).padStart(10)}`
    );
  }
  console.log(`  APP TOTAL sanitario: $${Math.round(appTotal).toLocaleString("es-CL")} (${appSan.length} items)`);

  // 2. Excel
  const buf = fs.readFileSync(ART);
  const parsed = parseArtefactos(buf);
  const xlsSan = parsed.items.filter((i) => i.subcategory === "sanitario");
  console.log("\n=== EXCEL (parseArtefactos) — artefactos sanitario ===");
  let xlsTotal = 0;
  for (const it of xlsSan) {
    const sub = it.clientPrice * it.quantity;
    xlsTotal += sub;
    console.log(
      `  ${(it.name || "").slice(0, 24).padEnd(24)} qty=${String(it.quantity).padStart(2)} cp=$${String(Math.round(it.clientPrice)).padStart(9)} subtotal=$${String(Math.round(sub)).padStart(10)}`
    );
  }
  console.log(`  EXCEL TOTAL sanitario: $${Math.round(xlsTotal).toLocaleString("es-CL")} (${xlsSan.length} items)`);

  console.log(
    `\nDIFERENCIA app - excel = $${Math.round(appTotal - xlsTotal).toLocaleString("es-CL")}`
  );
  await prisma.$disconnect();
})();
