// Exporta a CSV las facturas potencialmente arrastradas por reglas con
// projectId que ya fueron borradas. Pensado para que MJ marque OK/cambiar
// directamente en Excel.
//
// Output: ~/Desktop/audit-facturas-arrastradas-YYYYMMDD.csv (UTF-8 con BOM,
// para que Excel chileno lo abra con acentos OK).
//
// Correr: DATABASE_URL=<url prod> npx tsx scripts/export-audit-csv.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { prisma } from "../src/lib/prisma";

const CASOS = [
  { rut: "76568660-1", nombre: "EASY RETAIL", proyectoSospechoso: "Cocina Farellones" },
  { rut: "76568660-1", nombre: "EASY RETAIL", proyectoSospechoso: "Portofino" },
  { rut: "79831880-2", nombre: "Scanavini", proyectoSospechoso: "Portofino" },
  { rut: "88669200-5", nombre: "HABITAT", proyectoSospechoso: "Cocina Farellones" },
  { rut: "78137094-0", nombre: "MST GROUP", proyectoSospechoso: "Portofino" },
  { rut: "77331410-1", nombre: "TEMPORA", proyectoSospechoso: "Cocina Farellones" },
  { rut: "94668000-1", nombre: "CODELPA", proyectoSospechoso: "Cocina Farellones" },
  { rut: "96803460-K", nombre: "SHERWIN WILLIAMS", proyectoSospechoso: "Portofino" },
];

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Excel chileno usa ";" como separador. Escapamos comillas dobles y
  // envolvemos en comillas si tiene ; o " o salto de línea.
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const rows: string[][] = [];
  rows.push([
    "Proveedor",
    "RUT",
    "Folio",
    "Fecha emisión",
    "Monto",
    "Categoría",
    "Proyecto actual",
    "Sospechoso porque",
    "Δ tiempo (sync → asignación)",
    "Decisión (OK / cambiar a ...)",
    "Path en la app",
  ]);

  for (const c of CASOS) {
    const proyecto = await prisma.project.findFirst({
      where: { name: c.proyectoSospechoso },
      select: { id: true, name: true },
    });
    if (!proyecto) continue;

    const facts = await prisma.invoice.findMany({
      where: { rutIssuer: c.rut, projectId: proyecto.id },
      select: {
        id: true,
        folioNumber: true,
        issueDate: true,
        totalAmount: true,
        category: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { issueDate: "desc" },
    });

    for (const f of facts) {
      const ms = f.updatedAt.getTime() - f.createdAt.getTime();
      let delta = "";
      if (ms < 5000) delta = `${ms}ms`;
      else if (ms < 60000) delta = `${Math.round(ms / 1000)}s`;
      else if (ms < 3600000) delta = `${Math.round(ms / 60000)}min`;
      else if (ms < 86400000) delta = `${Math.round(ms / 3600000)}h`;
      else delta = `${Math.round(ms / 86400000)}d`;

      rows.push([
        c.nombre,
        c.rut,
        f.folioNumber,
        f.issueDate.toISOString().slice(0, 10),
        String(f.totalAmount),
        f.category?.name ?? "",
        c.proyectoSospechoso,
        `Regla mala apuntaba a ${c.proyectoSospechoso}`,
        delta,
        "", // columna vacía para que MJ escriba
        `/facturas/${f.id}`,
      ]);
    }
  }

  // CSV con separador ; para Excel chileno + BOM UTF-8 para acentos
  const BOM = "﻿";
  const csv = BOM + rows.map((r) => r.map(csvCell).join(";")).join("\n");

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outPath = path.join(os.homedir(), "Desktop", `audit-facturas-arrastradas-${today}.csv`);
  fs.writeFileSync(outPath, csv, "utf-8");

  console.log(`OK — ${rows.length - 1} facturas exportadas a:`);
  console.log(`     ${outPath}`);
  console.log(`\nAbrilo con doble click. Excel debería detectar ";" como separador automáticamente.`);
  console.log(`Si por algún motivo abre todo en una sola columna: Datos → Texto en columnas → Delimitado → Punto y coma.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
