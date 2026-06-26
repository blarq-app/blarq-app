/**
 * Diagnóstico read-only: antes/después del reparto por MONTO de los movimientos
 * PARCIALES en las tarjetas de /banco/movimientos.
 *
 * Corre contra la base VIVA (ep-shy-morning). NO escribe nada.
 *
 * Compara:
 *   VIEJO: pendientes = sin_asignar + parcial (monto entero del parcial)
 *   NUEVO: el parcial se reparte → aplicado va a conciliado, libre a pendiente
 *
 * Lo hace para la vista GLOBAL (default de la página) y para la vista filtrada
 * de la pantalla que MJ mandó (búsqueda "94960185" = Maria Garces).
 */
import { config } from "dotenv";
config({ path: ".env.prod", override: true });

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const clp = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-CL");

async function calcular(where: Record<string, unknown>, etiqueta: string) {
  const [ingresos, egresos, parcialMovs, statusCounts] = await Promise.all([
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: { ...where, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: { ...where, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
    prisma.bankMovement.findMany({
      where: { ...where, status: "parcial" },
      select: { amount: true, payments: { select: { amountApplied: true } } },
    }),
    prisma.bankMovement.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const ingresoByStatus: Record<string, number> = {};
  for (const r of ingresos) ingresoByStatus[r.status] = r._sum.amount ?? 0;
  const egresoByStatus: Record<string, number> = {};
  for (const r of egresos) egresoByStatus[r.status] = Math.abs(r._sum.amount ?? 0);
  const countByStatus: Record<string, number> = {};
  for (const c of statusCounts) countByStatus[c.status] = c._count._all;

  const sumExcluyendoNetoCero = (b: Record<string, number>) =>
    Object.entries(b).filter(([s]) => s !== "neto_cero").reduce((a, [, v]) => a + v, 0);

  const totalIngresos = sumExcluyendoNetoCero(ingresoByStatus);
  const totalEgresos = sumExcluyendoNetoCero(egresoByStatus);
  const total = totalIngresos + totalEgresos;

  // VIEJO
  const conciliadoViejo = (ingresoByStatus.conciliado ?? 0) + (egresoByStatus.conciliado ?? 0);
  const pendienteViejo =
    (ingresoByStatus.sin_asignar ?? 0) + (ingresoByStatus.parcial ?? 0) +
    (egresoByStatus.sin_asignar ?? 0) + (egresoByStatus.parcial ?? 0);
  const totalCount = statusCounts.reduce((s, x) => s + x._count._all, 0);
  const pctViejo = totalCount > 0 ? Math.round(((countByStatus.conciliado ?? 0) / totalCount) * 100) : 0;

  // NUEVO: reparto del parcial por monto
  let aplI = 0, libI = 0, aplE = 0, libE = 0;
  for (const m of parcialMovs) {
    const aplicado = m.payments.reduce((s, p) => s + p.amountApplied, 0);
    const libre = Math.max(0, Math.abs(m.amount) - aplicado);
    if (m.amount >= 0) { aplI += aplicado; libI += libre; }
    else { aplE += aplicado; libE += libre; }
  }
  const conciliadoNuevo = (ingresoByStatus.conciliado ?? 0) + aplI + (egresoByStatus.conciliado ?? 0) + aplE;
  const pendienteNuevo = (ingresoByStatus.sin_asignar ?? 0) + libI + (egresoByStatus.sin_asignar ?? 0) + libE;
  const pctNuevo = total > 0 ? Math.round((conciliadoNuevo / total) * 100) : 0;

  console.log(`\n══════ ${etiqueta} ══════`);
  console.log(`  movimientos parciales: ${parcialMovs.length}  ·  aplicado en parciales: ${clp(aplI + aplE)}  ·  libre en parciales: ${clp(libI + libE)}`);
  console.log(`  TOTAL (excl. neto cero): ${clp(total)}`);
  console.log(`                         VIEJO            NUEVO           Δ`);
  console.log(`  Conciliado:   ${clp(conciliadoViejo).padStart(15)}  ${clp(conciliadoNuevo).padStart(15)}  ${(conciliadoNuevo - conciliadoViejo >= 0 ? "+" : "") + clp(conciliadoNuevo - conciliadoViejo)}`);
  console.log(`  Pendiente:    ${clp(pendienteViejo).padStart(15)}  ${clp(pendienteNuevo).padStart(15)}  ${(pendienteNuevo - pendienteViejo >= 0 ? "+" : "") + clp(pendienteNuevo - pendienteViejo)}`);
  console.log(`  % conciliado: ${(pctViejo + "%").padStart(15)}  ${(pctNuevo + "%").padStart(15)}   (viejo=por conteo, nuevo=por monto)`);
  console.log(`  cuadra TOTAL = Conciliado + Pendiente (nuevo)?  ${Math.abs(total - (conciliadoNuevo + pendienteNuevo)) < 1 ? "SÍ ✓" : "NO — revisar (hay sin_factura/interno fuera de ambas)"}`);
}

async function main() {
  // §4.9 — confirmar base VIVA
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  const dbUrl = process.env.DATABASE_URL ?? "";
  const host = dbUrl.match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`Base: host=${host}  ·  proyecto #64 = ${p64?.name ?? "(no existe)"}`);
  if (!host.includes("ep-shy-morning")) {
    console.log("⚠️  NO es la base viva (ep-shy-morning). Abortando para no concluir sobre datos viejos.");
    return;
  }

  // Vista GLOBAL (default de la página, sin filtros)
  await calcular({}, "GLOBAL (default de la página)");

  // Vista FILTRADA: búsqueda "94960185" (igual que la pantalla de MJ)
  const q = "94960185";
  const rutDigits = q.replace(/\D/g, "");
  const whereFiltrado: Record<string, unknown> = {
    OR: [
      { description: { contains: q, mode: "insensitive" } },
      { counterpartyName: { contains: q, mode: "insensitive" } },
      ...(rutDigits.length >= 3 ? [{ counterpartyRut: { contains: rutDigits } }] : []),
    ],
  };
  await calcular(whereFiltrado, 'FILTRADO: búsqueda "94960185" (pantalla de MJ)');

  // Detalle del movimiento parcial puntual (Maria Garces $2.374.198)
  const garces = await prisma.bankMovement.findFirst({
    where: { status: "parcial", amount: 2374198 },
    select: { amount: true, date: true, description: true, payments: { select: { amountApplied: true, invoice: { select: { folioNumber: true } } } } },
  });
  if (garces) {
    const aplicado = garces.payments.reduce((s, p) => s + p.amountApplied, 0);
    console.log(`\n── Detalle mov. parcial Maria Garces ──`);
    console.log(`  monto: ${clp(garces.amount)}  ·  aplicado: ${clp(aplicado)}  ·  libre: ${clp(garces.amount - aplicado)}`);
    console.log(`  payments: ${garces.payments.map((p) => `F-${p.invoice?.folioNumber} ${clp(p.amountApplied)}`).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
