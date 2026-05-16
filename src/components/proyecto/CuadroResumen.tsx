/**
 * Cuadro Resumen del proyecto — réplica del cuadro Excel que MJ lleva
 * a mano: por concepto (OBRA / ART. COCINA / ART. SANITARIOS / MUEBLES)
 * muestra el monto firmado en la versión vigente del presupuesto y, debajo,
 * cada pago (transferencia bancaria conciliada con factura emitida) con
 * su fecha y N° de folio. Cierra con TOTAL PAGOS, AVANCE y SALDO PENDIENTE.
 *
 * Para artefactos no hay split granular cocina/sanitarios en la factura
 * (`conceptoCobro` solo distingue obra/muebles/artefactos), entonces los
 * pagos de facturas con `conceptoCobro=artefactos` se reparten entre cocina
 * y sanitarios de forma proporcional al presupuesto V6 aprobado. Esta
 * heurística se acordó con MJ el 2026-05-15. Si en el futuro se necesita
 * precisión exacta cuando un cobro se desvía del split presupuestado,
 * agregamos un campo manual a la factura emitida.
 */

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
  clientPrice: number;
  quantity: number;
}

interface BudgetVersion {
  version: string;
  status: string;
  type: string;
  updatedAt: Date;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraItems?: ObraItem[];
  muebleChapters?: { items: MuebleItem[] }[];
  artefactoItems?: ArtefactoItem[];
}

interface Props {
  invoices: Invoice[];
  budgets: BudgetVersion[];
}

