import { formatCLP, relativeDate } from "@/lib/utils";
import EditableCell from "@/components/proyecto/EditableCell";
import ProjectStatusMenu from "@/components/proyecto/ProjectStatusMenu";
import BorrarCotizacionButton from "@/components/proyecto/BorrarCotizacionButton";
import ArchivarCotizacionButton from "@/components/proyecto/ArchivarCotizacionButton";

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
  // Fecha de creación real. La columna "Creada" de cotizaciones/archivadas la
  // usa a ella, no lastActivity: hasta julio 2026 esa columna decía "Creada"
  // pero mostraba la última actividad (una factura nueva la movía a "ayer"),
  // así que no calzaba con el orden de la lista ni con lo que decía el rótulo.
  // Opcional para los callers que no la necesitan (dashboard, /proyectos).
  createdAt?: Date;
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
      {/* ── Celular: una tarjeta por obra ─────────────────────────────────
          La tabla tiene hasta 7 columnas y en un celular se cortaba justo en
          Gastado/Vendido, que es lo que se viene a mirar. Acá el número y el
          nombre mandan arriba, y la plata va abajo con su rótulo. */}
      <div className="md:hidden divide-y divide-gray-100">
        {main.map((r) => (
          <TarjetaProyecto key={r.id} row={r} variant={variant} hrefBase={hrefBase} />
        ))}
        {otros.length > 0 && (
          <>
            <div className="bg-gray-50 px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">
              Otros (centros de costo internos)
            </div>
            {otros.map((r) => (
              <TarjetaProyecto key={r.id} row={r} variant={variant} hrefBase={hrefBase} />
            ))}
          </>
        )}
      </div>

      {/* ── Escritorio: la tabla densa de siempre, sin cambios ───────────── */}
      <table className="hidden md:table w-full text-sm">
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
                <th className="text-right px-3 py-2">
                  Gastado
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">neto</span>
                </th>
                <th className="text-right px-3 py-2">
                  Vendido
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">c/IVA</span>
                </th>
              </>
            )}
            {(variant === "cotizacion" || variant === "archivado") && (
              <th className="text-right px-3 py-2">
                Monto
                <span className="block text-[9px] text-gray-400 normal-case font-normal">c/IVA</span>
              </th>
            )}
            {variant === "convertida" && (
              <>
                <th className="text-right px-3 py-2">
                  Monto
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">c/IVA</span>
                </th>
                <th className="text-left px-3 py-2 w-32">→ Proyecto</th>
              </>
            )}
            {/* En proyectos en ejecución no mostramos columna de fecha
                (MJ no la usa). En el resto de variants la columna sigue
                con un label útil (Aprobada, Terminado, Creada). */}
            {variant !== "ejecucion" && (
              <th className="text-left px-3 py-2 w-28">
                {variant === "convertida"
                  ? "Aprobada"
                  : variant === "terminado"
                    ? "Terminado"
                    : "Creada"}
              </th>
            )}
            {/* Columna de acciones. En ejecucion/terminado es el menú "..."
                (ejecucion → terminado, terminado → ejecucion). En
                cotización/archivado son dos íconos: archivar/desarchivar y
                eliminar. En convertida se renderiza vacía para mantener el
                ancho consistente. */}
            <th
              className={
                variant === "cotizacion" || variant === "archivado"
                  ? "px-2 py-2 w-20"
                  : "px-2 py-2 w-10"
              }
              aria-label="Acciones"
            ></th>
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
                  // colSpan dinámico: ejecucion=6 (sin columna de fecha),
                  // terminado=7 (con columna "Terminado"). El resto de
                  // variants no usa groupOtros.
                  colSpan={variant === "ejecucion" ? 6 : 7}
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

/**
 * Versión en tarjeta de una fila, para el celular.
 *
 * Deriva los mismos valores que `Row` (número, cliente, montos, fecha) con la
 * misma lógica — está a propósito al lado suyo para que se vean juntas si
 * alguna regla cambia.
 */
