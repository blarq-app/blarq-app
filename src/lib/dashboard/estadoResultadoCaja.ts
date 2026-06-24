// Estado de Resultado — VISTA CAJA (plata real del banco).
//
// Corte MENSUAL estilo Maxxa, leyendo los MOVIMIENTOS BANCARIOS + lo que sabe
// la conciliación. Es el flujo real: lo que entró y salió de la cuenta.
//
// Se muestra en DOS NIVELES (decidido con MJ 2026-06-17), para no mezclar
// "¿el negocio es rentable?" con "¿cuánta plata se movió?":
//   1. RESULTADO DE OPERACIÓN = ingresos − gastos del negocio (materiales,
//      mano de obra, subcontrato, sueldos de empleados, etc.).
//   2. NO OPERATIVO (bloque aparte): retiros de los socios (transferencias a
//      MJ / JT) y el pago de IVA al SII. Plata que sale, pero que NO es costo
//      de operar — uno es repartir la ganancia, el otro es devolver IVA que ya
//      se cobró al cliente. (Maxxa tampoco los mete en el resultado.)
//   3. TOTAL MES = resultado de operación − no operativo = flujo de caja real
//      completo (no se esconde nada).
//
// Clasificación de cada movimiento:
//   - Conciliado a factura → categoría de esa factura (si es egreso); "Ingresos
//     por ventas" si es cobro.
//   - Sin factura (sueldo, previred, etc.) → su categoría del banco.
//   - Sin clasificar → "No asignado".
//   - Traspaso interno entre cuentas BLARQ → fila propia (suma cero).
//   - Devolución neto-cero → se ignora.

import { prisma } from "@/lib/prisma";
import { esSocio } from "@/lib/banco/socios";

// Socios de BLARQ: una transferencia que sale hacia ellos es un RETIRO, no un
// gasto de operación. La definición de "quién es socio" vive en banco/socios.ts
// (misma que usa el import de cartolas, para no desincronizarse).
const esRetiroSocio = esSocio;

