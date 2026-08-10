"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Project = {
  id: string;
  name: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
};

function projectLabel(p: Project): string {
  const n = p.numeroProyecto ?? p.numeroCotizacion;
  return n != null ? `${n} · ${p.name}` : p.name;
}
type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

type FilterValues = {
  type: string;
  status: string;
  origin: string;
  projectId: string;
  tipoDoc: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
  q: string;
  /** Monto exacto en CLP (con tolerancia ±$10 server-side para redondeo IVA). */
  monto: string;
};

/**
 * Cuántas facturas hay de cada valor, contadas por consulta sobre TODAS las
 * facturas que matchean el resto de los filtros — no sobre las 500 filas que
 * la lista alcanza a mostrar. Los arma el page.tsx con groupBy.
 */
type Conteos = {
  tipo: Record<string, number>;
  estado: Record<string, number>;
  documento: Record<string, number>;
};

const FILTER_KEYS: (keyof FilterValues)[] = [
  "type",
  "status",
  "origin",
  "projectId",
  "tipoDoc",
  "categoryId",
  "dateFrom",
  "dateTo",
  "q",
  "monto",
];

const VACIO: FilterValues = {
  type: "",
  status: "",
  origin: "",
  projectId: "",
  tipoDoc: "",
  categoryId: "",
  dateFrom: "",
  dateTo: "",
  q: "",
  monto: "",
};

