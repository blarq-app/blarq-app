// Estado de Resultado Anual — corte MENSUAL de TODO el estudio.
//
// OJO: esto NO es metrics.ts. metrics.ts es la única fuente de verdad de los
// totales POR PROYECTO. Esta vista es un corte distinto (mensual, todo BLARQ
// junto, sin separar por obra), pero usa la MISMA definición de qué cuenta
// como ingreso y egreso para no contradecir a metrics.ts:
//
//   - Ingreso (ventas)  = facturas EMITIDAS por issueDate. Una NC emitida
//                         (tipoDoc=61) resta (devolución al cliente).
//   - Egreso            = facturas RECIBIDAS (proveedores) + pagos sin factura
//                         (Invoice tipoDoc=1043) + egresos del banco sin
//                         factura (sueldos, previred, comisiones, impuestos,
//                         tarjeta sin respaldo). Una NC recibida (tipoDoc=61)
//                         resta del lado proveedores (el proveedor devolvió).
//
// Base de los montos (decidido con MJ 2026-06-17):
//   - Las BARRAS van en c/IVA (totalAmount) — MJ quiere ver la magnitud real
//     de plata que entró/salió, igual que en Maxxa.
//   - La UTILIDAD del mes y la acumulada van en NETO — el IVA es de paso al
//     SII, no es resultado. Coincide con utilidadReal de metrics.ts (neto vs
//     neto).
//   - El IVA a pagar se muestra aparte: IVA ventas (débito) − IVA compras
//     (crédito). Es lo que BLARQ le debe al SII por el mes.

import { prisma } from "@/lib/prisma";

// Convención de signo idéntica a metrics.ts: una nota de crédito (DTE 61)
// revierte una factura, así que resta.
const ncSign = (tipoDoc: number | null) => (tipoDoc === 61 ? -1 : 1);

export type MonthBucket = {
  month: number; // 1..12

  // --- Lado ingresos (montos positivos) ---
  ventas: number; // emitidas no-NC, c/IVA
  devoluciones: number; // NC emitidas, c/IVA (magnitud positiva, ya restada del ingreso)
  otrosIngresos: number; // sin fuente limpia hoy — queda 0 (ver nota abajo)
  ingreso: number; // c/IVA neto del lado ventas = ventas − devoluciones

  // --- Lado egresos (montos positivos) ---
  proveedores: number; // recibidas reales − NC recibidas, c/IVA
  sueldos: number; // banco, category=sueldo, sin factura
  otrosEgresos: number; // pagos sin factura (1043) + previred/comisiones/impuestos/tarjeta s/factura
  egreso: number; // c/IVA = proveedores + sueldos + otrosEgresos

  // --- Resultado (NETO) ---
  utilidadNeta: number; // ingreso neto − egreso neto (sin IVA)
  utilidadAcumulada: number; // suma corrida de utilidadNeta enero→mes

  // --- IVA del mes ---
  ivaPagar: number; // IVA débito (ventas) − IVA crédito (compras)
};

export type EstadoResultadoAnual = {
  year: number;
  months: MonthBucket[]; // siempre 12, enero..diciembre
  availableYears: number[];
  // Totales del año (atajo para el panel "Año completo")
  totales: {
    ventas: number;
    devoluciones: number;
    otrosIngresos: number;
    ingreso: number;
    proveedores: number;
    sueldos: number;
    otrosEgresos: number;
    egreso: number;
    utilidadNeta: number;
    ivaPagar: number;
  };
};

// Años con datos, para poblar el selector. Tomamos el rango entre la primera
// factura y el año actual (siempre incluimos el año en curso aunque esté
// vacío, así MJ puede mirar el año nuevo apenas empieza).
export async function getAvailableYears(): Promise<number[]> {
  const first = await prisma.invoice.findFirst({
    orderBy: { issueDate: "asc" },
    select: { issueDate: true },
  });
  const currentYear = new Date().getFullYear();
  const firstYear = first ? first.issueDate.getFullYear() : currentYear;
  const years: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) years.push(y);
  return years;
}

