/**
 * Cuadro Resumen del proyecto — réplica del cuadro Excel que MJ lleva
 * a mano. Por cada concepto (OBRA / ART. COCINA / ART. SANITARIOS /
 * ART. ILUMINACIÓN / MUEBLES) muestra el monto firmado en la versión
 * vigente del presupuesto y, debajo, cada pago (transferencia bancaria
 * conciliada con factura emitida) con su fecha y N° de folio. Cierra con
 * TOTAL PAGOS, AVANCE y SALDO PENDIENTE.
 *
 * COLUMNAS DINÁMICAS (regla confirmada con MJ 2026-05-22): el cuadro NO
 * tiene columnas fijas. Cada proyecto muestra solo las columnas de los
 * conceptos que efectivamente le entregó al cliente como lista/presupuesto.
 * La app lo deduce de lo cargado: una columna aparece si su acordado > 0.
 * Ejemplo: en Portofino la iluminación va dentro de la obra (no hay lista
 * de artefactos de iluminación aparte) → esa columna no debe salir; en
 * Aguirre sí se entregó listado de iluminación → la columna aparece.
 *
 * Para artefactos no hay split granular cocina/sanitarios/iluminación en
 * la factura (`conceptoCobro` solo distingue obra/muebles/artefactos),
 * entonces los pagos de facturas con `conceptoCobro=artefactos` se reparten
 * entre las tres sub-categorías de forma proporcional al acordado de la
 * versión aprobada. Esta heurística se acordó con MJ el 2026-05-15. Si en
 * el futuro se necesita precisión exacta cuando un cobro se desvía del
 * split presupuestado, agregamos un campo manual a la factura emitida.
 */

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

type Row = {
  date: Date;
  obra: number;
  cocina: number;
  sanitarios: number;
  iluminacion: number;
  muebles: number;
  folioNumber: string | null;
};

