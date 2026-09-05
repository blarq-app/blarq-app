"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import { SenalGuardado, useSenalGuardado } from "@/components/banco/senalGuardado";
import { groupEpItemsByChapter } from "@/lib/presupuesto/chapters";
import { annotateZones } from "@/lib/presupuesto/zones";
import {
  computeEPItem,
  validateQuantityExecuted,
  pctToQuantity,
  sumEPTotals,
  type EPItemSnapshot,
} from "@/lib/ep/calculations";
import SyncDiffModal from "./SyncDiffModal";

type Item = {
  id: string;
  obraItemId: string;
  lineageId: string;
  chapterName: string | null;
  chapterOrder: number;
  subChapter: string | null;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  laborTotal: number;
  quantityExecuted: number;
  amountPaid: number | null;
  outOfScope: boolean;
  pctAccumulated: number;
  sortOrder: number;
};

type EP = {
  id: string;
  number: number;
  date: string;
  status: string; // borrador | cerrado
  closedAt: string | null;
  notes: string | null;
  project: {
    id: string;
    name: string;
    clientName: string;
    address: string | null;
    ufReference: number | null;
    maestro: { name: string; rut: string | null } | null;
  };
  // Maestro dueño de este EP (Opción B). null en EPs legacy de obra completa.
  maestro: { name: string; rut: string | null } | null;
  budgetVersion: { id: string; version: string; status: string } | null;
  items: Item[];
};

type PreviousEpSummary = {
  id: string;
  number: number;
  date: string;
  closedAt: string | null;
  totalPaid: number;
};

