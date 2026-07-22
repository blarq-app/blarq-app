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
import {
  esSocio,
  esCategoriaFinanciamientoSocio,
  CATEGORIA_PRESTAMO_SOCIO,
  SALDO_INICIAL_PRESTAMOS_SOCIOS,
} from "@/lib/banco/socios";
import { effectiveSalaryPeriod } from "@/lib/banco/salaryPeriod";

// Socios de BLARQ: un pago hacia/desde ellos NO es gasto de operación. La
// definición de "quién es socio" vive en banco/socios.ts (misma que usa el
// import de cartolas, para no desincronizarse).
const esPagoSocio = esSocio;

// Tipos de pago a/desde socios, según la categoría que MJ le pone al
// movimiento en el banco. TODOS van al bloque NO operativo (no son costo de
// operar), pero en filas separadas para el orden contable:
//   - Retiro (default): sacan utilidad para uso personal.
//   - Sueldo: lo que se pagan por su trabajo (decisión MJ: no-operativo, fila propia).
//   - Bono: pago extra (decisión MJ: no-operativo, fila propia).
//   - Préstamo / Adelanto de socio: financiamiento en los dos sentidos (ver el
//     detalle en banco/socios.ts). NI gasto NI retiro: es una cuenta por
//     cobrar/pagar. Alimenta el saldo por socio (ver computeSaldoPrestamosSocios).
// El reembolso (devolución de un gasto de bolsillo) NO usa categoría: se
// resuelve conciliando el egreso contra la factura del proveedor (PR #239),
// y queda como gasto de operación. No pasa por acá.
function labelPagoSocio(category: string | null): string {
  switch (category) {
    case CATEGORIA_PRESTAMO_SOCIO:
      return "Préstamos socios";
    case "sueldo":
      return "Sueldos socios";
    case "bono_socio":
      return "Bonos a socios";
    default:
      return "Retiros de socios";
  }
}