export async function computeEstadoResultadoAnual(
  year: number
): Promise<EstadoResultadoAnual> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  // Acumuladores por mes (índice 0..11)
  const ventas = Array(12).fill(0);
  const devoluciones = Array(12).fill(0);
  const proveedores = Array(12).fill(0);
  const sueldos = Array(12).fill(0);
  const otrosEgresos = Array(12).fill(0);
  // Para utilidad neta y IVA necesitamos los netos y el IVA por separado.
  const ingresoNeto = Array(12).fill(0);
  const egresoNeto = Array(12).fill(0);
  const ivaVentas = Array(12).fill(0); // débito fiscal
  const ivaCompras = Array(12).fill(0); // crédito fiscal

  // ── Facturas (emitidas y recibidas) por fecha de emisión ────────────────
  const invoices = await prisma.invoice.findMany({
    where: { issueDate: { gte: start, lt: end } },
    select: {
      type: true,
      tipoDoc: true,
      issueDate: true,
      netAmount: true,
      iva: true,
      totalAmount: true,
    },
  });

  for (const inv of invoices) {
    const m = inv.issueDate.getMonth();
    const s = ncSign(inv.tipoDoc);

    if (inv.type === "emitida") {
      // Ventas (c/IVA) y su contracara de devoluciones (NC).
      if (inv.tipoDoc === 61) devoluciones[m] += inv.totalAmount;
      else ventas[m] += inv.totalAmount;
      ingresoNeto[m] += s * inv.netAmount;
      ivaVentas[m] += s * inv.iva;
    } else {
      // recibida
      if (inv.tipoDoc === 1043) {
        // Pago sin factura → "otros egresos". No tiene IVA.
        otrosEgresos[m] += s * inv.totalAmount;
      } else {
        // Proveedor real (factura) o NC recibida (resta).
        proveedores[m] += s * inv.totalAmount;
        ivaCompras[m] += s * inv.iva;
      }
      egresoNeto[m] += s * inv.netAmount;
    }
  }

  // ── Egresos del banco sin factura ───────────────────────────────────────
  // Solo status="sin_factura": esos son egresos categorizados que NO están
  // respaldados por una factura. Los "conciliado" ya están representados por
  // su factura recibida (contarlos de nuevo sería doble conteo); los
  // "interno" (traspasos entre cuentas BLARQ) y "neto_cero" no son gasto.
  const bankEgresos = await prisma.bankMovement.findMany({
    where: {
      date: { gte: start, lt: end },
      type: "cargo",
      status: "sin_factura",
    },
    select: { date: true, amount: true, category: true },
  });

  for (const b of bankEgresos) {
    const m = b.date.getMonth();
    const monto = Math.abs(b.amount); // cargo viene negativo
    if (b.category === "sueldo") sueldos[m] += monto;
    else otrosEgresos[m] += monto; // previred, comisión, impuestos, tarjeta s/factura, etc.
    // Sin factura → sin IVA recuperable: el neto del egreso es el monto pleno.
    egresoNeto[m] += monto;
  }

  // ── Armado de buckets + acumulada ───────────────────────────────────────
  let acum = 0;
  const months: MonthBucket[] = [];
  for (let m = 0; m < 12; m++) {
    const ingreso = ventas[m] - devoluciones[m];
    const egreso = proveedores[m] + sueldos[m] + otrosEgresos[m];
    const utilidadNeta = ingresoNeto[m] - egresoNeto[m];
    acum += utilidadNeta;
    months.push({
      month: m + 1,
      ventas: ventas[m],
      devoluciones: devoluciones[m],
      otrosIngresos: 0, // ver nota: no hay fuente limpia sin doble-contar cobros
      ingreso,
      proveedores: proveedores[m],
      sueldos: sueldos[m],
      otrosEgresos: otrosEgresos[m],
      egreso,
      utilidadNeta,
      utilidadAcumulada: acum,
      ivaPagar: ivaVentas[m] - ivaCompras[m],
    });
  }

  const totales = {
    ventas: sum(months, "ventas"),
    devoluciones: sum(months, "devoluciones"),
    otrosIngresos: 0,
    ingreso: sum(months, "ingreso"),
    proveedores: sum(months, "proveedores"),
    sueldos: sum(months, "sueldos"),
    otrosEgresos: sum(months, "otrosEgresos"),
    egreso: sum(months, "egreso"),
    utilidadNeta: sum(months, "utilidadNeta"),
    ivaPagar: sum(months, "ivaPagar"),
  };

  const availableYears = await getAvailableYears();
  return { year, months, availableYears, totales };
}

function sum(months: MonthBucket[], key: keyof MonthBucket): number {
  return months.reduce((s, b) => s + (b[key] as number), 0);
}

// NOTA sobre "otros ingresos": en el modelo de la app no hay una fuente limpia
// de ingreso distinto de las ventas (facturas emitidas). Los abonos del banco
// sin factura (deposito_efectivo, etc.) son en su mayoría el COBRO de facturas
// ya contadas en ventas — sumarlos sería doble-contar. Por eso otrosIngresos
// queda en 0 hasta que exista una categoría de ingreso real sin factura.
