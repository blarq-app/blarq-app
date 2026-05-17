/**
 * Cuadro Resumen del proyecto — réplica del cuadro Excel que MJ lleva
 * a mano: por concepto muestra el monto firmado en la versión vigente
 * del presupuesto y, debajo, cada pago (transferencia bancaria conciliada
 * con factura emitida) con su fecha y N° de folio. Cierra con TOTAL
 * PAGOS, AVANCE y SALDO PENDIENTE.
 *
 * Las columnas son DINÁMICAS: el cuadro reconoce solo qué tiene el
 * proyecto y arma una columna por cada concepto con monto acordado > 0
 * (Obra, Muebles, y una por cada subcategoría de artefactos presente:
 * Cocina / Sanitarios / Iluminación). Si el proyecto no cotizó
 * iluminación, no aparece esa columna; si la cotizó, aparece sola.
 *
 * Para artefactos no hay split granular por subcategoría en la factura
 * (`conceptoCobro` solo distingue obra/muebles/artefactos), entonces los
 * pagos de facturas con `conceptoCobro=artefactos` se reparten entre las
 * subcategorías presentes de forma proporcional al presupuesto aprobado.
 */

"use client";

import { Fragment } from "react";
import { formatCLP } from "@/lib/utils";

interface Payment {
  amountApplied: number;
  bankMovement: { date: Date };
}

interface Invoice {
  type: string;
  conceptoCobro: string | null;
  folioNumber: string | null;
  payments: Payment[];
}

interface ObraItem {
  total: number;
  quantity: number;
}

interface MuebleItem {
  clientPriceIva: number;
  quantity: number;
}

interface ArtefactoItem {
  subcategory: string;
  clientPrice: number; // unitario
  quantity: number;
}

interface BudgetVersion {
  version: string;
  status: string;
  type: string;
  updatedAt: Date;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  discountPercentage: number | null;
  obraItems?: ObraItem[];
  muebleChapters?: { items: MuebleItem[] }[];
  artefactoItems?: ArtefactoItem[];
}

interface Props {
  invoices: Invoice[];
  budgets: BudgetVersion[];
}

// Subcategorías de artefactos — label y orden de aparición en el cuadro.
const SUBCAT_LABEL: Record<string, string> = {
  cocina: "Art. Cocina",
  sanitario: "Art. Sanitarios",
  iluminacion: "Art. Iluminación",
};
const SUBCAT_ORDER = ["cocina", "sanitario", "iluminacion"];

function allApproved(arr: BudgetVersion[]): BudgetVersion[] {
  return arr.filter((b) => b.status === "aprobado");
}
function lastUpdated(arr: BudgetVersion[]): BudgetVersion | undefined {
  if (arr.length === 0) return undefined;
  return [...arr].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  )[0];
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