export default function EditorEP({
  ep,
  prevExecutedByLineage,
  prevAmountPaidByLineage,
  previousEps,
  latestBudgetVersion,
  hasNewerVersion,
  hiddenItemIds = [],
  budgetVersions = [],
}: {
  ep: EP;
  prevExecutedByLineage: Record<string, number>;
  prevAmountPaidByLineage: Record<string, number>;
  previousEps: PreviousEpSummary[];
  latestBudgetVersion: { id: string; version: string } | null;
  hasNewerVersion: boolean;
  // Versiones de obra disponibles, para elegir a mano contra cuál sincronizar.
  budgetVersions?: { id: string; version: string; status: string }[];
  // Ids de partidas a esconder: material/subcontrato de un tercero, sin mano de
  // obra de este maestro (ej. "espejo a medida"). Ver src/lib/ep/hideNoLabor.ts.
  hiddenItemIds?: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(ep.items);
  const [date, setDate] = useState(ep.date.split("T")[0]);
  const [notes, setNotes] = useState(ep.notes || "");
  const [showSyncModal, setShowSyncModal] = useState(false);
  // El EP guarda SOLO, al salir de cada campo — igual que el editor de obra y
  // el de muebles. Antes tenía un botón "Guardar cambios" y era la única
  // pantalla de la app que lo pedía: salir sin apretarlo perdía todo el avance
  // cargado. La señal "guardando… / ✓ guardado" es la misma que usa el banco.
  const { busy, confirmado, setSaving, refrescarYConfirmar } = useSenalGuardado();
  // Lo último que quedó confirmado en el servidor para fecha y notas, para no
  // mandar un guardado cuando el campo se abandona sin haber cambiado nada.
  const fechaGuardada = useRef(ep.date.split("T")[0]);
  const notasGuardadas = useRef(ep.notes || "");
  // input mode por item: por default es "pct" (decisión: el usuario calcula
  // el % en su cabeza y lo tipea; la cantidad ejecutada se deriva).
  const [inputMode, setInputMode] = useState<Record<string, "qty" | "pct">>({});
  // mensaje de validación por item (transient)
  const [errorByItem, setErrorByItem] = useState<Record<string, string | null>>({});

  const isClosed = ep.status === "cerrado";

  // Snapshots para los cálculos puros
  const snapshotsById = useMemo<Record<string, EPItemSnapshot>>(() => {
    const map: Record<string, EPItemSnapshot> = {};
    for (const i of items) {
      map[i.id] = {
        quantity: i.quantity,
        laborUnitPrice: i.laborUnitPrice,
        quantityExecuted: i.quantityExecuted,
        prevExecutedQuantity: prevExecutedByLineage[i.lineageId] ?? 0,
        prevAmountPaid: prevAmountPaidByLineage[i.lineageId] ?? 0,
        outOfScope: i.outOfScope,
      };
    }
    return map;
  }, [items, prevExecutedByLineage, prevAmountPaidByLineage]);

  // Totales del EP
  const totals = useMemo(
    () => sumEPTotals(Object.values(snapshotsById)),
    [snapshotsById]
  );
  const totalAccumulatedAllPriorClosedEps = previousEps.reduce(
    (s, p) => s + p.totalPaid,
    0
  );

  const hiddenSet = useMemo(() => new Set(hiddenItemIds), [hiddenItemIds]);
  // Capítulos del EP: agrupados por la FOTO que guarda cada partida
  // (chapterName + chapterOrder), con el mismo helper y la misma numeración
  // que la cotización y el PDF. Las partidas sin mano de obra de este maestro
  // (material/subcontrato de un tercero) quedan fuera: su MO es $0, así que
  // esconderlas no cambia ningún total.
  const chapterGroups = useMemo(
    () =>
      groupEpItemsByChapter(
        items
          .filter((i) => !hiddenSet.has(i.id))
          .map((i) => ({ ...i, total: i.laborTotal }))
      ),
    [items, hiddenSet]
  );
  // Zona efectiva por partida (derivada por posición, mismo helper que la
  // cotización y el PDF), alineada 1:1 con las partidas de cada capítulo.
  const zoneRowsByChapter = useMemo(() => {
    const m: Record<
      string,
      { item: Item; zone: string | null; isZoneStart: boolean }[]
    > = {};
    for (const g of chapterGroups) {
      m[g.chapter.id] = annotateZones(g.items).rows as unknown as {
        item: Item;
        zone: string | null;
        isZoneStart: boolean;
      }[];
    }
    return m;
  }, [chapterGroups]);

  // ── Guardado ──────────────────────────────────────────────────────────
  //
  // Los guardados se encadenan uno detrás de otro: nunca hay dos escrituras en
  // vuelo al mismo tiempo. Es la lección del PR #202 (las cantidades de
  // herrajes mandaban un PUT por tecla y las respuestas se pisaban). Acá el
  // disparo ya es al salir del campo, no por tecla, y la cola cierra el resto:
  // además permite ESPERAR lo pendiente antes de cerrar el EP o abrir el PDF.
  const colaGuardado = useRef<Promise<unknown>>(Promise.resolve());
  const pendientes = useRef(0);

  function encolar(tarea: () => Promise<void>) {
    pendientes.current += 1;
    setSaving(true);
    colaGuardado.current = colaGuardado.current
      .then(tarea, tarea)
      .catch(() => {})
      .then(() => {
        pendientes.current -= 1;
        // El refresco de pantalla va FUERA de la cola, y recién cuando no queda
        // nada por mandar: así cargar cinco partidas seguidas hace UN refresco
        // en vez de cinco. Metido adentro, cada guardado esperaba el re-render
        // del anterior y la cola se arrastraba varios segundos — lo suficiente
        // para que el último avance todavía no hubiera salido al recargar.
        if (pendientes.current === 0) {
          refrescarYConfirmar();
          setSaving(false);
        }
      });
  }

  // La cola tiene SOLO los guardados, así que esperarla es rápido.
  function esperarGuardados() {
    return colaGuardado.current;
  }

  function mostrarError(id: string, err: string) {
    setErrorByItem((m) => ({ ...m, [id]: err }));
    // Limpiar mensaje a los 5s
    setTimeout(() => setErrorByItem((m) => ({ ...m, [id]: null })), 5000);
  }

  // ── Edición ───────────────────────────────────────────────────────────
  // Guarda el avance de UNA partida. Se llama al SALIR del campo (blur/Enter),
  // no en cada tecla: así el número que se guarda es exactamente el que MJ
  // terminó de escribir, y no uno intermedio ("5" camino a "50").
  function tryUpdateQty(id: string, newQty: number): boolean {
    const item = items.find((i) => i.id === id);
    if (!item || isClosed || item.outOfScope) return false;
    const snap = snapshotsById[id];
    const err = validateQuantityExecuted(newQty, {
      prevExecutedQuantity: snap.prevExecutedQuantity,
      quantity: snap.quantity,
      outOfScope: snap.outOfScope,
    });
    if (err) {
      mostrarError(id, err);
      return false;
    }
    // Sin cambio real: no vale la pena molestar al servidor (pasa cada vez que
    // se entra y se sale de un campo sin tocarlo, tabulando por la tabla).
    if (Math.abs(newQty - item.quantityExecuted) < 1e-9) return true;

    // Valores previos, por si el servidor rechaza y hay que volver atrás.
    const qtyPrevia = item.quantityExecuted;
    const pctPrevio = item.pctAccumulated;

    // La pantalla se actualiza al toque; el guardado va detrás.
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              quantityExecuted: newQty,
              pctAccumulated:
                i.quantity > 0 ? (newQty / i.quantity) * 100 : 0,
            }
          : i
      )
    );
    setErrorByItem((m) => ({ ...m, [id]: null }));

    encolar(async () => {
      // Si no quedó guardado, la pantalla no puede seguir mostrándolo como si
      // sí: se vuelve al valor anterior y se explica por qué.
      const revertir = () =>
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, quantityExecuted: qtyPrevia, pctAccumulated: pctPrevio }
              : i
          )
        );
      try {
        const res = await fetch(`/api/estados-pago/${ep.id}/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantityExecuted: newQty }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          revertir();
          mostrarError(id, j.error || "No se pudo guardar el avance.");
        }
      } catch {
        revertir();
        mostrarError(id, "No se pudo guardar: revisá la conexión.");
      }
    });

    return true;
  }

  function setMode(id: string, mode: "qty" | "pct") {
    setInputMode((m) => ({ ...m, [id]: mode }));
  }

  // Fecha y notas del encabezado. Van por el PUT del EP (no tocan partidas),
  // también al salir del campo.
  function guardarCabecera(patch: { date?: string; notes?: string }) {
    encolar(async () => {
      const res = await fetch(`/api/estados-pago/${ep.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Error al guardar");
        // Volver a lo último confirmado: el campo no puede quedar mostrando
        // algo que no se guardó.
        if (patch.date !== undefined) setDate(fechaGuardada.current);
        if (patch.notes !== undefined) setNotes(notasGuardadas.current);
        return;
      }
      if (patch.date !== undefined) fechaGuardada.current = patch.date;
      if (patch.notes !== undefined) notasGuardadas.current = patch.notes;
    });
  }

  // ── Cierre / Sync / PDF ───────────────────────────────────────────────
  // Las tres esperan la cola: al hacer clic el campo que estaba en foco dispara
  // su blur y encola su guardado, pero ese guardado todavía está viajando. Sin
  // el await, el PDF podría salir sin el último avance tipeado.
  async function openSyncModal() {
    await esperarGuardados();
    setShowSyncModal(true);
  }

  async function closeEp() {
    await esperarGuardados();
    if (
      !confirm(
        "¿Cerrar este EP?\n\n" +
          "Al cerrarlo, las cantidades ejecutadas quedarán bloqueadas y servirán de base para el siguiente EP. El monto pagado de cada partida se congela como snapshot histórico.\n\n" +
          "Esta acción no se puede deshacer fácilmente."
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estados-pago/${ep.id}/close`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Error al cerrar");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function openPdf() {
    // La pestaña se abre SINCRÓNICAMENTE, dentro del clic. Si se abriera recién
    // después de esperar el guardado, el bloqueador de pop-ups la mataría.
    const pestana = window.open("", "_blank");
    esperarGuardados().then(() => {
      const url = `/api/estados-pago/${ep.id}/pdf?variant=maestro`;
      if (pestana) pestana.location.href = url;
      else window.open(url, "_blank");
    });
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar EP #${ep.number}?`)) return;
    const res = await fetch(`/api/estados-pago/${ep.id}`, { method: "DELETE" });
    if (res.ok) router.push(`/proyectos/${ep.project.id}/estados-pago`);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* HEADER — datos del proyecto + EP */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {/* Columna izquierda */}
          <div className="space-y-3">
            <Field label="Mandante" value={ep.project.clientName} />
            <Field label="Proyecto" value={ep.project.name} />
            <Field label="Dirección" value={ep.project.address || "—"} />
          </div>
          {/* Columna derecha */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Field
                label="Fecha"
                editable={!isClosed}
                inputType="date"
                value={date}
                onChange={setDate}
                onCommit={(v) => {
                  if (v !== fechaGuardada.current) guardarCabecera({ date: v });
                }}
              />
              <Field
                label="Versión presupuesto"
                value={ep.budgetVersion?.version ?? "—"}
                badge={
                  hasNewerVersion && latestBudgetVersion
                    ? `⚠ ${latestBudgetVersion.version} disponible`
                    : null
                }
              />
            </div>
            <Field
              label="Maestro"
              value={
                ep.maestro?.name ||
                ep.project.maestro?.name ||
                "— Sin asignar —"
              }
            />
            <div className="flex items-center justify-between">
              <Field
                label="Estado"
                value=""
                rawValue={
                  <span
                    className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      isClosed
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {ep.status}
                  </span>
                }
              />
              {ep.project.ufReference != null && (
                <Field
                  label="Valor UF"
                  value={formatCLP(ep.project.ufReference)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
          {/* No hay botón de guardar: el EP guarda solo al salir de cada campo.
              Acá va la señal de que quedó guardado, en un lugar fijo — el mismo
              lugar donde antes estaba el botón. */}
          {!isClosed && (
            <span className="mr-auto">
              <SenalGuardado busy={busy} confirmado={confirmado} />
            </span>
          )}
          {hasNewerVersion && !isClosed && (
            <button
              onClick={openSyncModal}
              className="text-xs px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500"
            >
              Sincronizar con {latestBudgetVersion?.version}
            </button>
          )}
          <button
            onClick={openPdf}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
          >
            Exportar PDF
          </button>
          {!isClosed && (
            <button
              onClick={closeEp}
              className="text-xs px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-700"
            >
              Cerrar EP
            </button>
          )}
          {!isClosed && (
            <button
              onClick={handleDelete}
              className="text-xs px-3 py-1.5 rounded text-red-500 hover:text-red-700"
            >
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* TABLA DE PARTIDAS */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Headers */}
        <div className="grid grid-cols-[3rem_minmax(0,3fr)_3rem_5rem_5.5rem_6rem_8rem_9rem] items-center gap-2 px-4 py-2 border-y-2 border-gray-900 bg-white text-[10px] font-bold text-gray-900 uppercase tracking-wider">
          <div className="text-center">Item</div>
          <div className="text-left">Partida + Descripción</div>
          <div className="text-center">Un.</div>
          <div className="text-right">Cant. total</div>
          <div className="text-right">P.U MO</div>
          <div className="text-right">Total MO</div>
          <div className="text-right">Avance</div>
          <div className="text-right">$ acumulado</div>
        </div>

        {chapterGroups.map((group) => {
          const chItems = group.items;
          // Número de capítulo reflowado (1, 2, 3… saltando vacíos), igual que
          // la cotización y el PDF.
          const chapterNumber = group.index ?? 0;
          const zoneRows = zoneRowsByChapter[group.chapter.id] ?? [];
          const chSubtotal = chItems.reduce((sum, i) => {
            const c = computeEPItem(snapshotsById[i.id]);
            return sum + c.amountThisEp;
          }, 0);
          return (
            <Fragment key={group.chapter.id}>
              {/* Chapter row */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-[#DBDBDB]">
                <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wide">
                  <span className="inline-block w-6">
                    {chapterNumber}
                  </span>
                  {group.chapter.name}
                </h3>
                <span className="text-[11px] text-gray-700 tabular-nums">
                  Subtotal capítulo {formatCLP(chSubtotal)}
                </span>
              </div>
              {chItems.map((i, idx) => {
                const snap = snapshotsById[i.id];
                const c = computeEPItem(snap);
                const mode = inputMode[i.id] ?? "pct";
                const err = errorByItem[i.id];
                // Zona efectiva (derivada por posición): el encabezado va en la
                // primera partida de cada zona.
                const zoneRow = zoneRows[idx];
                const zone = zoneRow?.zone ?? null;
                const showSub = zoneRow?.isZoneStart ?? false;
                return (
                  <Fragment key={i.id}>
                  {showSub && (
                    <div className="px-4 py-1 bg-[#F2F2F2] text-[11px] font-semibold italic uppercase tracking-wide text-gray-600 border-b border-gray-200">
                      {zone}
                    </div>
                  )}
                  <div
                    className={`grid grid-cols-[3rem_minmax(0,3fr)_3rem_5rem_5.5rem_6rem_8rem_9rem] items-center gap-2 px-4 py-1 border-b border-gray-100 ${
                      i.outOfScope ? "bg-amber-50/40" : ""
                    } ${c.warningExceedsTotal ? "bg-amber-50" : ""}`}
                  >
                    <div className="text-center text-xs text-gray-700 tabular-nums pt-0.5">
                      {chapterNumber}.{idx + 1}
                    </div>
                    {/* Partida + descripción */}
                    <div className="min-w-0">
                      <div className="text-xs uppercase font-medium text-gray-900 leading-tight">
                        {i.name}
                        {i.outOfScope && (
                          <span className="ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tracking-wider">
                            Fuera de alcance
                          </span>
                        )}
                      </div>
                      {i.descriptionMaestro ? (
                        <div className="text-[11px] text-gray-500 leading-snug mt-0.5 whitespace-pre-wrap">
                          {i.descriptionMaestro}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-300 mt-0.5">—</div>
                      )}
                    </div>
                    <div className="text-center pt-0.5">
                      <span className="text-[10px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                        {i.unit}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {fmtNum(i.quantity)}
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {formatCLP(i.laborUnitPrice)}
                    </div>
                    <div className="text-right text-xs text-gray-700 tabular-nums pt-0.5">
                      {formatCLP(c.totalMo)}
                    </div>
                    {/* AVANCE — input editable: % primario, cantidad como hint */}
                    <div className="text-right">
                      {isClosed || i.outOfScope ? (
                        <div className="text-xs tabular-nums text-gray-700 pt-0.5">
                          <div className="font-medium">
                            {c.pctAccumulatedCurrent.toFixed(0)}%
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {fmtNum(i.quantityExecuted)} {i.unit.toLowerCase()}
                          </div>
                          <BarraAvance
                            pctPrev={c.pctAccumulatedPrev}
                            pctTotal={c.pctAccumulatedCurrent}
                            prevPagado={snap.prevAmountPaid}
                            montoEsteEp={c.amountThisEp}
                          />
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1 justify-end leading-none">
                            <AvanceInput
                              mode={mode}
                              pctValue={c.pctAccumulatedCurrent}
                              qtyValue={i.quantityExecuted}
                              totalQuantity={i.quantity}
                              unit={i.unit}
                              onCommitQty={(q) => tryUpdateQty(i.id, q)}
                              onSetMode={(m) => setMode(i.id, m)}
                            />
                          </div>
                          <BarraAvance
                            pctPrev={c.pctAccumulatedPrev}
                            pctTotal={c.pctAccumulatedCurrent}
                            prevPagado={snap.prevAmountPaid}
                            montoEsteEp={c.amountThisEp}
                          />
                          {err && (
                            <div className="text-[10px] text-red-600 leading-tight mt-0.5">
                              {err}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* $ ACUMULADO — total pagado/pagable por esta partida hasta
                        este EP, y de dónde sale: cuánto ya se le pagó al maestro
                        en EPs cerrados y cuánto agrega este. La línea de "ya
                        pagado" solo aparece si hubo EP anterior — en el EP 1 no
                        hay previo y una leyenda en $0 solo haría ruido. */}
                    <div className="text-right text-xs tabular-nums pt-0.5">
                      <div className="font-medium text-gray-900">
                        {formatCLP(c.totalAccumulated)}
                      </div>
                      {snap.prevAmountPaid > 0 && (
                        <div className="text-[10px] text-gray-500 leading-tight">
                          ya pagado {formatCLP(snap.prevAmountPaid)}
                        </div>
                      )}
                      {c.amountThisEp > 0 && (
                        <div className="text-[10px] text-green-700 leading-tight">
                          +{formatCLP(c.amountThisEp)} este EP
                        </div>
                      )}
                    </div>
                  </div>
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>

      {/* RESUMEN AL PIE */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Total mano de obra ({ep.budgetVersion?.version ?? "—"})
          </span>
          <span className="text-sm tabular-nums font-medium text-gray-900">
            {formatCLP(totals.totalMoBudget)}
          </span>
        </div>

        {/* Histórico de pagos por EP (deltas reales) */}
        <div className="border-t border-gray-100 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            Pagos por estado de pago
          </div>
          <table className="w-full text-xs">
            <tbody>
              {previousEps.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-1 text-gray-700">EP #{p.number}</td>
                  <td className="py-1 text-gray-500">
                    {formatDate(new Date(p.closedAt ?? p.date))}
                  </td>
                  <td className="py-1 text-gray-500">Cerrado</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">
                    +{formatCLP(p.totalPaid)}
                  </td>
                </tr>
              ))}
              {/* Este EP */}
              <tr className="border-b border-gray-50 bg-green-50/30">
                <td className="py-1.5 text-gray-900 font-medium">
                  EP #{ep.number}
                </td>
                <td className="py-1.5 text-gray-500">
                  {formatDate(new Date(ep.date))}
                </td>
                <td className="py-1.5 text-gray-700 italic">
                  {isClosed ? "Cerrado" : "Este EP (borrador)"}
                </td>
                <td className="py-1.5 text-right tabular-nums text-green-700 font-medium">
                  +{formatCLP(totals.totalAmountThisEp)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="py-2 text-[10px] uppercase tracking-wider text-gray-700 font-bold">
                  Total acumulado pagado al maestro
                </td>
                <td className="py-2 text-right tabular-nums font-bold text-gray-900 text-sm">
                  {formatCLP(totalAccumulatedAllPriorClosedEps + totals.totalAmountThisEp)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Saldo */}
        <div className="flex items-baseline justify-between text-xs text-gray-500 border-t border-gray-100 pt-3">
          <span>Saldo por pagar al cerrar este EP (referencial)</span>
          <span className="tabular-nums">
            {formatCLP(
              totals.totalMoBudget -
                totalAccumulatedAllPriorClosedEps -
                totals.totalAmountThisEp
            )}
          </span>
        </div>

        {/* Notas */}
        <div className="border-t border-gray-100 pt-3">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Notas
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={(e) => {
              if (e.target.value !== notasGuardadas.current) {
                guardarCabecera({ notes: e.target.value });
              }
            }}
            disabled={isClosed}
            rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-y disabled:bg-gray-50 disabled:text-gray-500 focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
      </div>

      {showSyncModal && (
        <SyncDiffModal
          epId={ep.id}
          versions={budgetVersions}
          defaultTargetVersionId={latestBudgetVersion?.id}
          onClose={() => setShowSyncModal(false)}
          onApplied={() => {
            setShowSyncModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

// Barra de avance de UN SOLO TONO: mide el acumulado de la partida. Cuánto de
// eso ya se le pagó al maestro y cuánto agrega ESTE EP lo dicen los textos de
// la fila (el "+$X este EP" de la columna acumulada) y el título al pasar por
// encima, con el monto de cada parte.
//
// Iba en dos tramos, uno oscuro por lo ya pagado y uno claro por lo nuevo. Los
// dos grises se confundían entre sí y con el riel vacío, así que una barra
// COMPLETA parecía a medio pagar. La barra dice CUÁNTO, el texto de dónde viene.
//
// Gris a propósito (§3): la jerarquía la da el TONO, no el color.
function BarraAvance({
  pctPrev,
  pctTotal,
  prevPagado,
  montoEsteEp,
}: {
  pctPrev: number;
  pctTotal: number;
  prevPagado: number;
  montoEsteEp: number;
}) {
  const prev = clampPct(pctPrev);
  const total = clampPct(pctTotal);
  const nuevo = Math.max(0, total - prev);
  if (total <= 0 && prev <= 0) {
    // Sin avance todavía: la barra vacía no aporta y el cero no tiene que
    // ocupar lugar prominente (§3).
    return <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100" />;
  }
  const detalle = [
    prev > 0 ? `Ya pagado ${prev.toFixed(0)}% · ${formatCLP(prevPagado)}` : null,
    nuevo > 0 ? `Este EP ${nuevo.toFixed(0)}% · ${formatCLP(montoEsteEp)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div
      className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
      title={detalle}
    >
      <div className="bg-gray-500" style={{ width: `${total}%` }} />
    </div>
  );
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// Campo de avance de una partida. Edita en LOCAL mientras se tipea y recién
// manda al servidor al SALIR del campo (blur o Enter) — mismo criterio que la
// cantidad del editor de obra y la de herrajes en muebles.
//
// Por qué importa acá: antes guardaba en cada tecla, así que escribir "50"
// pasaba primero por "5" y disparaba dos guardados; con la validación de tope
// del EP, un intermedio podía quedar rechazado o pisado por la respuesta del
// otro. Al salir del campo se guarda una sola vez, el número final.
//
// Se puede tipear el % (default) o la cantidad; el botoncito gris de al lado
// cambia de modo y muestra el equivalente en la otra unidad.
function AvanceInput({
  mode,
  pctValue,
  qtyValue,
  totalQuantity,
  unit,
  onCommitQty,
  onSetMode,
}: {
  mode: "qty" | "pct";
  pctValue: number;
  qtyValue: number;
  totalQuantity: number;
  unit: string;
  // Devuelve false si el valor no era admisible (tope del EP): ahí el campo
  // vuelve a mostrar lo que había.
  onCommitQty: (qty: number) => boolean;
  onSetMode: (mode: "qty" | "pct") => void;
}) {
  const valorExterno =
    mode === "pct" ? Number(pctValue.toFixed(2)) : Number(qtyValue.toFixed(4));
  const [draft, setDraft] = useState(String(valorExterno));
  // Re-sincroniza cuando el valor cambia desde afuera (se guardó, se revirtió,
  // se sincronizó con otra versión) o cuando se cambia de modo % ↔ cantidad.
  useEffect(() => {
    setDraft(String(valorExterno));
  }, [valorExterno, mode]);

  function commit() {
    const n = parseFloat(draft);
    if (Number.isNaN(n)) {
      setDraft(String(valorExterno));
      return;
    }
    const nuevaQty = mode === "pct" ? pctToQuantity(n, totalQuantity) : n;
    if (!onCommitQty(nuevaQty)) setDraft(String(valorExterno));
  }

  return (
    <>
      <input
        type="number"
        step={mode === "pct" ? "1" : "0.01"}
        min={0}
        max={mode === "pct" ? 100 : undefined}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={`${
          mode === "pct" ? "w-12" : "w-14"
        } border border-gray-300 rounded px-1 py-0.5 text-right text-xs tabular-nums bg-gray-50/40 focus:bg-white focus:ring-1 focus:ring-gray-900 outline-none`}
      />
      {mode === "pct" ? (
        <>
          <span className="text-[10px] text-gray-500">%</span>
          <button
            onClick={() => onSetMode("qty")}
            className="text-[10px] text-gray-300 hover:text-gray-600 tabular-nums leading-none"
            title={`Cambiar a cantidad — equivale a ${fmtNum(qtyValue)} ${unit.toLowerCase()}`}
          >
            ({fmtNum(qtyValue)})
          </button>
        </>
      ) : (
        <button
          onClick={() => onSetMode("pct")}
          className="text-[10px] text-gray-300 hover:text-gray-600 tabular-nums leading-none"
          title="Cambiar a %"
        >
          ({pctValue.toFixed(0)}%)
        </button>
      )}
    </>
  );
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 2,
  }).format(n);
}

function Field({
  label,
  value,
  rawValue,
  editable,
  inputType,
  onChange,
  onCommit,
  badge,
}: {
  label: string;
  value: string;
  rawValue?: React.ReactNode;
  editable?: boolean;
  inputType?: string;
  onChange?: (v: string) => void;
  // Guardado: se dispara al SALIR del campo, no en cada tecla.
  onCommit?: (v: string) => void;
  badge?: string | null;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
        {badge && (
          <span className="ml-2 inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 normal-case font-normal">
            {badge}
          </span>
        )}
      </div>
      {editable ? (
        <input
          type={inputType ?? "text"}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="text-sm text-gray-900 bg-transparent border-0 p-0 focus:ring-0 outline-none"
        />
      ) : rawValue !== undefined ? (
        rawValue
      ) : (
        <p className="text-sm text-gray-900 mt-0.5">{value}</p>
      )}
    </div>
  );
}