function TarjetaProyecto({
  row,
  variant,
  hrefBase,
}: {
  row: ProjectRow;
  variant: Variant;
  hrefBase: string;
}) {
  const esCotizacion =
    variant === "cotizacion" || variant === "archivado" || variant === "convertida";
  const numero = esCotizacion
    ? row.numeroCotizacion != null
      ? `C-${row.numeroCotizacion}`
      : "—"
    : row.numeroProyecto != null
      ? String(row.numeroProyecto)
      : "—";

  const monto = (n: number) =>
    n > 0 ? formatCLP(n) : <span className="text-gray-300">—</span>;

  const dateLabel =
    variant === "convertida"
      ? row.convertedAt
        ? row.convertedAt.toLocaleDateString("es-CL", { month: "short", year: "numeric" })
        : "—"
      : variant === "cotizacion" || variant === "archivado"
        ? relativeDate(row.createdAt ?? row.lastActivity)
        : relativeDate(row.lastActivity);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="flex items-center gap-1.5 shrink-0 pt-0.5 tabular-nums text-sm font-medium text-gray-700">
          {row.hasAlert && (
            <span
              aria-label="Alerta activa"
              title="Tiene alerta activa"
              className="w-1.5 h-1.5 rounded-full bg-red-500"
            />
          )}
          {numero}
        </span>
        <div className="min-w-0 flex-1">
          <EditableCell
            value={row.name}
            projectId={row.id}
            field="name"
            href={`${hrefBase}/${row.id}`}
            textClassName="text-gray-900 font-medium"
          />
          {row.clientName !== row.name && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {row.clientName}
            </p>
          )}
        </div>
        <div className="shrink-0 -mr-1">
          {!row.isInternal && (variant === "ejecucion" || variant === "terminado") && (
            <ProjectStatusMenu
              projectId={row.id}
              projectName={row.name}
              status={row.status}
            />
          )}
          {(variant === "cotizacion" || variant === "archivado") && (
            <span className="inline-flex items-center justify-end gap-0.5">
              <ArchivarCotizacionButton
                projectId={row.id}
                projectName={row.name}
                archivada={variant === "archivado"}
                numeroProyecto={row.numeroProyecto}
              />
              <BorrarCotizacionButton projectId={row.id} projectName={row.name} />
            </span>
          )}
        </div>
      </div>

      {/* Los montos abajo, con su rótulo al lado: en el celular no hay
          encabezado de columna que explique qué es cada número. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2 text-xs">
        {(variant === "ejecucion" || variant === "terminado") && (
          <>
            <span className="text-gray-400">
              Gastado{" "}
              <span className="text-gray-900 tabular-nums">{monto(row.gastado)}</span>
            </span>
            <span className="text-gray-400">
              Vendido{" "}
              <span className="text-gray-900 tabular-nums">{monto(row.vendido)}</span>
            </span>
          </>
        )}
        {(variant === "cotizacion" || variant === "archivado" || variant === "convertida") && (
          <span className="text-gray-400">
            Monto{" "}
            <span className="text-gray-900 tabular-nums">{monto(row.vendido)}</span>
          </span>
        )}
        {variant === "convertida" && row.numeroProyecto != null && (
          <span className="text-gray-400 tabular-nums">
            → Proyecto {row.numeroProyecto}
          </span>
        )}
        {variant !== "ejecucion" && (
          <span className="text-gray-400 ml-auto">{dateLabel}</span>
        )}
      </div>
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
      : // En cotizaciones/archivadas la columna se llama "Creada" y muestra la
        // fecha de creación, que es el orden en que están listadas. En
        // terminado la columna es "Terminado" y sigue con la última actividad.
        variant === "cotizacion" || variant === "archivado"
        ? relativeDate(row.createdAt ?? row.lastActivity)
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
        {/* Click → navega al detalle. Lápiz al hover o doble-click → editar */}
        <EditableCell
          value={row.name}
          projectId={row.id}
          field="name"
          href={`${hrefBase}/${row.id}`}
          textClassName="text-gray-900"
        />
      </td>
      <td className="px-3 py-2 text-gray-500">
        {/* Si clientName === name, mostramos "—" pero el editor arranca con
            el valor real (clientName=name) para que MJ pueda corregirlo
            sin tener que escribir desde cero. */}
        <EditableCell
          value={row.clientName}
          displayValue={row.clientName === row.name ? "" : row.clientName}
          projectId={row.id}
          field="clientName"
          placeholder="—"
          textClassName="text-gray-500"
        />
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
      {variant !== "ejecucion" && (
        <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{dateLabel}</td>
      )}
      <td className="px-2 py-2 text-right">
        {/* El menú solo aparece para proyectos NO internos en estados
            donde tiene sentido cambiar status (ejecucion, terminado). */}
        {!row.isInternal && (variant === "ejecucion" || variant === "terminado") && (
          <ProjectStatusMenu
            projectId={row.id}
            projectName={row.name}
            status={row.status}
          />
        )}
        {/* Acciones de cotización, agrupadas para que no se amontonen:
            archivar (neutro, reversible) y eliminar (destructivo). Solo en
            cotizaciones sin convertir (activas/archivadas) — en convertidas
            no se ofrecen: son obra viva. */}
        {(variant === "cotizacion" || variant === "archivado") && (
          <span className="inline-flex items-center justify-end gap-0.5">
            <ArchivarCotizacionButton
              projectId={row.id}
              projectName={row.name}
              archivada={variant === "archivado"}
              numeroProyecto={row.numeroProyecto}
            />
            <BorrarCotizacionButton projectId={row.id} projectName={row.name} />
          </span>
        )}
      </td>
    </tr>
  );
}