function allApproved(arr: BudgetVersion[]): BudgetVersion[] {
  return arr.filter((b) => b.status === "aprobado");
}
function lastUpdated(arr: BudgetVersion[]): BudgetVersion | undefined {
  if (arr.length === 0) return undefined;
  return [...arr].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
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
  // Si MJ quiere descartar una versión superseded, debe quitarle el
  // status "aprobado".
  const obrasAprobadas = allApproved(budgets.filter((b) => b.type === "obra"));
  const mueblesAprobados = allApproved(budgets.filter((b) => b.type === "muebles"));
  const artefactosAprobados = allApproved(
    budgets.filter((b) => b.type === "artefactos")
  );
  const lastObra = lastUpdated(obrasAprobadas);
  const lastMuebles = lastUpdated(mueblesAprobados);
  const lastArtefactos = lastUpdated(artefactosAprobados);

  // ── Acordado por concepto (suma de versiones aprobadas) ─────────────
  // OBRA: por cada versión aprobada, CD × (1+GG) × (1+Util) × 1.19.
  const obraAcordado = obrasAprobadas.reduce((s, b) => {
    const cd = (b.obraItems ?? []).reduce((ss, it) => ss + it.total, 0);
    const gg = (b.ggPercentage ?? 0) / 100;
    const util = (b.utilityPercentage ?? 0) / 100;
    return s + cd * (1 + gg) * (1 + util) * 1.19;
  }, 0);

  // MUEBLES: suma de clientPriceIva × qty de todas las versiones aprobadas.
  const mueblesAcordado = mueblesAprobados.reduce(
    (s, b) =>
      s +
      (b.muebleChapters ?? [])
        .flatMap((c) => c.items)
        .reduce((ss, it) => ss + it.clientPriceIva * it.quantity, 0),
    0
  );

  // ARTEFACTOS: split cocina/sanitarios.
  const cocinaAcordado = artefactosAprobados.reduce(
    (s, b) =>
      s +
      (b.artefactoItems ?? [])
        .filter((it) => it.subcategory === "cocina")
        .reduce((ss, it) => ss + it.clientPrice * it.quantity, 0),
    0
  );
  const sanitariosAcordado = artefactosAprobados.reduce(
    (s, b) =>
      s +
      (b.artefactoItems ?? [])
        .filter((it) => it.subcategory === "sanitario")
        .reduce((ss, it) => ss + it.clientPrice * it.quantity, 0),
    0
  );

  const totalAcordado =
    obraAcordado + cocinaAcordado + sanitariosAcordado + mueblesAcordado;

  // ── Pagos por columna ──────────────────────────────────────────────
  // Para conceptoCobro=artefactos hacemos split proporcional cocina/sanitarios.
  const artefactosBase = cocinaAcordado + sanitariosAcordado;
  const ratioCocina = artefactosBase > 0 ? cocinaAcordado / artefactosBase : 0;
  const ratioSanitarios =
    artefactosBase > 0 ? sanitariosAcordado / artefactosBase : 0;

  type Row = {
    date: Date;
    obra: number;
    cocina: number;
    sanitarios: number;
    muebles: number;
    folioNumber: string | null;
  };
  const rows: Row[] = [];
  const emitidas = invoices.filter((i) => i.type === "emitida");
  for (const inv of emitidas) {
    for (const p of inv.payments) {
      const row: Row = {
        date: new Date(p.bankMovement.date),
        obra: 0,
        cocina: 0,
        sanitarios: 0,
        muebles: 0,
        folioNumber: inv.folioNumber,
      };
      if (inv.conceptoCobro === "obra") row.obra = p.amountApplied;
      else if (inv.conceptoCobro === "muebles") row.muebles = p.amountApplied;
      else if (inv.conceptoCobro === "artefactos") {
        row.cocina = p.amountApplied * ratioCocina;
        row.sanitarios = p.amountApplied * ratioSanitarios;
      }
      // conceptoCobro mixto/null: por ahora se omite del cuadro.
      if (row.obra || row.cocina || row.sanitarios || row.muebles) {
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── Subtotales por columna ──────────────────────────────────────────
  const totObra = rows.reduce((s, r) => s + r.obra, 0);
  const totCocina = rows.reduce((s, r) => s + r.cocina, 0);
  const totSanitarios = rows.reduce((s, r) => s + r.sanitarios, 0);
  const totMuebles = rows.reduce((s, r) => s + r.muebles, 0);
  const totPagos = totObra + totCocina + totSanitarios + totMuebles;

  const avanceObra = obraAcordado > 0 ? totObra / obraAcordado : 0;
  const avanceCocina = cocinaAcordado > 0 ? totCocina / cocinaAcordado : 0;
  const avanceSanitarios =
    sanitariosAcordado > 0 ? totSanitarios / sanitariosAcordado : 0;
  const avanceMuebles = mueblesAcordado > 0 ? totMuebles / mueblesAcordado : 0;
  const avanceTotal = totalAcordado > 0 ? totPagos / totalAcordado : 0;

  const saldoObra = obraAcordado - totObra;
  const saldoCocina = cocinaAcordado - totCocina;
  const saldoSanitarios = sanitariosAcordado - totSanitarios;
  const saldoMuebles = mueblesAcordado - totMuebles;
  const saldoTotal = totalAcordado - totPagos;

  // Si no hay nada que mostrar, no rendereamos el bloque
  if (totalAcordado === 0 && rows.length === 0) return null;

  // ── Render ──────────────────────────────────────────────────────────
  // Si hay máximo UNA versión aprobada por tipo (caso típico), mostramos
  // el número de la versión vigente. Si algún tipo tiene 2+ aprobadas
  // (caso Aguirre V7 + V4-BANO-VISITAS), mostramos "Acordado" para evitar
  // confusión sobre qué versión está reflejada.
  const maxPerType = Math.max(
    obrasAprobadas.length,
    mueblesAprobados.length,
    artefactosAprobados.length
  );
  const versionLabel =
    maxPerType <= 1
      ? lastObra?.version ?? lastMuebles?.version ?? lastArtefactos?.version ?? "—"
      : "Acordado";
  const obraDate = lastObra ? fmtDate(new Date(lastObra.updatedAt)) : "";
  const cocinaDate =
    cocinaAcordado > 0 && lastArtefactos
      ? fmtDate(new Date(lastArtefactos.updatedAt))
      : "";
  const sanitariosDate =
    sanitariosAcordado > 0 && lastArtefactos
      ? fmtDate(new Date(lastArtefactos.updatedAt))
      : "";
  const mueblesDate = lastMuebles
    ? fmtDate(new Date(lastMuebles.updatedAt))
    : "";

  // Helpers para celdas
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
        emitidas. Para artefactos el monto se reparte cocina/sanitarios
        proporcional al presupuesto vigente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          {/* Headers: dos niveles. Primer nivel agrupa 3 sub-columnas por concepto. */}
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500">
              <th className="pb-1 pr-2 text-left"></th>
              <th
                colSpan={3}
                className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
              >
                Obra
              </th>
              <th
                colSpan={3}
                className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
              >
                Art. Cocina
              </th>
              <th
                colSpan={3}
                className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
              >
                Art. Sanitarios
              </th>
              <th
                colSpan={3}
                className="pb-1 px-2 text-center border-l border-gray-200 font-semibold text-gray-700"
              >
                Muebles
              </th>
              <th className="pb-1 pl-2 text-right border-l border-gray-200 font-semibold text-gray-700">
                Total
              </th>
            </tr>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-300">
              <th></th>
              <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                Fecha
              </th>
              <th className="pb-1 px-2 text-right font-medium">Monto</th>
              <th className="pb-1 px-2 text-right font-medium">Factura</th>
              <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                Fecha
              </th>
              <th className="pb-1 px-2 text-right font-medium">Monto</th>
              <th className="pb-1 px-2 text-right font-medium">Factura</th>
              <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                Fecha
              </th>
              <th className="pb-1 px-2 text-right font-medium">Monto</th>
              <th className="pb-1 px-2 text-right font-medium">Factura</th>
              <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                Fecha
              </th>
              <th className="pb-1 px-2 text-right font-medium">Monto</th>
              <th className="pb-1 px-2 text-right font-medium">Factura</th>
              <th className="pb-1 pl-2 border-l border-gray-200"></th>
            </tr>
          </thead>
          <tbody>
            {/* Fila versión: monto firmado por concepto */}
            <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left">{versionLabel}</td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                {obraDate}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">
                {cellMonto(obraAcordado)}
              </td>
              <td className="py-2 px-2"></td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                {cocinaDate}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">
                {cellMonto(cocinaAcordado)}
              </td>
              <td className="py-2 px-2"></td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                {sanitariosDate}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">
                {cellMonto(sanitariosAcordado)}
              </td>
              <td className="py-2 px-2"></td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                {mueblesDate}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">
                {cellMonto(mueblesAcordado)}
              </td>
              <td className="py-2 px-2"></td>
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totalAcordado)}
              </td>
            </tr>

            {/* Filas de pagos */}
            {rows.map((r, i) => (
              <tr
                key={i}
                className="border-b border-gray-50 text-gray-700"
              >
                <td className="py-1.5 pr-2"></td>
                <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                  {r.obra ? fmtDate(r.date) : ""}
                </td>
                <td className="py-1.5 px-2 text-right">{cellMonto(r.obra)}</td>
                <td className="py-1.5 px-2 text-right text-gray-500">
                  {r.obra && r.folioNumber ? r.folioNumber : ""}
                </td>
                <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                  {r.cocina ? fmtDate(r.date) : ""}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {cellMonto(r.cocina)}
                </td>
                <td className="py-1.5 px-2 text-right text-gray-500">
                  {r.cocina && r.folioNumber ? r.folioNumber : ""}
                </td>
                <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                  {r.sanitarios ? fmtDate(r.date) : ""}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {cellMonto(r.sanitarios)}
                </td>
                <td className="py-1.5 px-2 text-right text-gray-500">
                  {r.sanitarios && r.folioNumber ? r.folioNumber : ""}
                </td>
                <td className="py-1.5 px-2 border-l border-gray-100 text-left">
                  {r.muebles ? fmtDate(r.date) : ""}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {cellMonto(r.muebles)}
                </td>
                <td className="py-1.5 px-2 text-right text-gray-500">
                  {r.muebles && r.folioNumber ? r.folioNumber : ""}
                </td>
                <td className="py-1.5 pl-2 border-l border-gray-200"></td>
              </tr>
            ))}

            {/* TOTAL PAGOS */}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left uppercase text-[10px] tracking-wider">
                Total pagos
              </td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                {(avanceObra * 100).toFixed(0)}%
              </td>
              <td
                colSpan={2}
                className="py-2 px-2 text-right tabular-nums"
              >
                {cellMonto(totObra)}
              </td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                {(avanceCocina * 100).toFixed(0)}%
              </td>
              <td
                colSpan={2}
                className="py-2 px-2 text-right tabular-nums"
              >
                {cellMonto(totCocina)}
              </td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                {(avanceSanitarios * 100).toFixed(0)}%
              </td>
              <td
                colSpan={2}
                className="py-2 px-2 text-right tabular-nums"
              >
                {cellMonto(totSanitarios)}
              </td>
              <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                {(avanceMuebles * 100).toFixed(0)}%
              </td>
              <td
                colSpan={2}
                className="py-2 px-2 text-right tabular-nums"
              >
                {cellMonto(totMuebles)}
              </td>
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totPagos)}
              </td>
            </tr>
            {/* AVANCE total monetario (lo no cobrado todavía / lo cobrado) */}
            <tr className="text-gray-600">
              <td className="py-1.5 pr-2 text-left uppercase text-[10px] tracking-wider">
                Avance total
              </td>
              <td
                colSpan={12}
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
              <td
                colSpan={3}
                className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
              >
                {cellMonto(saldoObra)}
              </td>
              <td
                colSpan={3}
                className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
              >
                {cellMonto(saldoCocina)}
              </td>
              <td
                colSpan={3}
                className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
              >
                {cellMonto(saldoSanitarios)}
              </td>
              <td
                colSpan={3}
                className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
              >
                {cellMonto(saldoMuebles)}
              </td>
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
