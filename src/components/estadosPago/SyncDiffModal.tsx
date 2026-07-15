"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";

type DiffField =
  | "name"
  | "descriptionMaestro"
  | "unit"
  | "quantity"
  | "laborUnitPrice"
  | "itemNumber"
  | "chapter";

type Preview = {
  currentVersion: { id: string; version: string } | null;
  targetVersion: { id: string; version: string };
  added: Array<{
    lineageId: string;
    chapter: string;
    itemNumber: string;
    name: string;
    descriptionMaestro: string | null;
    unit: string;
    quantity: number;
    laborUnitPrice: number;
    laborTotal: number;
  }>;
  removedSafe: Array<{
    id: string;
    lineageId: string;
    chapter: string;
    itemNumber: string;
    name: string;
  }>;
  removedWithPayments: Array<{
    id: string;
    lineageId: string;
    chapter: string;
    itemNumber: string;
    name: string;
    prevAmountPaid: number;
  }>;
  updated: Array<{
    id: string;
    lineageId: string;
    chapter: string;
    itemNumber: string;
    name: string;
    changes: Array<{
      field: DiffField;
      oldValue: string | number | null;
      newValue: string | number | null;
    }>;
  }>;
  unchangedCount: number;
};

const FIELD_LABEL: Record<DiffField, string> = {
  name: "Nombre",
  descriptionMaestro: "Descripción maestro",
  unit: "Unidad",
  quantity: "Cantidad",
  laborUnitPrice: "P.U. mano de obra",
  itemNumber: "N° item",
  chapter: "Capítulo",
};

