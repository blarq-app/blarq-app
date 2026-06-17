// Estado de Resultado — VISTA FACTURACIÓN (lo que se declara al SII).
//
// Corte MENSUAL de TODO el estudio, leyendo SOLO facturas (DTE):
//   - Ingresos = facturas EMITIDAS (ventas). Una NC emitida (tipoDoc=61) resta
//     (devolución al cliente).
//   - Egresos  = facturas RECIBIDAS reales (proveedores), desglosadas por
//     categoría de costo. Una NC recibida (tipoDoc=61) resta. NO entran:
//     sueldos, previred, impuestos, ni pagos sin factura (1043) — nada de eso
//     es un DTE ni va en el F29.
//
// Sirve para: leer el F29 (IVA débito de ventas − IVA crédito de compras) y
// ver si el estudio gana o pierde EN FACTURACIÓN. La plata real (caja) vive en
// la otra vista (estadoResultadoCaja.ts).
//
// Base de montos (con MJ): barras y desglose en c/IVA; utilidad en NETO (el
// IVA es de paso al SII). Misma convención de signo de NC que metrics.ts.

import { prisma } from "@/lib/prisma";

const ncSign = (tipoDoc: number | null) => (tipoDoc === 61 ? -1 : 1);

// Nombre de categoría "techo" de una factura recibida (Materiales, Mano de
// obra, etc.). Usa la categoría padre si existe.
function topCategoria(
  cat: { name: string; parent: { name: string } | null } | null
): string {
  if (!cat) return "Sin categoría";
  return cat.parent?.name ?? cat.name;
}

export type MonthBucket = {
  month: number; // 1..12

  // Ingresos (c/IVA, montos positivos)
  ventas: number; // emitidas no-NC
  devoluciones: number; // NC emitidas (magnitud positiva, ya restada del ingreso)
  ingreso: number; // ventas − devoluciones

  // Egresos (c/IVA, montos positivos)
  egresoPorCategoria: Record<string, number>; // por categoría techo, neto de NC
  egreso: number; // total facturas recibidas, neto de NC

  // Resultado (NETO, sin IVA)
  utilidadNeta: number; // ingreso neto − egreso neto
  utilidadAcumulada: number; // suma corrida enero→mes (se calcula pero el gráfico usa utilidadNeta)

  // IVA del mes (para el F29)
  ivaDebito: number; // IVA de ventas
  ivaCredito: number; // IVA de compras
  ivaPagar: number; // débito − crédito
};

export type EstadoResultadoFacturacion = {
  year: number;
  months: MonthBucket[]; // siempre 12
  categorias: string[]; // categorías de egreso presentes en el año, ordenadas por monto
  availableYears: number[];
  totales: {
    ventas: number;
    devoluciones: number;
    ingreso: number;
    egresoPorCategoria: Record<string, number>;
    egreso: number;
    utilidadNeta: number;
    ivaDebito: number;
    ivaCredito: number;
    ivaPagar: number;
  };
};

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

export async function computeEstadoResultadoFacturacion(
  year: number
): Promise<EstadoResultadoFacturacion> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const ventas = Array(12).fill(0);
  const devoluciones = Array(12).fill(0);
  const ingresoNeto = Array(12).fill(0);
  const egresoNeto = Array(12).fill(0);
  const ivaDebito = Array(12).fill(0);
  const ivaCredito = Array(12).fill(0);
  // Egresos por categoría y por mes: { categoría -> number[12] }
  const egresoCat: Record<string, number[]> = {};
  const addCat = (cat: string, m: number, v: number) => {
    (egresoCat[cat] ??= Array(12).fill(0))[m] += v;
  };

  const invoices = await prisma.invoice.findMany({
    where: { issueDate: { gte: start, lt: end } },
    select: {
      type: true,
      tipoDoc: true,
      issueDate: true,
      netAmount: true,
      iva: true,
      totalAmount: true,
      category: {
        select: { name: true, parent: { select: { name: true } } },
      },
    },
  });

  for (const inv of invoices) {
    const m = inv.issueDate.getMonth();
    const s = ncSign(inv.tipoDoc);

    if (inv.type === "emitida") {
      if (inv.tipoDoc === 61) devoluciones[m] += inv.totalAmount;
      else ventas[m] += inv.totalAmount;
      ingresoNeto[m] += s * inv.netAmount;
      ivaDebito[m] += s * inv.iva;
    } else {
      // Solo facturas recibidas REALES (DTE). Los pagos sin factura (1043)
      // no son DTE y no entran a esta vista.
      if (inv.tipoDoc === 1043) continue;
      const cat = topCategoria(inv.category);
      addCat(cat, m, s * inv.totalAmount);
      egresoNeto[m] += s * inv.netAmount;
      ivaCredito[m] += s * inv.iva;
    }
  }

  let acum = 0;
  const months: MonthBucket[] = [];
  for (let m = 0; m < 12; m++) {
    const egresoPorCategoria: Record<string, number> = {};
    let egreso = 0;
    for (const [cat, arr] of Object.entries(egresoCat)) {
      if (arr[m] !== 0) egresoPorCategoria[cat] = arr[m];
      egreso += arr[m];
    }
    const ingreso = ventas[m] - devoluciones[m];
    const utilidadNeta = ingresoNeto[m] - egresoNeto[m];
    acum += utilidadNeta;
    months.push({
      month: m + 1,
      ventas: ventas[m],
      devoluciones: devoluciones[m],
      ingreso,
      egresoPorCategoria,
      egreso,
      utilidadNeta,
      utilidadAcumulada: acum,
      ivaDebito: ivaDebito[m],
      ivaCredito: ivaCredito[m],
      ivaPagar: ivaDebito[m] - ivaCredito[m],
    });
  }

  // Categorías presentes en el año, ordenadas por monto total desc.
  const totalPorCat: Record<string, number> = {};
  for (const [cat, arr] of Object.entries(egresoCat))
    totalPorCat[cat] = arr.reduce((s, v) => s + v, 0);
  const categorias = Object.keys(totalPorCat).sort(
    (a, b) => totalPorCat[b] - totalPorCat[a]
  );

  const totales = {
    ventas: sum(months, "ventas"),
    devoluciones: sum(months, "devoluciones"),
    ingreso: sum(months, "ingreso"),
    egresoPorCategoria: totalPorCat,
    egreso: sum(months, "egreso"),
    utilidadNeta: sum(months, "utilidadNeta"),
    ivaDebito: sum(months, "ivaDebito"),
    ivaCredito: sum(months, "ivaCredito"),
    ivaPagar: sum(months, "ivaPagar"),
  };

  const availableYears = await getAvailableYears();
  return { year, months, categorias, availableYears, totales };
}

function sum(months: MonthBucket[], key: keyof MonthBucket): number {
  return months.reduce((s, b) => s + (b[key] as number), 0);
}
