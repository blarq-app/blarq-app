// Snapshot read-only de la vista Caja (Estado de Resultado) + Fondo Sueldos,
// para proteger el cambio "tipos de pago a/desde socios" (§4.1 de CLAUDE.md).
//
// Corre ANTES y DESPUÉS del cambio contra la base VIVA (ep-shy-morning) y se
// compara el JSON. Lo que se espera:
//   - El flujo total del banco (totalMes / totalAnual) NO cambia.
//   - El resultado de operación NO cambia.
//   - El TOTAL del bloque no-operativo NO cambia.
//   - Solo se mueve el SPLIT interno del no-operativo: lo que hoy es todo
//     "Retiros de socios" se reparte en Retiros / Sueldos socios / Bonos / Préstamos.
//   - El Fondo Sueldos NO cambia (no se toca fondoSueldos.ts).
//
// Uso:
//   npx tsx --env-file=.env.prod scripts/snapshot-caja-prestamos-socios.ts antes
//   npx tsx --env-file=.env.prod scripts/snapshot-caja-prestamos-socios.ts despues
// Luego: diff snapshot-caja-antes.json snapshot-caja-despues.json

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { computeEstadoResultadoCaja } from "../src/lib/dashboard/estadoResultadoCaja";
import { computeFondoSueldos, PROJECT_FONDO_INCLUDE } from "../src/lib/banco/fondoSueldos";

async function main() {
  const fase = process.argv[2] === "despues" ? "despues" : "antes";

  // Verificación de base viva: Paseo del Sena debe existir + factura reciente.
  const sena = await prisma.project.findFirst({
    where: { name: { contains: "Sena" } },
    select: { id: true, name: true },
  });
  const ultimaFactura = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true, folioNumber: true },
  });
  console.log(`[verificación base viva] proyecto: ${sena?.name ?? "NO ENCONTRADO"}`);
  console.log(`[verificación base viva] última factura: folio ${ultimaFactura?.folioNumber} (${ultimaFactura?.issueDate?.toISOString().slice(0, 10)})`);

  // Vista Caja para los años con data.
  const years = [2024, 2025, 2026];
  const caja: Record<number, unknown> = {};
  for (const y of years) {
    const c = await computeEstadoResultadoCaja(y);
    caja[y] = {
      // Solo los agregados que importan para el control + el desglose no-operativo.
      resultadoOperacionAnual: c.resultadoOperacionAnual,
      totalNoOperativoAnual: c.totalNoOperativoAnual,
      totalAnual: c.totalAnual,
      noOperativoRows: c.noOperativoRows.map((r) => ({ label: r.label, total: r.total })),
      // saldoPrestamos solo existe DESPUÉS del cambio; se incluye si está.
      saldoPrestamos: (c as unknown as { saldoPrestamos?: unknown }).saldoPrestamos ?? null,
    };
  }

  // Fondo Sueldos de 3 proyectos representativos (uno con muebles, etc.).
  const proyectos = await prisma.project.findMany({
    include: PROJECT_FONDO_INCLUDE,
    take: 60,
  });
  const fondo = proyectos
    .map((p) => {
      const f = computeFondoSueldos(p);
      return { name: p.name, fondoGenerado: Math.round(f.fondoGenerado), totalFondoMaximo: Math.round(f.totalFondoMaximo) };
    })
    .filter((f) => f.fondoGenerado !== 0 || f.totalFondoMaximo !== 0)
    .sort((a, b) => b.fondoGenerado - a.fondoGenerado)
    .slice(0, 8);

  const out = { fase, caja, fondo };
  const file = `snapshot-caja-${fase}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nSnapshot escrito en ${file}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