const ETIQUETA_CATEGORIA: Record<string, string> = {
  sueldo: "Sueldos",
  previred: "Previred",
  comision_bancaria: "Gastos financieros",
  impuestos: "Impuestos (SII)",
  retiro_personal: "Retiros de socios",
  prestamo_socio: "Préstamos de socios",
  bono_socio: "Bonos a socios",
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

// Préstamos entre un socio y la empresa, ACUMULADO hasta fin del año mostrado.
// El caso real de BLARQ: los socios le prestaron plata a la empresa (ej. ~$14M
// hace años) y la empresa se los devuelve de a poco. Por eso separamos:
//   - prestado: plata que ENTRÓ del socio a la empresa (ingresos / abonos).
//   - devuelto: plata que la empresa le DEVOLVIÓ al socio (egresos / cargos).
//   - saldo = prestado − devuelto = lo que la empresa AÚN le debe al socio.
// Mientras el préstamo original no esté registrado (prestado = 0), solo se
// puede mostrar lo devuelto a la fecha; el saldo aparece cuando MJ etiqueta ese
// depósito original como "Préstamo socio".
// Cuenta corriente con los socios, en conjunto (no separada por persona).
// saldo = saldoInicial + entradas − salidas.
//   saldo > 0 → BLARQ les debe a los socios.
//   saldo < 0 → los socios le deben a BLARQ.
export type SaldoPrestamosSocios = {
  saldoInicial: number; // lo que BLARQ debía antes de la app (camioneta 2022)
  entradas: number; // plata que entró de los socios
  salidas: number; // plata que salió hacia los socios
  saldo: number;
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
  // Saldo acumulado de la cuenta de préstamos con los socios, hasta fin del
  // año mostrado.
  saldoPrestamos: SaldoPrestamosSocios;
};

// Cuenta corriente con los socios: TODOS los movimientos de categoría
// "prestamo_socio" hasta `hasta` (fin del año mostrado), más el saldo de
// partida. Cross-year a propósito: un préstamo de hace años sigue vivo hasta
// que se devuelva entero.
//
// El signo hace todo: lo que entra sube lo que BLARQ debe, lo que sale lo baja.
// No hace falta distinguir "préstamo" de "devolución" — la suma es la misma.
export async function computeSaldoPrestamosSocios(
  hasta: Date
): Promise<SaldoPrestamosSocios> {
  const movs = await prisma.bankMovement.findMany({
    where: { category: CATEGORIA_PRESTAMO_SOCIO, date: { lt: hasta } },
    select: { amount: true },
  });
  let entradas = 0;
  let salidas = 0;
  for (const mov of movs) {
    if (mov.amount > 0) entradas += mov.amount;
    else salidas += -mov.amount;
  }
  const saldoInicial = SALDO_INICIAL_PRESTAMOS_SOCIOS;
  return {
    saldoInicial,
    entradas: Math.round(entradas),
    salidas: Math.round(salidas),
    saldo: Math.round(saldoInicial + entradas - salidas),
  };
}

export async function computeEstadoResultadoCaja(
  year: number
): Promise<EstadoResultadoCaja> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const movs = await prisma.bankMovement.findMany({
    where: {
      OR: [
        { date: { gte: start, lt: end } },
        // Sueldos y Previred se imputan al MES QUE CORRESPONDE, que puede caer
        // en otro mes/año que el de la transferencia (el sueldo de junio pagado
        // el 1-jul cuenta en junio). Los traemos de cualquier fecha; el guard
        // de año de abajo descarta los que no pertenecen a este cuadro.
        { category: { in: ["sueldo", "previred"] } },
      ],
    },
    select: {
      date: true,
      amount: true,
      type: true,
      category: true,
      status: true,
      salaryPeriod: true,
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
    const tipo = mov.type === "abono" ? "ingreso" : "egreso";
    const signo = mov.amount < 0 ? -1 : 1;

    // Mes de imputación. Regla general: la fecha del movimiento. Excepción:
    // sueldos y Previred SIN factura conciliada van al "mes que corresponde"
    // (el que fija MJ en el banco, o el default por fecha) — igual que la vista
    // por proyecto. Así el sueldo de junio pagado el 1-jul cuenta en junio, no
    // en julio. Un sueldo/previred cuyo período cae en OTRO año se omite de
    // este cuadro (aparece en el del año que le corresponde). Un sueldo
    // conciliado a factura es un reembolso (gasto de operación): NO se reubica,
    // queda en su fecha como cualquier otro gasto.
    let m: number;
    const usaPeriodo =
      (mov.category === "sueldo" || mov.category === "previred") &&
      !(mov.payments && mov.payments.length > 0);
    if (usaPeriodo) {
      const [yy, mm] = effectiveSalaryPeriod(mov).split("-").map(Number);
      if (yy !== year) continue;
      m = mm - 1;
    } else {
      // Traemos sueldo/previred de cualquier fecha (ver query); el resto de los
      // movimientos solo cuenta si su fecha cae dentro del año mostrado.
      if (mov.date < start || mov.date >= end) continue;
      m = mov.date.getMonth();
    }

    if (mov.status === "neto_cero") continue;
    if (mov.status === "interno") {
      add("op", tipo, "Traspasos entre cuentas", m, mov.amount);
      continue;
    }

    // ¿Pago hacia/desde un socio (MJ / JT)? Por sí solo NO es gasto de
    // operación (va al bloque no-operativo). PERO si un egreso a socio está
    // conciliado a una factura, esa parte es un REEMBOLSO: el socio adelantó de
    // su bolsillo un gasto del negocio (ej. pagó Easy con su tarjeta para
    // Portofino) y la empresa se lo devuelve. La parte conciliada es gasto de
    // operación (con la categoría de la factura); solo el resto NO conciliado
    // es pago a socio de verdad. Por eso NO cortamos acá: dejamos que el egreso
    // a socio pase por la lógica de payments de abajo, que ya reparte "aplicado
    // a facturas" vs "resto no conciliado".
    const movSocio = esPagoSocio(mov.counterpartyRut, mov.counterpartyName, mov.description);
    const egresoSocio = tipo === "egreso" && movSocio;

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
        // (El resto de un movimiento conciliado no tiene categoría propia, así
        // que el pago a socio acá siempre cae como retiro.)
        if (egresoSocio) add("no", "egreso", "Retiros de socios", m, signo * resto);
        else add("op", tipo, "No asignado", m, signo * resto);
      }
      continue;
    }

    // Pago a/desde socio SIN factura conciliada → bloque NO operativo, en la
    // fila que corresponde a su categoría (retiro / sueldo / bono / préstamo).
    // El préstamo puede ser egreso (la empresa presta) o ingreso (el socio le
    // presta a la empresa); por eso interceptamos también los ingresos cuando
    // están marcados como préstamo. El resto de los ingresos de socio (sin
    // categoría de préstamo) sigue el flujo normal de abajo.
    // Un préstamo/devolución de socio va SIEMPRE al bloque no operativo, aunque
    // la contraparte del banco no sea el socio. Caso real: BLARQ le pagó $500k a
    // un tercero (Rojas Mella) por cuenta de JT — como la glosa no dice "socio",
    // antes caía en el bloque OPERATIVO y restaba de la utilidad como si fuera
    // un gasto del negocio. Prestar plata no es costo de operar.
    if (esCategoriaFinanciamientoSocio(mov.category) || (movSocio && egresoSocio)) {
      add("no", tipo, labelPagoSocio(mov.category), m, mov.amount);
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

  const saldoPrestamos = await computeSaldoPrestamosSocios(end);

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
    saldoPrestamos,
  };
}
