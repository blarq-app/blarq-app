// Estado de Resultado — VISTA CAJA (plata real del banco).
//
// Corte MENSUAL estilo Maxxa, leyendo los MOVIMIENTOS BANCARIOS + lo que sabe
// la conciliación. Es el flujo real: lo que entró y salió de la cuenta.
//   - Conciliado a factura → se etiqueta con la categoría de esa factura
//     (Materiales, Mano de obra, etc.) si es egreso; "Ingresos por ventas" si
//     es cobro.
//   - Sin factura (sueldo, previred, impuestos, etc.) → su categoría del banco.
//   - Sin clasificar todavía → "No asignado".
//   - Traspasos entre cuentas BLARQ → fila propia (suman cero, informativos).
//   - Devoluciones neto-cero → se ignoran (no son ingreso ni gasto).
//
// A diferencia de la vista facturación, acá SÍ entran sueldos y todo lo que se
// movió. Montos tal como vienen del banco (sin desglose de IVA).

import { prisma } from "@/lib/prisma";

// Etiqueta legible para una categoría de movimiento sin factura.
const ETIQUETA_CATEGORIA: Record<string, string> = {
  sueldo: "Sueldos",
  previred: "Previred",
  comision_bancaria: "Gastos financieros",
  impuestos: "Impuestos",
  retiro_personal: "Retiro personal",
  compra_tarjeta: "Compra con tarjeta",
  deposito_efectivo: "Depósito en efectivo",
  reembolso_proveedor: "Reembolso de proveedor",
  otro_sin_factura: "Otros sin factura",
};

function topCategoria(
  cat: { name: string; parent: { name: string } | null } | null
): string {
  if (!cat) return "Sin categoría";
  return cat.parent?.name ?? cat.name;
}

export type CajaRow = {
  label: string;
  tipo: "ingreso" | "egreso";
  monthly: number[]; // 12 — ingresos positivos, egresos negativos
  total: number;
};

export type EstadoResultadoCaja = {
  year: number;
  ingresoRows: CajaRow[];
  egresoRows: CajaRow[];
  totalIngreso: number[]; // 12
  totalEgreso: number[]; // 12 (negativo)
  totalMes: number[]; // 12
  acumulado: number[]; // 12
  // Totales del año
  totalIngresoAnual: number;
  totalEgresoAnual: number;
  totalAnual: number;
};

export async function computeEstadoResultadoCaja(
  year: number
): Promise<EstadoResultadoCaja> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const movs = await prisma.bankMovement.findMany({
    where: { date: { gte: start, lt: end } },
    select: {
      date: true,
      amount: true,
      type: true,
      category: true,
      status: true,
      payments: {
        select: {
          amountApplied: true,
          invoice: {
            select: {
              type: true,
              category: { select: { name: true, parent: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  // key = `${tipo}|${label}` -> number[12]
  const rows: Record<string, { label: string; tipo: "ingreso" | "egreso"; monthly: number[] }> = {};
  const add = (tipo: "ingreso" | "egreso", label: string, m: number, v: number) => {
    const key = `${tipo}|${label}`;
    (rows[key] ??= { label, tipo, monthly: Array(12).fill(0) }).monthly[m] += v;
  };

  for (const mov of movs) {
    const m = mov.date.getMonth();
    const tipo = mov.type === "abono" ? "ingreso" : "egreso";
    const signo = mov.amount < 0 ? -1 : 1;

    if (mov.status === "neto_cero") continue;
    if (mov.status === "interno") {
      add(tipo, "Traspasos entre cuentas", m, mov.amount);
      continue;
    }

    if (mov.payments && mov.payments.length > 0) {
      let aplicado = 0;
      for (const p of mov.payments) {
        aplicado += p.amountApplied;
        const label =
          tipo === "ingreso"
            ? "Ingresos por ventas"
            : topCategoria(p.invoice?.category ?? null);
        add(tipo, label, m, signo * p.amountApplied);
      }
      const resto = Math.abs(mov.amount) - aplicado;
      if (resto > 1) add(tipo, "No asignado", m, signo * resto);
      continue;
    }

    if (mov.category) {
      const label = ETIQUETA_CATEGORIA[mov.category] ?? mov.category;
      add(tipo, label, m, mov.amount);
    } else {
      add(tipo, "No asignado", m, mov.amount);
    }
  }

  const toRow = (r: { label: string; tipo: "ingreso" | "egreso"; monthly: number[] }): CajaRow => ({
    ...r,
    total: r.monthly.reduce((s, v) => s + v, 0),
  });

  const ingresoRows = Object.values(rows)
    .filter((r) => r.tipo === "ingreso")
    .map(toRow)
    .sort((a, b) => b.total - a.total);
  const egresoRows = Object.values(rows)
    .filter((r) => r.tipo === "egreso")
    .map(toRow)
    .sort((a, b) => a.total - b.total); // más negativo primero

  const totalIngreso = Array(12).fill(0);
  const totalEgreso = Array(12).fill(0);
  for (const r of ingresoRows) for (let m = 0; m < 12; m++) totalIngreso[m] += r.monthly[m];
  for (const r of egresoRows) for (let m = 0; m < 12; m++) totalEgreso[m] += r.monthly[m];

  const totalMes = totalIngreso.map((v, m) => v + totalEgreso[m]);
  const acumulado: number[] = [];
  let acc = 0;
  for (let m = 0; m < 12; m++) {
    acc += totalMes[m];
    acumulado.push(acc);
  }

  return {
    year,
    ingresoRows,
    egresoRows,
    totalIngreso,
    totalEgreso,
    totalMes,
    acumulado,
    totalIngresoAnual: totalIngreso.reduce((s, v) => s + v, 0),
    totalEgresoAnual: totalEgreso.reduce((s, v) => s + v, 0),
    totalAnual: totalMes.reduce((s, v) => s + v, 0),
  };
}
