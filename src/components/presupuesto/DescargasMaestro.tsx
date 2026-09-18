"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { groupByChapter, type ChapterLike } from "@/lib/presupuesto/chapters";
import { BUDGET_STATUSES, type BudgetStatus } from "@/lib/utils";

// Los dos documentos que se le mandan al maestro (PDF y Excel), con un tilde
// que decide CUÁL de las dos versiones baja:
//
//   · destildado (default) = sin precios — el alcance para que el maestro
//     cotice, con las columnas P.U. y TOTAL en blanco.
//   · tildado = con la mano de obra ya acordada escrita, para cuando el trato
//     está cerrado (`?precios=1` en el endpoint).
//
// El tilde en vez de cuatro botones lo eligió MJ sobre un mockup: la barra ya
// tiene "Descargar PDF" y cuatro botones más la dejaban ilegible.
//
// Desde 2026-09 los botones NO descargan directo: abren una ventana donde MJ
// elige a QUÉ maestro se lo manda y tilda QUÉ partidas va a hacer (antes salía
// el presupuesto entero, y con dos maestros en una obra eso no sirve). La
// ventana la eligió MJ entre dos dibujos: maestro arriba, partidas por
// capítulo, conteo y descarga al pie.
//
// La selección es SOLO para el documento: no guarda asignaciones ni toca los
// Estados de Pago. Lo único que toma del reparto guardado es el punto de
// partida — si el maestro ya tiene partidas asignadas en ESTA versión,
// arrancan tildadas. En una versión recién duplicada (Candelaria V3) no hay
// nada asignado y se eligen acá.
//
// El estado del tilde "con precios" es solo de esta pantalla (no se guarda):
// arranca siempre destildado, que es el documento que se manda más seguido, y
// la ventana lo hereda. Como los dos archivos se llaman distinto (el con
// precios dice CON_PRECIOS en el nombre), un despiste se nota antes de
// mandarlo.

interface DescargasMaestroProps {
  budgetId: string;
}

type Formato = "pdf" | "xlsx";

interface PartidaSel {
  id: string;
  chapterId: string | null;
  subChapter: string | null;
  sortOrder: number;
  name: string;
  unit: string;
  quantity: number;
  costLabor: number | null;
  maestroId: string | null;
  sinManoDeObra: boolean;
}

interface DatosVentana {
  project: { name: string };
  budget: { version: string; status: string };
  maestros: { id: string; name: string }[];
  chapters: ChapterLike[];
  items: PartidaSel[];
}

const fmtQty = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

export default function DescargasMaestro({ budgetId }: DescargasMaestroProps) {
  const [conPrecios, setConPrecios] = useState(false);
  // Qué documento pidió MJ al abrir la ventana: ese va como botón principal.
  const [abierta, setAbierta] = useState<Formato | null>(null);

  return (
    <>
      <label
        className="flex items-center gap-2 px-2.5 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-600 cursor-pointer select-none hover:bg-gray-100"
        title="Tildado, los dos documentos salen con la mano de obra acordada (lo que le pagás al maestro). Destildado, salen en blanco para que él cotice."
      >
        <input
          type="checkbox"
          checked={conPrecios}
          onChange={(e) => setConPrecios(e.target.checked)}
          className="accent-gray-900"
        />
        con precios
      </label>
      <button
        type="button"
        onClick={() => setAbierta("pdf")}
        className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        title={
          conPrecios
            ? "PDF con las partidas, cantidades y la mano de obra acordada — para el trato ya cerrado"
            : "PDF con las partidas y cantidades, sin precios — para que el maestro cotice"
        }
      >
        PDF maestro
      </button>
      <button
        type="button"
        onClick={() => setAbierta("xlsx")}
        className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        title={
          conPrecios
            ? "Excel con la mano de obra acordada ya escrita y el total calculado"
            : "Excel editable con fórmulas — el maestro completa P.U. y el TOTAL se calcula solo"
        }
      >
        Excel maestro
      </button>
      {abierta && (
        <VentanaSeleccion
          budgetId={budgetId}
          formatoInicial={abierta}
          conPreciosInicial={conPrecios}
          onClose={() => setAbierta(null)}
        />
      )}
    </>
  );
}

// ─── La ventana ──────────────────────────────────────────────────────────────

