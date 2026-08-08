// Diagnóstico del pendiente 145: cómo quedan apiladas las filas de pago del
// Cuadro Resumen antes y después de compactar cada columna hacia arriba.
//
// Corre contra la base VIVA (dotenv_config_path=.env.prod) e imprime, para
// Paseo del Sena, la grilla de pagos como se veía (agrupada por fecha exacta)
// y como se ve ahora (cada concepto de corrido), más los totales que NO se
// tienen que mover.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeCuadroResumen, type ConceptoKey } from "../src/lib/projects/cuadroResumen";

const prisma = new PrismaClient();

function fmt(n: number) {
  return "$" + Math.round(n).toLocaleString("es-CL");
}
function fmtDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}`;
}

async function main() {
  const proyecto = await prisma.project.findFirst({
    where: { name: { contains: "Sena" } },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!proyecto) throw new Error("No encontré Paseo del Sena");
  console.log(`=== #${proyecto.numeroProyecto} ${proyecto.name} ===\n`);

  const invoices = await prisma.invoice.findMany({
    where: { projectId: proyecto.id, type: "emitida" },
    include: { category: true, payments: { include: { bankMovement: true } } },
  });
  const budgets = await prisma.budgetVersion.findMany({
    where: { projectId: proyecto.id },
    include: {
      obraItems: true,
      muebleChapters: { include: { items: true } },
      artefactoItems: true,
    },
  });

  const data = computeCuadroResumen({ invoices, budgets } as never);
  const keys = data.conceptos.map((c) => c.key);

  console.log("ANTES — una fila por fecha (celda vacía = guion en el cuadro):");
  for (const r of data.pagos) {
    const cols = keys.map((k) => {
      const cell = r.porConcepto[k];
      return cell.monto ? `${fmtDate(r.date)} ${fmt(cell.monto)} #${cell.folio}` : "—";
    });
    console.log("  " + cols.map((c) => c.padEnd(26)).join(""));
  }

  // Misma compactación que hace el render.
  const columnas = keys.map((k) => ({
    key: k as ConceptoKey,
    celdas: data.pagos
      .filter((r) => r.porConcepto[k].monto)
      .map((r) => ({ ...r.porConcepto[k], date: r.date })),
  }));
  const alto = columnas.reduce((m, c) => Math.max(m, c.celdas.length), 0);
  console.log("\nDESPUÉS — cada columna de corrido:");
  for (let i = 0; i < alto; i++) {
    const cols = columnas.map((col) => {
      const cell = col.celdas[i];
      return cell ? `${fmtDate(cell.date)} ${fmt(cell.monto)} #${cell.folio}` : "—";
    });
    console.log("  " + cols.map((c) => c.padEnd(26)).join(""));
  }

  console.log("\nColumnas: " + data.conceptos.map((c) => c.label).join(" | "));
  console.log("\nTotales (no se tienen que mover):");
  console.log("  TOTAL ACORDADO: " + fmt(data.totalAcordado));
  console.log("  TOTAL PAGOS:    " + fmt(data.totalPagado));
  console.log("  SALDO:          " + fmt(data.saldoTotal));
  console.log("  AVANCE:         " + (data.avanceTotal * 100).toFixed(1) + "%");
  for (const c of data.conceptos) {
    console.log(`   · ${c.label}: pagado ${fmt(c.pagado)} · ${(c.avancePct * 100).toFixed(0)}%`);
  }
  console.log("\n  Fila de comparación: " + (data.anterior ? data.anterior.versionLabel : "no hay"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