export default function FacturasFilterBar({
  projects,
  categories = [],
  conteos,
  initial,
}: {
  projects: Project[];
  categories?: Category[];
  conteos: Conteos;
  initial: FilterValues;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [v, setV] = useState(initial);
  // En el celular los filtros apilados ocupaban casi una pantalla entera antes
  // de que apareciera la primera factura. Acá quedan detrás de un botón; la
  // búsqueda libre, que es lo que más se usa, sigue siempre a la vista.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // Las fechas se usan poco comparado con el resto, así que van plegadas —
  // mismo criterio que el panel "Filtros avanzados" del banco. Si hay una
  // fecha puesta arranca abierto, para que no quede un filtro activo
  // escondido sin que se vea.
  const [avanzadosAbiertos, setAvanzadosAbiertos] = useState(
    !!(initial.dateFrom || initial.dateTo),
  );

  function applyFilter(next: FilterValues) {
    setV(next);
    const params = new URLSearchParams(sp.toString());
    FILTER_KEYS.forEach((key) => {
      if (next[key]) params.set(key, next[key]);
      else params.delete(key);
    });
    router.push(`/facturas?${params.toString()}`);
  }

  function set<K extends keyof FilterValues>(key: K, value: FilterValues[K]) {
    applyFilter({ ...v, [key]: value });
  }

  // Categorías agrupadas por padre, igual que en el form de factura.
  const grouped: Record<string, Category[]> = {};
  for (const c of categories) {
    const parentName = c.parent?.name ?? c.name;
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(c);
  }
  const parentNames = Object.keys(grouped).sort();

  const isAnyActive = FILTER_KEYS.some((k) => !!v[k]);
  // "q" no cuenta: su campo está siempre visible, así que no es un filtro
  // "escondido" que haya que anunciar en el botón.
  const activosOcultos = FILTER_KEYS.filter((k) => k !== "q" && !!v[k]).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
      {/* Fila 1: búsqueda libre (siempre visible) + botón de filtros en mobile */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <input
          type="text"
          placeholder="Buscar folio, proveedor, RUT, notas…"
          value={v.q}
          onChange={(e) => setV({ ...v, q: e.target.value })}
          onBlur={() => applyFilter(v)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilter(v);
          }}
          className="flex-1 min-w-0 px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
        />

        <button
          type="button"
          onClick={() => setFiltrosAbiertos((x) => !x)}
          aria-expanded={filtrosAbiertos}
          className="shrink-0 min-h-9 px-3 border border-gray-300 rounded text-sm text-gray-700 whitespace-nowrap"
        >
          Filtros{activosOcultos > 0 ? ` (${activosOcultos})` : ""}
        </button>
      </div>

      {/* Filtros ordenados en jerarquía, calcado de /banco/movimientos: se leen
          de arriba a abajo — primero TIPO (emitida o recibida), después ESTADO,
          después DOCUMENTO, después IMPUTACIÓN, y al final BUSCAR. Cada fila
          con su rótulo a la izquierda.

          Los filtros de pocas opciones van en pastillas CON SU CONTEO: la
          ganancia real es poder ver cuántas facturas pendientes hay sin tener
          que filtrar y contar a mano. Centro de costo (31 proyectos) y
          categoría (árbol de CostCategory) se quedan como desplegables — en
          pastillas ocuparían media pantalla. Origen también: "manual" son 2
          facturas de 2.128 y no paga una fila entera.

          Plegados en el celular, siempre abiertos en md+. */}
      <div className={`${filtrosAbiertos ? "block" : "hidden"} md:block space-y-2`}>
        <FilterRow label="Tipo">
          <Pastilla activo={!v.type} onClick={() => set("type", "")} label="Todas" />
          <Pastilla
            activo={v.type === "emitida"}
            onClick={() => set("type", "emitida")}
            label="Emitida"
            n={conteos.tipo.emitida}
          />
          <Pastilla
            activo={v.type === "recibida"}
            onClick={() => set("type", "recibida")}
            label="Recibida"
            n={conteos.tipo.recibida}
          />
        </FilterRow>

        <FilterRow label="Estado">
          <Pastilla activo={!v.status} onClick={() => set("status", "")} label="Todos" />
          {(
            [
              ["pendiente", "Pendiente"],
              ["parcial", "Parcial"],
              ["pagada", "Pagada"],
              ["anulada", "Anulada"],
            ] as const
          ).map(([valor, etiqueta]) => (
            <Pastilla
              key={valor}
              activo={v.status === valor}
              onClick={() => set("status", valor)}
              label={etiqueta}
              n={conteos.estado[valor]}
            />
          ))}
        </FilterRow>

        {/* Documento: nota débito (56) y boleta (39) están hoy en cero. Las
            pastillas que dan 0 NO se muestran (decisión MJ ago 2026, mismo
            criterio que "Boleta"/"Internacional" en el banco) y aparecen solas
            el día que llegue la primera. Excepción: si el filtro está puesto en
            ese valor, la pastilla se muestra igual — si no, quedaría un filtro
            activo sin forma de soltarlo. */}
        <FilterRow label="Documento">
          <Pastilla activo={!v.tipoDoc} onClick={() => set("tipoDoc", "")} label="Todos" />
          {(
            [
              ["33", "Factura"],
              ["34", "Exenta"],
              ["61", "Nota crédito"],
              ["56", "Nota débito"],
              ["39", "Boleta"],
            ] as const
          )
            .filter(([valor]) => (conteos.documento[valor] ?? 0) > 0 || v.tipoDoc === valor)
            .map(([valor, etiqueta]) => (
              <Pastilla
                key={valor}
                activo={v.tipoDoc === valor}
                onClick={() => set("tipoDoc", valor)}
                label={etiqueta}
                n={conteos.documento[valor]}
              />
            ))}
        </FilterRow>

        {/* Imputación: los tres filtros que se quedan como desplegable. */}
        <FilterRow label="Imputación" sinCaja>
            <Select
              value={v.projectId}
              onChange={(val) => set("projectId", val)}
              options={[
                { label: "Cualquier centro de costo", value: "" },
                { label: "Sin asignar", value: "sin-asignar" },
                ...projects.map((p) => ({ label: projectLabel(p), value: p.id })),
              ]}
            />

            <select
              value={v.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none max-w-[200px]"
            >
              <option value="">Cualquier categoría</option>
              {parentNames.map((parent) => (
                <optgroup key={parent} label={parent}>
                  {grouped[parent].map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent ? c.name : `${c.name} (top)`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <Select
              value={v.origin}
              onChange={(val) => set("origin", val)}
              options={[
                { label: "Cualquier origen", value: "" },
                { label: "Manual", value: "manual" },
                { label: "SII", value: "sii_automatica" },
              ]}
            />
        </FilterRow>

        {/* Buscar — texto libre + monto exacto, a mano en la barra. En mobile el
            buscador ya está arriba de todo, así que acá se muestra en md+. */}
        <div className="flex items-start gap-2">
          <FilterRowLabel>Buscar</FilterRowLabel>
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <input
              type="text"
              placeholder="Buscar folio, proveedor, RUT, notas…"
              value={v.q}
              onChange={(e) => setV({ ...v, q: e.target.value })}
              onBlur={() => applyFilter(v)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter(v);
              }}
              className="hidden md:block flex-1 min-w-[200px] px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            />

            <input
              type="text"
              inputMode="numeric"
              placeholder="monto exacto ±$10"
              value={v.monto}
              onChange={(e) => setV({ ...v, monto: e.target.value })}
              onBlur={() => applyFilter(v)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter(v);
              }}
              className="w-[150px] px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 text-right tabular-nums focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              title="Busca facturas con totalAmount cercano (±$10) al monto. Acepta formato chileno con puntos."
            />

            {/* "Limpiar filtros" al final de la última fila: lejos de las
                pastillas para que no se lea como una más. Solo cuando hay algo
                puesto. */}
            {isAnyActive && (
              <button
                type="button"
                onClick={() => {
                  setAvanzadosAbiertos(false);
                  applyFilter(VACIO);
                }}
                className="ml-auto shrink-0 whitespace-nowrap text-xs text-gray-500 hover:text-gray-900 underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* Filtros avanzados: las fechas, que casi no se usan. */}
        <div className="flex items-start gap-2">
          <FilterRowLabel> </FilterRowLabel>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setAvanzadosAbiertos((x) => !x)}
              aria-expanded={avanzadosAbiertos}
              className="px-2 py-1 -ml-2 text-xs text-gray-500 hover:text-gray-900"
            >
              Filtros avanzados {avanzadosAbiertos ? "▴" : "▾"}
              {!avanzadosAbiertos && (v.dateFrom || v.dateTo) ? " · fechas puestas" : ""}
            </button>

            {avanzadosAbiertos && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    desde
                  </span>
                  <input
                    type="date"
                    value={v.dateFrom}
                    onChange={(e) => set("dateFrom", e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none tabular-nums"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    hasta
                  </span>
                  <input
                    type="date"
                    value={v.dateTo}
                    onChange={(e) => set("dateTo", e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none tabular-nums"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Una fila de filtros: rótulo a la izquierda + sus controles agrupados en la
// cajita blanca. En pantallas angostas la fila scrollea de costado en vez de
// romper el grupo (igual que el banco).
// `sinCaja` para la fila de desplegables: esos traen su propio borde, meterlos
// adentro de la cajita blanca daría borde sobre borde.
function FilterRow({
  label,
  sinCaja = false,
  children,
}: {
  label: string;
  sinCaja?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible">
      <FilterRowLabel>{label}</FilterRowLabel>
      {sinCaja ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : (
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 flex-nowrap sm:flex-wrap shrink-0">
          {children}
        </div>
      )}
    </div>
  );
}

// Rótulo a la izquierda de cada fila. Da el orden de lectura sin peso visual:
// gris chico, alineado a la derecha para que "apunte" a los controles.
function FilterRowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-20 shrink-0 text-right pr-1 pt-1.5 text-[10px] uppercase tracking-wider text-gray-400 select-none">
      {children}
    </span>
  );
}

// Pastilla de filtro con su conteo al lado. Mismo estilo que /banco/movimientos:
// activa = fondo negro, inactiva = gris que se resalta al pasar por encima.
// El número va más tenue que la etiqueta — jerarquía por tipografía, no por
// color. "Todas/Todos" no lleva número: sería el total, que ya está arriba.
function Pastilla({
  activo,
  onClick,
  label,
  n,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
  n?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
        activo ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
      {n != null && (
        <span className={`ml-1 tabular-nums ${activo ? "opacity-75" : "opacity-60"}`}>
          {n.toLocaleString("es-CL")}
        </span>
      )}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-700 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