export default function CuadroResumen({ invoices, budgets }: Props) {
  // Sumamos TODAS las versiones aprobadas por tipo (caso Aguirre que
  // tiene V7 principal + V4-BANO-VISITAS como anexo, ambas aprobadas).
  const obrasAprobadas = allApproved(budgets.filter((b) => b.type === "obra"));
  const mueblesAprobados = allApproved(
    budgets.filter((b) => b.type === "muebles")
  );
  const artefactosAprobados = allApproved(
    budgets.filter((b) => b.type === "artefactos")
  );
  const lastObra = lastUpdated(obrasAprobadas);
  const lastMuebles = lastUpdated(mueblesAprobados);
  const lastArtefactos = lastUpdated(artefactosAprobados);

  // ── Acordado por concepto ───────────────────────────────────────────
  // OBRA: por versión aprobada, CD × (1 + GG + Util) × 1.19. GG y Util
  // aditivos sobre el costo directo (no encadenados) — ver metrics.ts.
  const obraAcordado = obrasAprobadas.reduce((s, b) => {
    const cd = (b.obraItems ?? []).reduce((ss, it) => ss + it.total, 0);
    const gg = (b.ggPercentage ?? 0) / 100;
    const util = (b.utilityPercentage ?? 0) / 100;
    return s + cd * (1 + gg + util) * 1.19;
  }, 0);

  // MUEBLES: suma clientPriceIva × qty, menos el descuento global de la
  // versión (decimal 0..1). Igual criterio que metrics.ts.
  const mueblesAcordado = mueblesAprobados.reduce((s, b) => {
    const subtotal = (b.muebleChapters ?? [])
      .flatMap((c) => c.items)
      .reduce((ss, it) => ss + it.clientPriceIva * it.quantity, 0);
    return s + subtotal * (1 - (b.discountPercentage ?? 0));
  }, 0);

  // ARTEFACTOS: monto acordado por subcategoría (clientPrice es unitario,
  // se multiplica por quantity).
  const artefactoBySubcat = new Map<string, number>();
  for (const b of artefactosAprobados) {
    for (const it of b.artefactoItems ?? []) {
      const k = it.subcategory || "sanitario";
      artefactoBySubcat.set(
        k,
        (artefactoBySubcat.get(k) ?? 0) + it.clientPrice * it.quantity
      );
    }
  }

  // ── Conceptos dinámicos ─────────────────────────────────────────────
  // Una columna por cada concepto con acordado > 0. Así el cuadro
  // reconoce solo si el proyecto tiene iluminación, muebles, etc.
  type Concept = {
    key: string;
    label: string;
    acordado: number;
    date: string;
  };
  const concepts: Concept[] = [];
  if (obraAcordado > 0) {
    concepts.push({
      key: "obra",
      label: "Obra",
      acordado: obraAcordado,
      date: lastObra ? fmtDate(new Date(lastObra.updatedAt)) : "",
    });
  }
  for (const sc of SUBCAT_ORDER) {
    const a = artefactoBySubcat.get(sc) ?? 0;
    if (a > 0) {
      concepts.push({
        key: sc,
        label: SUBCAT_LABEL[sc] ?? sc,
        acordado: a,
        date: lastArtefactos ? fmtDate(new Date(lastArtefactos.updatedAt)) : "",
      });
    }
  }
  if (mueblesAcordado > 0) {
    concepts.push({
      key: "muebles",
      label: "Muebles",
      acordado: mueblesAcordado,
      date: lastMuebles ? fmtDate(new Date(lastMuebles.updatedAt)) : "",
    });
  }

  const totalAcordado = concepts.reduce((s, c) => s + c.acordado, 0);

  // Subcategorías de artefactos presentes — para repartir los pagos de
  // facturas con conceptoCobro=artefactos proporcional a lo acordado.
  const artefactoKeys = concepts
    .filter((c) => SUBCAT_ORDER.includes(c.key))
    .map((c) => c.key);
  const artefactoBase = artefactoKeys.reduce(
    (s, k) => s + (artefactoBySubcat.get(k) ?? 0),
    0
  );

  // ── Filas de pagos ──────────────────────────────────────────────────
  type Row = {
    date: Date;
    folioNumber: string | null;
    amounts: Record<string, number>;
  };
  const rows: Row[] = [];
  for (const inv of invoices.filter((i) => i.type === "emitida")) {
    for (const p of inv.payments) {
      const amounts: Record<string, number> = {};
      if (inv.conceptoCobro === "obra") {
        amounts.obra = p.amountApplied;
      } else if (inv.conceptoCobro === "muebles") {
        amounts.muebles = p.amountApplied;
      } else if (inv.conceptoCobro === "artefactos" && artefactoBase > 0) {
        for (const k of artefactoKeys) {
          amounts[k] =
            p.amountApplied * ((artefactoBySubcat.get(k) ?? 0) / artefactoBase);
        }
      }
      // conceptoCobro mixto/null: por ahora se omite del cuadro.
      if (Object.values(amounts).some((v) => v > 0)) {
        rows.push({
          date: new Date(p.bankMovement.date),
          folioNumber: inv.folioNumber,
          amounts,
        });
      }
    }
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── Totales por concepto ────────────────────────────────────────────
  const totByConcept: Record<string, number> = {};
  for (const c of concepts) {
    totByConcept[c.key] = rows.reduce(
      (s, r) => s + (r.amounts[c.key] ?? 0),
      0
    );
  }
  const totPagos = Object.values(totByConcept).reduce((s, v) => s + v, 0);
  const avanceTotal = totalAcordado > 0 ? totPagos / totalAcordado : 0;
  const saldoTotal = totalAcordado - totPagos;

  // Si no hay nada que mostrar, no rendereamos el bloque.
  if (totalAcordado === 0 && rows.length === 0) return null;

  // Si hay máximo UNA versión aprobada por tipo (caso típico), mostramos
  // el número de versión. Si algún tipo tiene 2+, mostramos "Acordado".
  const maxPerType = Math.max(
    obrasAprobadas.length,
    mueblesAprobados.length,
    artefactosAprobados.length
  );
  const versionLabel =
    maxPerType <= 1
      ? lastObra?.version ??
        lastMuebles?.version ??
        lastArtefactos?.version ??
        "—"
      : "Acordado";

  const cellMonto = (v: number) =>
    v > 0 ? (
      <span className="tabular-nums">{formatCLP(v)}</span>
    ) : (
      <span className="text-gray-300">—</span>
    );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Cuadro Resumen
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Acordado por concepto y transferencias conciliadas con facturas
        emitidas. Las columnas se arman solas según lo que tiene el
        proyecto. Para artefactos, el pago se reparte entre las
        subcategorías proporcional al presupuesto vigente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {/* Nivel 1: nombre del concepto, agrupa 3 sub-columnas */}
            <tr className="text-[10px] uppercase tracking-wider text-gray-500">
              <th className="pb-1 pr-2 text-left"></th>
              {concepts.map((c) => (
                <th
                  key={c.key}
                  colSpan={3}
                  className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
                >
                  {c.label}
                </th>
              ))}
              <th className="pb-1 pl-2 text-right border-l border-gray-200 font-semibold text-gray-700">
                Total
              </th>
            </tr>
            {/* Nivel 2: Fecha / Monto / Factura por concepto */}
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-300">
              <th></th>
              {concepts.map((c) => (
                <Fragment key={c.key}>
                  <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                    Fecha
                  </th>
                  <th className="pb-1 px-2 text-right font-medium">Monto</th>
                  <th className="pb-1 px-2 text-right font-medium">Factura</th>
                </Fragment>
              ))}
              <th className="pb-1 px-2 border-l border-gray-200"></th>
            </tr>
          </thead>
          <tbody>
            {/* Fila versión: monto firmado por concepto */}
            <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left">{versionLabel}</td>
              {concepts.map((c) => (
                <Fragment key={c.key}>
                  <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                    {c.date}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {cellMonto(c.acordado)}
                  </td>
                  <td className="py-2 px-2"></td>
                </Fragment>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totalAcordado)}
              </td>
            </tr>

            {/* Filas de pagos */}
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 text-gray-700">
                <td className="py-1.5 pr-2"></td>
                {concepts.map((c) => {
                  const v = r.amounts[c.key] ?? 0;
                  return (
                    <Fragment key={c.key}>
                      <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                        {v ? fmtDate(r.date) : ""}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {cellMonto(v)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-500">
                        {v && r.folioNumber ? r.folioNumber : ""}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="py-1.5 pl-2 border-l border-gray-200"></td>
              </tr>
            ))}

            {/* TOTAL PAGOS */}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">
                Total pagos
              </td>
              {concepts.map((c) => {
                const t = totByConcept[c.key] ?? 0;
                const av = c.acordado > 0 ? t / c.acordado : 0;
                return (
                  <Fragment key={c.key}>
                    <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                      {(av * 100).toFixed(0)}%
                    </td>
                    <td colSpan={2} className="py-2 px-2 text-right tabular-nums">
                      {cellMonto(t)}
                    </td>
                  </Fragment>
                );
              })}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totPagos)}
              </td>
            </tr>
            {/* AVANCE total */}
            <tr className="text-gray-600">
              <td className="py-1.5 pr-2 text-left uppercase text-[10px] tracking-wider">
                Avance total
              </td>
              <td
                colSpan={concepts.length * 3}
                className="py-1.5 px-2 border-l border-gray-200 text-right text-gray-500 tabular-nums"
              >
                {(avanceTotal * 100).toFixed(0)}% del acordado
              </td>
              <td className="py-1.5 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totPagos)}
              </td>
            </tr>
            {/* SALDO PENDIENTE */}
            <tr className="border-t border-gray-200 text-gray-900 font-medium">
              <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">
                Saldo pendiente
              </td>
              {concepts.map((c) => (
                <td
                  key={c.key}
                  colSpan={3}
                  className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
                >
                  {cellMonto(c.acordado - (totByConcept[c.key] ?? 0))}
                </td>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(saldoTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