const ETIQUETA_CATEGORIA: Record<string, string> = {
  sueldo: "Sueldos",
  previred: "Previred",
  comision_bancaria: "Gastos financieros",
  impuestos: "Impuestos (SII)",
  retiro_personal: "Retiros de socios",
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
  ingresoRows: CajaRow[]; // operativo
  egresoRows: CajaRow[]; // operativo (gastos del negocio)
  noOperativoRows: CajaRow[]; // retiros de socios + impuestos (egresos)
  totalIngreso: number[];
  totalEgresoOperativo: number[];
  resultadoOperacion: number[]; // ingreso + egreso operativo
  totalNoOperativo: number[];
  totalMes: number[]; // flujo real completo = operación + no operativo
  acumulado: number[];
  // Totales anuales
  totalIngresoAnual: number;
  totalEgresoOperativoAnual: number;
  resultadoOperacionAnual: number;
  totalNoOperativoAnual: number;
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
      counterpartyName: true,
      counterpartyRut: true,
      description: true,
      payments: {
        select: {
          amountApplied: true,
          invoice: {
            select: {
              category: { select: { name: true, parent: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  // grupo: "operativo" | "no" — y dentro, key por etiqueta
  const rows: Record<
    string,
    { label: string; tipo: "ingreso" | "egreso"; grupo: "op" | "no"; monthly: number[] }
  > = {};
  const add = (
    grupo: "op" | "no",
    tipo: "ingreso" | "egreso",
    label: string,
    m: number,
    v: number
  ) => {
    const key = `${grupo}|${tipo}|${label}`;
    (rows[key] ??= { label, tipo, grupo, monthly: Array(12).fill(0) }).monthly[m] += v;
  };

  for (const mov of movs) {
    const m = mov.date.getMonth();
    const tipo = mov.type === "abono" ? "ingreso" : "egreso";
    const signo = mov.amount < 0 ? -1 : 1;

    if (mov.status === "neto_cero") continue;
    if (mov.status === "interno") {
      add("op", tipo, "Traspasos entre cuentas", m, mov.amount);
      continue;
    }

    // ¿Salida hacia un socio (MJ / JT)? Por sí sola sería un RETIRO (bloque NO
    // operativo). PERO si ese egreso está conciliado a una factura, esa parte
    // es un REEMBOLSO: el socio adelantó de su bolsillo un gasto del negocio
    // (ej. pagó Easy con su tarjeta para Portofino) y la empresa se lo devuelve.
    // La parte conciliada es gasto de operación (con la categoría de la factura),
    // NO un retiro; solo el resto NO conciliado es retiro de verdad. Por eso NO
    // cortamos acá: dejamos que el egreso a socio pase por la lógica de payments
    // de abajo, que ya reparte "aplicado a facturas" vs "resto no conciliado".
    const egresoSocio =
      tipo === "egreso" &&
      esRetiroSocio(mov.counterpartyRut, mov.counterpartyName, mov.description);

    if (mov.payments && mov.payments.length > 0) {
      let aplicado = 0;
      for (const p of mov.payments) {
        aplicado += p.amountApplied;
        const label =
          tipo === "ingreso"
            ? "Ingresos por ventas"
            : topCategoria(p.invoice?.category ?? null);
        add("op", tipo, label, m, signo * p.amountApplied);
      }
      const resto = Math.abs(mov.amount) - aplicado;
      if (resto > 1) {
        // El resto NO conciliado: si la salida es a un socio → retiro (NO
        // operativo); si no → "No asignado" del bloque operativo (como siempre).
        if (egresoSocio) add("no", "egreso", "Retiros de socios", m, signo * resto);
        else add("op", tipo, "No asignado", m, signo * resto);
      }
      continue;
    }

    // Egreso a socio SIN factura conciliada → retiro entero (como hasta ahora).
    if (egresoSocio) {
      add("no", "egreso", "Retiros de socios", m, mov.amount);
      continue;
    }

    if (mov.category) {
      // Impuestos → bloque NO operativo. Se distingue el pago al SII (egreso)
      // de una devolución de impuesto (abono), que antes compartían etiqueta.
      if (mov.category === "impuestos") {
        const label = tipo === "ingreso" ? "Devolución de impuestos" : "Impuestos (SII)";
        add("no", tipo, label, m, mov.amount);
        continue;
      }
      const label = ETIQUETA_CATEGORIA[mov.category] ?? mov.category;
      add("op", tipo, label, m, mov.amount);
    } else {
      add("op", tipo, "No asignado", m, mov.amount);
    }
  }

  const toRow = (r: { label: string; tipo: "ingreso" | "egreso"; monthly: number[] }): CajaRow => ({
    label: r.label,
    tipo: r.tipo,
    monthly: r.monthly,
    total: r.monthly.reduce((s, v) => s + v, 0),
  });

  const all = Object.values(rows);
  const ingresoRows = all
    .filter((r) => r.grupo === "op" && r.tipo === "ingreso")
    .map(toRow)
    .sort((a, b) => b.total - a.total);
  const egresoRows = all
    .filter((r) => r.grupo === "op" && r.tipo === "egreso")
    .map(toRow)
    .sort((a, b) => a.total - b.total);
  const noOperativoRows = all
    .filter((r) => r.grupo === "no")
    .map(toRow)
    .sort((a, b) => a.total - b.total);

  const sumRows = (rs: CajaRow[]) => {
    const acc = Array(12).fill(0);
    for (const r of rs) for (let m = 0; m < 12; m++) acc[m] += r.monthly[m];
    return acc;
  };
  const totalIngreso = sumRows(ingresoRows);
  const totalEgresoOperativo = sumRows(egresoRows);
  const totalNoOperativo = sumRows(noOperativoRows);
  const resultadoOperacion = totalIngreso.map((v, m) => v + totalEgresoOperativo[m]);
  const totalMes = resultadoOperacion.map((v, m) => v + totalNoOperativo[m]);
  const acumulado: number[] = [];
  let acc = 0;
  for (let m = 0; m < 12; m++) {
    acc += totalMes[m];
    acumulado.push(acc);
  }
  const anual = (a: number[]) => a.reduce((s, v) => s + v, 0);

  return {
    year,
    ingresoRows,
    egresoRows,
    noOperativoRows,
    totalIngreso,
    totalEgresoOperativo,
    resultadoOperacion,
    totalNoOperativo,
    totalMes,
    acumulado,
    totalIngresoAnual: anual(totalIngreso),
    totalEgresoOperativoAnual: anual(totalEgresoOperativo),
    resultadoOperacionAnual: anual(resultadoOperacion),
    totalNoOperativoAnual: anual(totalNoOperativo),
    totalAnual: anual(totalMes),
  };
}
