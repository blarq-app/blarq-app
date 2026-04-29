import Link from "next/link";
import { formatCLP, relativeDate } from "@/lib/utils";

// Tabla densa compartida entre Dashboard, /proyectos y /cotizaciones.
// El "preset" decide qué columnas se muestran; el resto del estilo es
// idéntico para que las tres vistas se sientan iguales.

export type ProjectRow = {
  id: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
  isInternal: boolean;
  name: string;
  clientName: string;
  status: string;
  // Métricas pre-calculadas por el caller (las computa con
  // computeProjectMetrics + getLastActivity, no este componente).
  gastado: number;
  vendido: number;
  lastActivity: Date;
  hasAlert: boolean;
  // Solo para la tab Convertidas en /cotizaciones
  convertedAt?: Date | null;
};

type Variant = "ejecucion" | "cotizacion" | "convertida" | "terminado" | "archivado";

export default function ProjectsTable({
  rows,
  variant,
  hrefBase,
  groupOtros = false,
}: {
  rows: ProjectRow[];
  variant: Variant;
  // base del link de cada fila ("/proyectos" → /proyectos/[id]/resumen)
  hrefBase: string;
  // si true, separa los proyectos isInternal=true al final bajo "OTROS"
  groupOtros?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
        No hay registros para mostrar.
      </div>
    );
  }

  const main = groupOtros ? rows.filter((r) => !r.isInternal) : rows;
  const otros = groupOtros ? rows.filter((r) => r.isInternal) : [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
          <tr>
            <th className="text-right pl-4 pr-2 py-2 w-14">Nº</th>
            <th className="text-left px-3 py-2">
              {variant === "cotizacion" || variant === "convertida" || variant === "archivado"
                ? "Cotización"
                : "Proyecto"}
            </th>
            <th className="text-left px-3 py-2">Cliente</th>
            {(variant === "ejecucion" || variant === "terminado") && (
              <>
                <th className="text-right px-3 py-2">Gastado</th>
                <th className="text-right px-3 py-2">Vendido</th>
              </>
            )}
            {(variant === "cotizacion" || variant === "archivado") && (
              <th className="text-right px-3 py-2">Monto</th>
            )}
            {variant === "convertida" && (
              <>
                <th className="text-right px-3 py-2">Monto</th>
                <th className="text-left px-3 py-2 w-32">→ Proyecto</th>
              </>
            )}
            <th className="text-left px-3 py-2 w-28">
              {variant === "convertida"
                ? "Aprobada"
                : variant === "terminado"
                  ? "Terminado"
                  : variant === "cotizacion" || variant === "archivado"
                    ? "Creada"
                    : "Últ Mov"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {main.map((r) => (
            <Row key={r.id} row={r} variant={variant} hrefBase={hrefBase} />
          ))}
          {otros.length > 0 && (
            <>
              <tr className="bg-gray-50">
                <td
                  colSpan={6}
                  className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-500"
                >
                  Otros (centros de costo internos)
                </td>
              </tr>
              {otros.map((r) => (
                <Row key={r.id} row={r} variant={variant} hrefBase={hrefBase} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  variant,
  hrefBase,
}: {
  row: ProjectRow;
  variant: Variant;
  hrefBase: string;
}) {
  const numero =
    variant === "cotizacion" || variant === "archivado" || variant === "convertida"
      ? row.numeroCotizacion != null
        ? `C-${row.numeroCotizacion}`
        : "—"
      : row.numeroProyecto != null
        ? String(row.numeroProyecto)
        : "—";

  // Cliente repetido (clientName === name) → guión, no duplicar
  const clientText = row.clientName === row.name ? "—" : row.clientName;

  // Para variants de ejecución/terminado: el monto "Vendido" puede ser 0
  // (sin EPs). En ese caso lo mostramos como guión gris claro para no
  // ocupar peso visual.
  const gastadoCell =
    row.gastado > 0 ? formatCLP(row.gastado) : <span className="text-gray-300">—</span>;
  const vendidoCell =
    row.vendido > 0 ? formatCLP(row.vendido) : <span className="text-gray-300">—</span>;

  const dateLabel =
    variant === "convertida"
      ? row.convertedAt
        ? row.convertedAt.toLocaleDateString("es-CL", { month: "short", year: "numeric" })
        : "—"
      : variant === "cotizacion" || variant === "archivado"
        ? relativeDate(row.lastActivity)
        : relativeDate(row.lastActivity);

  return (
    <tr className="hover:bg-gray-50 group">
      <td className="pl-4 pr-2 py-2 text-right tabular-nums text-gray-700 font-medium relative">
        {row.hasAlert && (
          <span
            aria-label="Alerta activa"
            title="Tiene alerta activa"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-red-500"
          />
        )}
        {numero}
      </td>
      <td className="px-3 py-2 font-medium text-gray-900">
        <Link
          href={`${hrefBase}/${row.id}`}
          className="hover:underline"
        >
          {row.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-gray-500">
        {clientText === "—" ? <span className="text-gray-300">{clientText}</span> : clientText}
      </td>
      {(variant === "ejecucion" || variant === "terminado") && (
        <>
          <td className="px-3 py-2 text-right tabular-nums text-gray-900">{gastadoCell}</td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-900">{vendidoCell}</td>
        </>
      )}
      {(variant === "cotizacion" || variant === "archivado") && (
        <td className="px-3 py-2 text-right tabular-nums text-gray-900">{vendidoCell}</td>
      )}
      {variant === "convertida" && (
        <>
          <td className="px-3 py-2 text-right tabular-nums text-gray-900">{vendidoCell}</td>
          <td className="px-3 py-2 text-gray-500 tabular-nums">
            {row.numeroProyecto != null ? `→ ${row.numeroProyecto}` : "—"}
          </td>
        </>
      )}
      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{dateLabel}</td>
    </tr>
  );
}
