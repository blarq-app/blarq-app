// F29 — Declaración Mensual y Pago Simultáneo de Impuestos.
//
// Reproduce el cálculo del F29 que hoy arma el contador (validado al peso
// contra el formulario real presentado al SII, abril 2026 folio 9017154606).
//
// Lee SOLO facturas (DTE). De cada factura usa neto/IVA/tipoDoc/fecha. El
// período tributario se toma por fecha de emisión (issueDate), mes a mes.
//
// Qué calcula HOY (lo que la app ya tiene datos para hacer bien):
//   - 538 Total débitos  = IVA de ventas (facturas emitidas − notas de crédito)
//   - 537 Total créditos = IVA de compras (facturas recibidas − notas de crédito)
//   - 089 IVA determinado = 538 − 537
//   - Remanente: si un mes el crédito supera al débito, el sobrante se arrastra
//     al mes siguiente (igual que el F29 real). Se calcula recorriendo el año
//     en orden, por eso la función computa los 12 meses de una.
//   - 062 PPM = base imponible (neto de ventas) × tasa (0,5% hoy).
//
// Qué FALTA todavía (depende de etapas posteriores del módulo de contabilidad):
//   - 048 Impuesto único de los sueldos  → necesita la pata de remuneraciones.
//   - Retención de honorarios            → necesita la pata de boletas de honorarios.
// Por eso `impuestoUnico` y `retencionHonorarios` quedan en 0 y el total se
// marca como parcial: total real = totalAPagar + esos dos renglones.
//
// Convención de notas de crédito (tipoDoc=61): restan, igual que en metrics.ts
// y estadoResultado.ts. Los pagos sin factura (tipoDoc=1043) NO son DTE y no
// entran al F29.

import { prisma } from "@/lib/prisma";

// Tasa de PPM (Pago Provisional Mensual) de 1ra categoría. 0,5% es la tasa
// vigente de BLARQ; las tasas de PPM se recalculan una vez al año en la
// Operación Renta, por eso se deja como parámetro editable y no fija en el
// código. Confirmada en los 5 F29 de ene–may 2026.
export const PPM_RATE_DEFAULT = 0.005;

export type F29Mes = {
  year: number;
  month: number; // 1..12

  // Débitos — IVA de ventas (códigos F29 entre paréntesis)
  debitoVentas: number; // 502 — IVA de facturas emitidas
  debitoNotasCredito: number; // 510 — IVA de notas de crédito emitidas (resta)
  totalDebito: number; // 538 — 502 − 510

  // Créditos — IVA de compras
  creditoCompras: number; // 520 — IVA de facturas recibidas del giro
  creditoNotasCredito: number; // 528 — IVA de notas de crédito recibidas (resta)
  totalCredito: number; // 537 — 520 − 528

  // IVA del mes + remanente
  ivaDeterminado: number; // 089 — 538 − 537 (puede ser negativo = a favor)
  remanenteAnterior: number; // crédito IVA arrastrado del mes anterior (≥0)
  ivaAPagar: number; // IVA efectivo a pagar este mes (≥0)
  remanenteSiguiente: number; // crédito IVA que queda para el mes siguiente (≥0)

  // PPM
  baseImponiblePpm: number; // 563 — neto de ventas
  ppmRate: number; // 115 — tasa aplicada
  ppm: number; // 062 — base × tasa

  // Renglones pendientes (otras etapas del módulo)
  impuestoUnico: number; // 048 — 0 hoy (depende de sueldos)
  retencionHonorarios: number; // 0 hoy (depende de boletas de honorarios)

  totalAPagar: number; // 547 — IVA a pagar + PPM (+ pendientes cuando existan)

  // Conteos (diagnóstico / mostrar al lado de cada línea)
  countVentas: number; // facturas emitidas del mes (sin NC)
  countNotasCreditoEmitidas: number;
  countCompras: number; // facturas recibidas del mes (sin NC ni 1043)
  countNotasCreditoRecibidas: number;
};

const zeros = () => Array(12).fill(0) as number[];