function VentanaSeleccion({
  budgetId,
  formatoInicial,
  conPreciosInicial,
  onClose,
}: {
  budgetId: string;
  formatoInicial: Formato;
  conPreciosInicial: boolean;
  onClose: () => void;
}) {
  const [datos, setDatos] = useState<DatosVentana | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maestroId, setMaestroId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conPrecios, setConPrecios] = useState(conPreciosInicial);

  // Se lee al abrir, no al cargar la página: MJ abre el PDF después de editar
  // partidas y los datos del render de la página estarían viejos.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/presupuestos/${budgetId}/maestro/partidas`)
      .then(async (res) => {
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || "No se pudieron cargar las partidas");
        }
        return res.json() as Promise<DatosVentana>;
      })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        // Con un solo maestro en la obra no hay nada que elegir: queda puesto.
        // Con varios, MJ elige (arranca vacío para que no salga a nombre del
        // equivocado por default).
        const inicial = d.maestros.length === 1 ? d.maestros[0].id : "";
        setMaestroId(inicial);
        setSelected(asignadasDe(d.items, inicial));
      })
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [budgetId]);

  // Las que se pueden tildar: todas menos las sin mano de obra (esas se
  // muestran apagadas para que se vea qué queda afuera, pero no van nunca).
  const elegibles = useMemo(
    () => new Set((datos?.items ?? []).filter((i) => !i.sinManoDeObra).map((i) => i.id)),
    [datos]
  );

  // Agrupadas por capítulo con la MISMA numeración que ve MJ en el editor y el
  // cliente en su PDF (helper compartido). Se agrupa sobre TODAS las partidas
  // de la versión, incluidas las apagadas, para que el número no cambie.
  const grupos = useMemo(
    () => (datos ? groupByChapter(datos.chapters, datos.items) : []),
    [datos]
  );

  function cambiarMaestro(id: string) {
    setMaestroId(id);
    // Si el maestro nuevo ya tiene partidas repartidas en esta versión, se
    // cargan las suyas. Si no tiene ninguna, la selección se deja como está —
    // no le borramos a MJ lo que ya tildó por cambiar el nombre de arriba.
    if (!datos) return;
    const suyas = asignadasDe(datos.items, id);
    if (suyas.size > 0) setSelected(suyas);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleCapitulo(ids: string[], marcar: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (marcar) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const total = elegibles.size;
  const cuenta = selected.size;
  // Con maestros en la obra, hay que elegir uno (el documento sale a su
  // nombre). Sin ninguno vinculado, se puede bajar igual, sin destinatario.
  const faltaMaestro = (datos?.maestros.length ?? 0) > 0 && !maestroId;
  const puedeDescargar = !!datos && cuenta > 0 && !faltaMaestro;

  function descargar(formato: Formato) {
    if (!puedeDescargar) return;
    const qs = new URLSearchParams({ format: formato });
    if (maestroId) qs.set("maestroId", maestroId);
    if (conPrecios) qs.set("precios", "1");
    qs.set("items", [...selected].join(","));
    const url = `/api/presupuestos/${budgetId}/maestro?${qs.toString()}`;
    // El PDF se abre en otra pestaña (igual que antes); el Excel es un
    // attachment y baja directo.
    if (formato === "pdf") window.open(url, "_blank");
    else window.location.assign(url);
    onClose();
  }

  const estado = datos
    ? (BUDGET_STATUSES[datos.budget.status as BudgetStatus]?.label ??
      datos.budget.status)
    : "";

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader
        title={formatoInicial === "pdf" ? "PDF maestro" : "Excel maestro"}
        subtitle={
          datos
            ? `${datos.project.name} · Obra ${datos.budget.version} · ${estado.toLowerCase()}`
            : "Cargando…"
        }
        onClose={onClose}
      />
      <ModalBody>
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : !datos ? (
          <p className="text-sm text-gray-500">Cargando partidas…</p>
        ) : (
          <div className="space-y-4">
            {/* Maestro */}
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Maestro
              </span>
              {datos.maestros.length === 0 ? (
                <span className="text-sm text-gray-500">
                  Esta obra no tiene maestros vinculados — el documento sale sin
                  nombre. Se agregan desde Estados de Pago.
                </span>
              ) : (
                <select
                  value={maestroId}
                  onChange={(e) => cambiarMaestro(e.target.value)}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm text-gray-900 bg-white min-w-[16rem]"
                >
                  {datos.maestros.length > 1 && (
                    <option value="">— elegir maestro —</option>
                  )}
                  {datos.maestros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Partidas */}
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>Partidas de esta versión</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(elegibles))}
                    className="px-2 py-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                  >
                    Seleccionar todo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="px-2 py-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                  >
                    Ninguno
                  </button>
                </span>
              </div>

              {datos.items.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center border border-gray-200 rounded-lg">
                  Esta versión no tiene partidas todavía.
                </p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-200">
                  {grupos.map((g) => {
                    const idsCap = g.items
                      .filter((i) => elegibles.has(i.id))
                      .map((i) => i.id);
                    const marcadas = idsCap.filter((id) => selected.has(id)).length;
                    return (
                      <div key={g.chapter.id}>
                        <FilaCapitulo
                          nombre={g.chapter.name}
                          marcadas={marcadas}
                          total={idsCap.length}
                          onToggle={(marcar) => toggleCapitulo(idsCap, marcar)}
                        />
                        {g.items.map((it, idx) => {
                          const numero = `${g.index ?? 0}.${idx + 1}`;
                          if (it.sinManoDeObra) {
                            return (
                              <div
                                key={it.id}
                                className="flex items-center gap-3 pl-9 pr-3 py-1.5 border-t border-gray-100 text-sm text-gray-400"
                                title="Mano de obra en 0 con costo de material o subcontrato: no es trabajo del maestro y no sale en su documento"
                              >
                                <span className="h-4 w-4 shrink-0" />
                                <span className="w-9 shrink-0 text-xs tabular-nums">
                                  {numero}
                                </span>
                                <span className="flex-1 truncate">{it.name}</span>
                                <span className="text-[11px] border border-gray-200 rounded-full px-2 py-px shrink-0">
                                  sin mano de obra
                                </span>
                                <span className="text-xs tabular-nums shrink-0 w-16 text-right">
                                  {fmtQty.format(it.quantity)} {it.unit}
                                </span>
                              </div>
                            );
                          }
                          const isSel = selected.has(it.id);
                          return (
                            <label
                              key={it.id}
                              className="flex items-center gap-3 pl-9 pr-3 py-1.5 border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={() => toggle(it.id)}
                                className="h-4 w-4 rounded border-gray-300 accent-gray-900 shrink-0"
                              />
                              <span className="w-9 shrink-0 text-xs text-gray-500 tabular-nums">
                                {numero}
                              </span>
                              <span className="flex-1 text-sm text-gray-800 truncate">
                                {it.name}
                              </span>
                              <span className="text-xs text-gray-500 tabular-nums shrink-0 w-16 text-right">
                                {fmtQty.format(it.quantity)} {it.unit}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none mr-auto">
          <span className="tabular-nums">
            <b className="font-semibold text-gray-900">{cuenta}</b>
            {datos ? ` de ${total} partidas` : ""}
          </span>
          <span className="text-gray-300">·</span>
          <input
            type="checkbox"
            checked={conPrecios}
            onChange={(e) => setConPrecios(e.target.checked)}
            className="accent-gray-900"
          />
          con precios
        </label>
        <button
          type="button"
          onClick={onClose}
          className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        >
          Cancelar
        </button>
        {/* El que MJ apretó en la barra va último y en negro. */}
        {(formatoInicial === "pdf"
          ? (["xlsx", "pdf"] as const)
          : (["pdf", "xlsx"] as const)
        ).map((f) => {
            const principal = f === formatoInicial;
            return (
              <button
                key={f}
                type="button"
                onClick={() => descargar(f)}
                disabled={!puedeDescargar}
                title={
                  faltaMaestro
                    ? "Elegí a qué maestro se lo mandás"
                    : cuenta === 0
                      ? "Tildá al menos una partida"
                      : undefined
                }
                className={
                  principal
                    ? "bg-gray-900 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    : "border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                }
              >
                {principal ? "Descargar " : ""}
                {f === "pdf" ? "PDF" : "Excel"}
              </button>
            );
          })}
      </ModalFooter>
    </Modal>
  );
}

// Fila de capítulo con su casilla de "todo el capítulo": tildada si están
// todas, a medias (indeterminate) si hay algunas, vacía si ninguna. La
// propiedad `indeterminate` no existe como atributo en JSX: hay que ponerla
// por ref.
function FilaCapitulo({
  nombre,
  marcadas,
  total,
  onToggle,
}: {
  nombre: string;
  marcadas: number;
  total: number;
  onToggle: (marcar: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const todas = total > 0 && marcadas === total;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = marcadas > 0 && !todas;
  }, [marcadas, todas]);
  return (
    <label
      className={`flex items-center gap-3 px-3 py-1.5 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${
        total > 0 ? "cursor-pointer" : ""
      }`}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={todas}
        disabled={total === 0}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 accent-gray-900 shrink-0 disabled:opacity-30"
      />
      <span className="flex-1">{nombre}</span>
      <span className="font-medium normal-case tracking-normal tabular-nums text-gray-400">
        {marcadas} / {total}
      </span>
    </label>
  );
}

// Las partidas ya repartidas a un maestro en esta versión (las elegibles,
// nunca las sin mano de obra). Es el punto de partida de la selección.
function asignadasDe(items: PartidaSel[], maestroId: string): Set<string> {
  if (!maestroId) return new Set();
  return new Set(
    items
      .filter((i) => i.maestroId === maestroId && !i.sinManoDeObra)
      .map((i) => i.id)
  );
}