export default function SyncDiffModal({
  epId,
  versions,
  defaultTargetVersionId,
  onClose,
  onApplied,
}: {
  epId: string;
  // Versiones de obra disponibles: MJ elige contra cuál sincronizar.
  versions: { id: string; version: string; status: string }[];
  defaultTargetVersionId?: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [targetVersionId, setTargetVersionId] = useState<string>(
    defaultTargetVersionId ?? versions[0]?.id ?? ""
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const [acceptedAdds, setAcceptedAdds] = useState<Set<string>>(new Set());
  const [acceptedRemovedSafe, setAcceptedRemovedSafe] = useState<Set<string>>(
    new Set()
  );
  const [acceptedOutOfScope, setAcceptedOutOfScope] = useState<Set<string>>(
    new Set()
  );
  const [acceptedUpdates, setAcceptedUpdates] = useState<Set<string>>(
    new Set()
  );

  // Cargar preview
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = targetVersionId
          ? `?targetVersionId=${encodeURIComponent(targetVersionId)}`
          : "";
        const res = await fetch(`/api/estados-pago/${epId}/sync/preview${qs}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          if (alive) setError(j.error || "No se pudo cargar la previsualización.");
          return;
        }
        const data: Preview = await res.json();
        if (!alive) return;
        setPreview(data);
        // Por defecto, todo seleccionado
        setAcceptedAdds(new Set(data.added.map((a) => a.lineageId)));
        setAcceptedRemovedSafe(new Set(data.removedSafe.map((r) => r.id)));
        setAcceptedOutOfScope(
          new Set(data.removedWithPayments.map((r) => r.id))
        );
        setAcceptedUpdates(new Set(data.updated.map((u) => u.id)));
      } catch {
        if (alive) setError("Error de red al cargar la previsualización.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [epId, targetVersionId]);

  const totals = useMemo(() => {
    if (!preview) return null;
    return {
      added: preview.added.length,
      addedAccepted: acceptedAdds.size,
      removedSafe: preview.removedSafe.length,
      removedSafeAccepted: acceptedRemovedSafe.size,
      outOfScope: preview.removedWithPayments.length,
      outOfScopeAccepted: acceptedOutOfScope.size,
      updated: preview.updated.length,
      updatedAccepted: acceptedUpdates.size,
      unchanged: preview.unchangedCount,
    };
  }, [
    preview,
    acceptedAdds,
    acceptedRemovedSafe,
    acceptedOutOfScope,
    acceptedUpdates,
  ]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function selectAllAdded(checked: boolean) {
    if (!preview) return;
    setAcceptedAdds(checked ? new Set(preview.added.map((a) => a.lineageId)) : new Set());
  }
  function selectAllRemovedSafe(checked: boolean) {
    if (!preview) return;
    setAcceptedRemovedSafe(checked ? new Set(preview.removedSafe.map((r) => r.id)) : new Set());
  }
  function selectAllOutOfScope(checked: boolean) {
    if (!preview) return;
    setAcceptedOutOfScope(checked ? new Set(preview.removedWithPayments.map((r) => r.id)) : new Set());
  }
  function selectAllUpdates(checked: boolean) {
    if (!preview) return;
    setAcceptedUpdates(checked ? new Set(preview.updated.map((u) => u.id)) : new Set());
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/estados-pago/${epId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetVersionId,
          selection: {
            addedLineageIds: Array.from(acceptedAdds),
            removedSafeItemIds: Array.from(acceptedRemovedSafe),
            outOfScopeItemIds: Array.from(acceptedOutOfScope),
            updatedItemIds: Array.from(acceptedUpdates),
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Error al sincronizar");
        return;
      }
      onApplied();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal open onClose={applying ? () => {} : onClose} size="lg">
      <ModalHeader
        title="Sincronizar con presupuesto"
        subtitle={
          preview ? (
            <>
              {preview.currentVersion?.version ?? "—"} → {" "}
              <span className="font-medium text-gray-700">
                {preview.targetVersion.version}
              </span>
            </>
          ) : (
            "Cargando..."
          )
        }
        onClose={applying ? undefined : onClose}
      />
      <ModalBody>
          {/* Selector de versión destino: MJ elige contra cuál sincronizar. */}
          {versions.length > 1 && (
            <div className="flex items-center gap-2 text-xs mb-3">
              <span className="uppercase tracking-wider text-gray-500">
                Sincronizar contra
              </span>
              <select
                value={targetVersionId}
                onChange={(e) => setTargetVersionId(e.target.value)}
                disabled={applying}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-gray-900 focus:outline-none disabled:opacity-50"
              >
                {versions.map((v) => {
                  const estado =
                    v.status === "aprobado"
                      ? "aprobada"
                      : v.status === "enviado"
                        ? "enviada"
                        : v.status === "borrador"
                          ? "borrador"
                          : v.status;
                  return (
                    <option key={v.id} value={v.id}>
                      {v.version} · {estado}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          {loading && (
            <div className="text-sm text-gray-500 text-center py-12">
              Calculando diferencias...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {error}
            </div>
          )}

          {preview && !loading && (
            <>
              {/* Banner explicativo */}
              <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded p-3 leading-relaxed">
                Tus avances (cantidad ejecutada) se preservan siempre. Lo ya
                pagado en EPs cerrados anteriores no se recalcula. Marca solo
                los cambios que quieras aplicar a este EP.
              </div>

              {/* Resumen */}
              {totals && (
                <div className="grid grid-cols-4 gap-2 text-center">
                  <SummaryPill
                    label="Nuevas"
                    accepted={totals.addedAccepted}
                    total={totals.added}
                    color="green"
                  />
                  <SummaryPill
                    label="Modificadas"
                    accepted={totals.updatedAccepted}
                    total={totals.updated}
                    color="blue"
                  />
                  <SummaryPill
                    label="Eliminadas"
                    accepted={totals.removedSafeAccepted + totals.outOfScopeAccepted}
                    total={totals.removedSafe + totals.outOfScope}
                    color="red"
                  />
                  <SummaryPill
                    label="Sin cambios"
                    accepted={totals.unchanged}
                    total={totals.unchanged}
                    color="gray"
                  />
                </div>
              )}

              {/* Sección: añadidas */}
              {preview.added.length > 0 && (
                <Section
                  title="Partidas nuevas"
                  description="Aparecen en la versión nueva del presupuesto. Se agregarán al EP con avance 0%."
                  accent="green"
                  count={preview.added.length}
                  acceptedCount={acceptedAdds.size}
                  onToggleAll={selectAllAdded}
                >
                  {preview.added.map((a) => (
                    <Row
                      key={a.lineageId}
                      checked={acceptedAdds.has(a.lineageId)}
                      onToggle={() =>
                        toggle(acceptedAdds, a.lineageId, setAcceptedAdds)
                      }
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">
                          {chapterLabel(a.chapter)} · {a.itemNumber}
                        </span>
                        <span className="text-xs font-medium text-gray-900 truncate">
                          {a.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {a.quantity} {a.unit.toLowerCase()} · P.U. MO{" "}
                        {formatCLP(a.laborUnitPrice)} · Total{" "}
                        <span className="text-gray-700 tabular-nums">
                          {formatCLP(a.laborTotal)}
                        </span>
                      </div>
                    </Row>
                  ))}
                </Section>
              )}

              {/* Sección: modificadas */}
              {preview.updated.length > 0 && (
                <Section
                  title="Partidas modificadas"
                  description="Cambió algún dato (cantidad, P.U., nombre, etc.). Tu avance se preserva; el % se recalcula sobre la nueva cantidad total."
                  accent="blue"
                  count={preview.updated.length}
                  acceptedCount={acceptedUpdates.size}
                  onToggleAll={selectAllUpdates}
                >
                  {preview.updated.map((u) => (
                    <Row
                      key={u.id}
                      checked={acceptedUpdates.has(u.id)}
                      onToggle={() =>
                        toggle(acceptedUpdates, u.id, setAcceptedUpdates)
                      }
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">
                          {chapterLabel(u.chapter)} · {u.itemNumber}
                        </span>
                        <span className="text-xs font-medium text-gray-900 truncate">
                          {u.name}
                        </span>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {u.changes.map((c) => (
                          <ChangeLine key={c.field} change={c} />
                        ))}
                      </div>
                    </Row>
                  ))}
                </Section>
              )}

              {/* Sección: eliminadas sin pagos */}
              {preview.removedSafe.length > 0 && (
                <Section
                  title="Eliminadas (sin pagos previos)"
                  description="Ya no están en la versión nueva. Como no han sido pagadas, se eliminarán del EP."
                  accent="red"
                  count={preview.removedSafe.length}
                  acceptedCount={acceptedRemovedSafe.size}
                  onToggleAll={selectAllRemovedSafe}
                >
                  {preview.removedSafe.map((r) => (
                    <Row
                      key={r.id}
                      checked={acceptedRemovedSafe.has(r.id)}
                      onToggle={() =>
                        toggle(acceptedRemovedSafe, r.id, setAcceptedRemovedSafe)
                      }
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">
                          {chapterLabel(r.chapter)} · {r.itemNumber}
                        </span>
                        <span className="text-xs font-medium text-gray-900 truncate">
                          {r.name}
                        </span>
                      </div>
                    </Row>
                  ))}
                </Section>
              )}

              {/* Sección: eliminadas con pagos → outOfScope */}
              {preview.removedWithPayments.length > 0 && (
                <Section
                  title="Eliminadas (con pagos previos)"
                  description="Ya no están en la versión nueva pero tienen pagos en EPs cerrados. Se marcan como 'fuera de alcance' y permanecen visibles en el histórico."
                  accent="amber"
                  count={preview.removedWithPayments.length}
                  acceptedCount={acceptedOutOfScope.size}
                  onToggleAll={selectAllOutOfScope}
                >
                  {preview.removedWithPayments.map((r) => (
                    <Row
                      key={r.id}
                      checked={acceptedOutOfScope.has(r.id)}
                      onToggle={() =>
                        toggle(acceptedOutOfScope, r.id, setAcceptedOutOfScope)
                      }
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">
                          {chapterLabel(r.chapter)} · {r.itemNumber}
                        </span>
                        <span className="text-xs font-medium text-gray-900 truncate">
                          {r.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-700 mt-0.5">
                        Pagado previo: {formatCLP(r.prevAmountPaid)}
                      </div>
                    </Row>
                  ))}
                </Section>
              )}

              {/* Sin diferencias */}
              {preview.added.length === 0 &&
                preview.updated.length === 0 &&
                preview.removedSafe.length === 0 &&
                preview.removedWithPayments.length === 0 && (
                  <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-4 text-center">
                    No hay diferencias entre el EP y la versión{" "}
                    <span className="font-medium">
                      {preview.targetVersion.version}
                    </span>
                    .
                  </div>
                )}
            </>
          )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={applying} variant="secondary" size="sm">
          Cancelar
        </Button>
        <Button
          onClick={apply}
          disabled={applying || loading || !preview || !!error}
          variant="primary"
          size="sm"
        >
          {applying ? "Aplicando…" : "Aplicar cambios seleccionados"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

function SummaryPill({
  label,
  accepted,
  total,
  color,
}: {
  label: string;
  accepted: number;
  total: number;
  color: "green" | "blue" | "red" | "gray";
}) {
  const colorMap = {
    green: "bg-green-50 text-green-800 border-green-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    red: "bg-red-50 text-red-800 border-red-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <div className={`border rounded px-2 py-1.5 ${colorMap[color]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums">
        {label === "Sin cambios" ? total : `${accepted}/${total}`}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  accent,
  count,
  acceptedCount,
  onToggleAll,
  children,
}: {
  title: string;
  description: string;
  accent: "green" | "blue" | "red" | "amber";
  count: number;
  acceptedCount: number;
  onToggleAll: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const accentMap = {
    green: "border-l-green-500",
    blue: "border-l-blue-500",
    red: "border-l-red-500",
    amber: "border-l-amber-500",
  };
  const allChecked = acceptedCount === count;
  const someChecked = acceptedCount > 0 && acceptedCount < count;
  return (
    <div className={`border-l-4 ${accentMap[accent]} pl-3`}>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
          {title}{" "}
          <span className="text-gray-400 font-normal normal-case">
            ({acceptedCount}/{count})
          </span>
        </h3>
        <label className="text-[10px] text-gray-500 hover:text-gray-900 cursor-pointer flex items-center gap-1">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onChange={(e) => onToggleAll(e.target.checked)}
            className="accent-gray-900"
          />
          Todos
        </label>
      </div>
      <p className="text-[11px] text-gray-500 mb-2 leading-snug">{description}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-2 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
        checked
          ? "border-gray-300 bg-white"
          : "border-gray-200 bg-gray-50 opacity-60"
      } hover:border-gray-400`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 accent-gray-900"
      />
      <div className="flex-1 min-w-0">{children}</div>
    </label>
  );
}

function ChangeLine({
  change,
}: {
  change: {
    field: DiffField;
    oldValue: string | number | null;
    newValue: string | number | null;
  };
}) {
  const fmt = (v: string | number | null) => {
    if (v === null || v === "") return <em className="text-gray-400">vacío</em>;
    if (
      change.field === "laborUnitPrice" &&
      typeof v === "number"
    )
      return formatCLP(v);
    return String(v);
  };
  return (
    <div className="text-[11px] text-gray-600 leading-tight flex flex-wrap items-baseline gap-x-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 min-w-[7rem]">
        {FIELD_LABEL[change.field]}
      </span>
      <span className="line-through text-red-600">{fmt(change.oldValue)}</span>
      <span className="text-gray-400">→</span>
      <span className="text-green-700 font-medium">{fmt(change.newValue)}</span>
    </div>
  );
}

function chapterLabel(chapter: string): string {
  const c = OBRA_CHAPTERS[chapter as ObraChapter];
  return c ? `${c.index} ${c.label}` : chapter;
}