// Computa los 12 meses del año en orden (necesario para arrastrar el remanente).
export async function computeF29Year(
  year: number,
  ppmRate: number = PPM_RATE_DEFAULT
): Promise<F29Mes[]> {
  // El período tributario es el mes calendario. issueDate se guarda en UTC
  // (medianoche del día), así que hay que leer mes/año en UTC: con hora local
  // las facturas del día 1 se corrían al mes anterior (Chile es UTC−3/−4).
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const invoices = await prisma.invoice.findMany({
    where: { issueDate: { gte: start, lt: end } },
    select: {
      type: true,
      tipoDoc: true,
      issueDate: true,
      netAmount: true,
      iva: true,
    },
  });

  const debV = zeros();
  const debNC = zeros();
  const creC = zeros();
  const creNC = zeros();
  const baseV = zeros(); // neto de ventas (base PPM), neto de NC
  const cV = zeros();
  const cVNC = zeros();
  const cC = zeros();
  const cCNC = zeros();

  for (const inv of invoices) {
    const m = inv.issueDate.getUTCMonth();
    if (inv.type === "emitida") {
      if (inv.tipoDoc === 61) {
        debNC[m] += inv.iva;
        baseV[m] -= inv.netAmount;
        cVNC[m] += 1;
      } else {
        debV[m] += inv.iva;
        baseV[m] += inv.netAmount;
        cV[m] += 1;
      }
    } else {
      // Recibidas. Los pagos sin factura (1043) no son DTE → fuera del F29.
      if (inv.tipoDoc === 1043) continue;
      if (inv.tipoDoc === 61) {
        creNC[m] += inv.iva;
        cCNC[m] += 1;
      } else {
        creC[m] += inv.iva;
        cC[m] += 1;
      }
    }
  }

  const meses: F29Mes[] = [];
  let remanente = 0; // crédito IVA arrastrado (≥0)

  for (let m = 0; m < 12; m++) {
    // El F29 trabaja en pesos enteros; los DTE pueden traer IVA con decimales.
    // Redondeamos cada código a peso para calzar con el formulario real.
    const debitoVentas = Math.round(debV[m]);
    const debitoNotasCredito = Math.round(debNC[m]);
    const totalDebito = debitoVentas - debitoNotasCredito;
    const creditoCompras = Math.round(creC[m]);
    const creditoNotasCredito = Math.round(creNC[m]);
    const totalCredito = creditoCompras - creditoNotasCredito;
    const ivaDeterminado = totalDebito - totalCredito;

    // Aplicar remanente del mes anterior. Si queda negativo, ese sobrante es el
    // nuevo remanente y no se paga IVA este mes.
    const ivaNeto = ivaDeterminado - remanente;
    const ivaAPagar = ivaNeto >= 0 ? ivaNeto : 0;
    const remanenteSiguiente = ivaNeto >= 0 ? 0 : -ivaNeto;

    const baseImponiblePpm = Math.round(Math.max(0, baseV[m]));
    const ppm = Math.round(baseImponiblePpm * ppmRate);

    const totalAPagar = ivaAPagar + ppm; // + impuestoUnico + retención (pendientes)

    meses.push({
      year,
      month: m + 1,
      debitoVentas,
      debitoNotasCredito,
      totalDebito,
      creditoCompras,
      creditoNotasCredito,
      totalCredito,
      ivaDeterminado,
      remanenteAnterior: remanente,
      ivaAPagar,
      remanenteSiguiente,
      baseImponiblePpm,
      ppmRate,
      ppm,
      impuestoUnico: 0,
      retencionHonorarios: 0,
      totalAPagar,
      countVentas: cV[m],
      countNotasCreditoEmitidas: cVNC[m],
      countCompras: cC[m],
      countNotasCreditoRecibidas: cCNC[m],
    });

    remanente = remanenteSiguiente;
  }

  return meses;
}

// Años con facturas (para el selector de la pantalla).
export async function getF29AvailableYears(): Promise<number[]> {
  const first = await prisma.invoice.findFirst({
    orderBy: { issueDate: "asc" },
    select: { issueDate: true },
  });
  const currentYear = new Date().getUTCFullYear();
  const firstYear = first ? first.issueDate.getUTCFullYear() : currentYear;
  const years: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) years.push(y);
  return years;
}