// Un concepto = una columna del cuadro. Se arma dinámicamente: solo los
// conceptos con acordado > 0 terminan renderizados (ver nota de cabecera).
type Concepto = {
  key: "obra" | "cocina" | "sanitarios" | "iluminacion" | "muebles";
  label: string;
  acordado: number;
  fecha: string;
  pagoDe: (r: Row) => number;
  totPago: number;
  avance: number;
  saldo: number;
};

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
  // OBRA: por cada versión aprobada, CD × (1 + GG + Util) × 1.19.
  // GG y Utilidad se aplican ADITIVOS sobre el costo directo, NO
  // encadenados — fórmula confirmada con MJ contra el Excel (ver
  // metrics.ts y docs/WIP.md ronda 7).
  const obraAcordado = obrasAprobadas.reduce((s, b) => {
    const cd = (b.obraItems ?? []).reduce((ss, it) => ss + it.total, 0);
    const gg = (b.ggPercentage ?? 0) / 100;
    const util = (b.utilityPercentage ?? 0) / 100;
    return s + cd * (1 + gg + util) * 1.19;
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

  // ARTEFACTOS: split cocina / sanitarios / iluminación.
  // clientPrice es precio unitario → se multiplica por quantity (convención
  // confirmada con MJ 2026-05-22, igual que metrics.ts).
  const sumaSub = (sub: string) =>
    artefactosAprobados.reduce(
      (s, b) =>
        s +
        (b.artefactoItems ?? [])
          .filter((it) => it.subcategory === sub)
          .reduce((ss, it) => ss + it.clientPrice * it.quantity, 0),
      0
    );
  const cocinaAcordado = sumaSub("cocina");
  const sanitariosAcordado = sumaSub("sanitario");
  const iluminacionAcordado = sumaSub("iluminacion");

  const totalAcordado =
    obraAcordado +
    cocinaAcordado +
    sanitariosAcordado +
    iluminacionAcordado +
    mueblesAcordado;

  // ── Pagos por columna ──────────────────────────────────────────────
  // Para conceptoCobro=artefactos hacemos split proporcional entre las tres
  // sub-categorías (cocina / sanitarios / iluminación) según el acordado.
  const artefactosBase =
    cocinaAcordado + sanitariosAcordado + iluminacionAcordado;
  const ratioCocina = artefactosBase > 0 ? cocinaAcordado / artefactosBase : 0;
  const ratioSanitarios =
    artefactosBase > 0 ? sanitariosAcordado / artefactosBase : 0;
  const ratioIluminacion =
    artefactosBase > 0 ? iluminacionAcordado / artefactosBase : 0;

  const rows: Row[] = [];
  const emitidas = invoices.filter((i) => i.type === "emitida");
  for (const inv of emitidas) {
    for (const p of inv.payments) {
      const row: Row = {
        date: new Date(p.bankMovement.date),
        obra: 0,
        cocina: 0,
        sanitarios: 0,
        iluminacion: 0,
        muebles: 0,
        folioNumber: inv.folioNumber,
      };
      if (inv.conceptoCobro === "obra") row.obra = p.amountApplied;
      else if (inv.conceptoCobro === "muebles") row.muebles = p.amountApplied;
      else if (inv.conceptoCobro === "artefactos") {
        row.cocina = p.amountApplied * ratioCocina;
        row.sanitarios = p.amountApplied * ratioSanitarios;
        row.iluminacion = p.amountApplied * ratioIluminacion;
      }
      // conceptoCobro mixto/null: por ahora se omite del cuadro.
      if (
        row.obra ||
        row.cocina ||
        row.sanitarios ||
        row.iluminacion ||
        row.muebles
      ) {
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── Fechas de cada concepto (fecha de la versión vigente) ───────────
  const obraDate = lastObra ? fmtDate(new Date(lastObra.updatedAt)) : "";
  const artefactosDate = lastArtefactos
    ? fmtDate(new Date(lastArtefactos.updatedAt))
    : "";
  const mueblesDate = lastMuebles
    ? fmtDate(new Date(lastMuebles.updatedAt))
    : "";

  // ── Conceptos presentes: solo los que tienen acordado > 0 ───────────
  // Esta es la regla de columnas dinámicas. Un proyecto sin artefactos de
  // iluminación (p. ej. Portofino, que la cobra dentro de la obra) no
  // muestra esa columna.
  const conceptosAll: Concepto[] = [
    {
      key: "obra",
      label: "Obra",
      acordado: obraAcordado,
      fecha: obraDate,
      pagoDe: (r) => r.obra,
      totPago: 0,
      avance: 0,
      saldo: 0,
    },
    {
      key: "cocina",
      label: "Art. Cocina",
      acordado: cocinaAcordado,
      fecha: artefactosDate,
      pagoDe: (r) => r.cocina,
      totPago: 0,
      avance: 0,
      saldo: 0,
    },
    {
      key: "sanitarios",
      label: "Art. Sanitarios",
      acordado: sanitariosAcordado,
      fecha: artefactosDate,
      pagoDe: (r) => r.sanitarios,
      totPago: 0,
      avance: 0,
      saldo: 0,
    },
    {
      key: "iluminacion",
      label: "Art. Iluminación",
      acordado: iluminacionAcordado,
      fecha: artefactosDate,
      pagoDe: (r) => r.iluminacion,
      totPago: 0,
      avance: 0,
      saldo: 0,
    },
    {
      key: "muebles",
      label: "Muebles",
      acordado: mueblesAcordado,
      fecha: mueblesDate,
      pagoDe: (r) => r.muebles,
      totPago: 0,
      avance: 0,
      saldo: 0,
    },
  ];
  const conceptos = conceptosAll.filter((c) => c.acordado > 0);

  // Subtotales de pagos, avance y saldo por concepto.
  for (const c of conceptos) {
    c.totPago = rows.reduce((s, r) => s + c.pagoDe(r), 0);
    c.avance = c.acordado > 0 ? c.totPago / c.acordado : 0;
    c.saldo = c.acordado - c.totPago;
  }
  const totPagos = conceptos.reduce((s, c) => s + c.totPago, 0);
  const avanceTotal = totalAcordado > 0 ? totPagos / totalAcordado : 0;
  const saldoTotal = totalAcordado - totPagos;

  // Si no hay nada que mostrar, no rendereamos el bloque
  if (conceptos.length === 0 && rows.length === 0) return null;

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

  // Helper de celda de monto
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
        emitidas. Las columnas son las del presupuesto entregado al cliente.
        Para artefactos el monto se reparte cocina/sanitarios/iluminación
        proporcional al presupuesto vigente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          {/* Headers: dos niveles. Primer nivel agrupa 3 sub-columnas por concepto. */}
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500">
              <th className="pb-1 pr-2 text-left"></th>
              {conceptos.map((c) => (
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
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-300">
              <th></th>
              {conceptos.map((c) => (
                <Fragment key={c.key}>
                  <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">
                    Fecha
                  </th>
                  <th className="pb-1 px-2 text-right font-medium">Monto</th>
                  <th className="pb-1 px-2 text-right font-medium">Factura</th>
                </Fragment>
              ))}
              <th className="pb-1 pl-2 border-l border-gray-200"></th>
            </tr>
          </thead>
          <tbody>
            {/* Fila versión: monto firmado por concepto */}
            <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
              <td className="py-2 pr-2 text-left">{versionLabel}</td>
              {conceptos.map((c) => (
                <Fragment key={c.key}>
                  <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-600 font-normal">
                    {c.fecha}
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
                {conceptos.map((c) => {
                  const v = c.pagoDe(r);
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
              {conceptos.map((c) => (
                <Fragment key={c.key}>
                  <td className="py-2 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">
                    {(c.avance * 100).toFixed(0)}%
                  </td>
                  <td colSpan={2} className="py-2 px-2 text-right tabular-nums">
                    {cellMonto(c.totPago)}
                  </td>
                </Fragment>
              ))}
              <td className="py-2 pl-2 border-l border-gray-200 text-right tabular-nums">
                {formatCLP(totPagos)}
              </td>
            </tr>
            {/* AVANCE total monetario (lo cobrado sobre el acordado) */}
            <tr className="text-gray-600">
              <td className="py-1.5 pr-2 text-left uppercase text-[10px] tracking-wider">
                Avance total
              </td>
              <td
                colSpan={conceptos.length * 3}
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
              {conceptos.map((c) => (
                <td
                  key={c.key}
                  colSpan={3}
                  className="py-2 px-2 border-l border-gray-200 text-right tabular-nums"
                >
                  {cellMonto(c.saldo)}
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
