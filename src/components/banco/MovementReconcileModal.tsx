"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCLP } from "@/lib/utils";

type Factura = {
  id: string;
  type: string;
  tipoDoc: number | null;
  folioNumber: string | null;
  businessName: string | null;
  // RUTs del emisor/receptor — necesarios para proponer "recordar pagador"
  // (el RUT del proveedor que emite es lo que se guarda como alias).
  rutIssuer: string | null;
  rutReceiver: string | null;
  totalAmount: number;
  paid: number;
  remaining: number;
  status: string;
  issueDate: string;
  projectName: string | null;
};

type ExistingPayment = {
  id: string;
  invoiceId: string;
  amountApplied: number;
  invoice: {
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
  };
};

// Modal para asignar pagos a un movimiento bancario.
// Estilo Maxxa: search potente + lista de candidatas + saldo libre visible.
// Permite splits (varias facturas en el mismo flujo).
export default function MovementReconcileModal({
  open,
  onClose,
  movement,
  existingPayments,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  movement: {
    id: string;
    amount: number;
    description: string;
    counterpartyName: string | null;
    counterpartyRut: string | null;
    date: string;
    bankAccountAlias: string;
  };
  existingPayments: ExistingPayment[];
  onSave: (newPayments: { invoiceId: string; amountApplied: number }[]) => Promise<void>;
}) {
  const absAmount = Math.abs(movement.amount);
  const [q, setQ] = useState("");
  const [filterSameClient, setFilterSameClient] = useState(true);
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  // Filtro nuevo: monto exacto con tolerancia ±$10 (cubre redondeos IVA).
  // String para que el input vacío sea "no filtrar".
  const [montoExacto, setMontoExacto] = useState<string>("");
  const [filterProjectId, setFilterProjectId] = useState<string>("");
  const [projects, setProjects] = useState<
    { id: string; name: string; numeroProyecto: number | null; isInternal: boolean }[]
  >([]);
  // Reembolsadores: cuando la glosa del mov matchea con uno, el modal
  // apaga "mismo proveedor" automáticamente y prioriza facturas con monto
  // match. Se carga una vez al abrir.
  const [reembolsadores, setReembolsadores] = useState<
    {
      id: string;
      nombre: string;
      glosa: string;
      // Legacy single-alias (todavia viene del backend; lo dejamos para
      // que codigo otro no se rompa, pero la fuente de verdad es `aliases`).
      rutAlias?: string | null;
      businessName?: string | null;
      // Multi-alias: cada empresa que puede emitir facturas asociadas a
      // este reembolsador (caso Cristobal → Paula Johanna + Sodimac).
      aliases?: { id: string; rut: string; businessName: string | null }[];
    }[]
  >([]);
  const [results, setResults] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Estado de "recordar pagador frecuente" (Idea A): cuando el modal
  // detecta drafts asignados a un mov sin reembolsador conocido, ofrece
  // crear/extender la regla. Estado por sesion del modal — al cerrarse,
  // se resetea.
  const [learnDismissed, setLearnDismissed] = useState(false);
  const [learnBusy, setLearnBusy] = useState(false);
  const [learnDone, setLearnDone] = useState<string | null>(null); // mensaje exito

  // Detección de reembolsador a partir de la glosa del mov (substring
  // case-insensitive). Si matchea, devuelve el reembolsador; si no, null.
  const detectedReembolsador = (() => {
    const desc = (movement.description ?? "").toLowerCase();
    return reembolsadores.find((r) => desc.includes(r.glosa.toLowerCase())) ?? null;
  })();

  // Working copy de imputaciones: empieza con las que ya están y MJ agrega.
  const [drafts, setDrafts] = useState(
    existingPayments.map((p) => ({
      invoiceId: p.invoiceId,
      amountApplied: p.amountApplied,
      // Datos de la factura para mostrar en la lista de drafts (sin re-fetch)
      _displayFolio: p.invoice.folioNumber,
      _displayName: p.invoice.businessName,
      _displayTotal: p.invoice.totalAmount,
      // Drafts pre-existentes (existingPayments) no tienen rutIssuer
      // — el endpoint que los provee no lo serializa. Queda en null y
      // la propuesta "recordar pagador" se omite si no hay rutIssuer.
      _rutIssuer: null as string | null,
    }))
  );

  // Reset drafts cuando cambia el movimiento o se abre el modal.
  // Si la glosa matchea con un reembolsador, "mismo proveedor" se apaga
  // por default — la factura no es del que aparece en la transferencia.
  useEffect(() => {
    if (open) {
      setDrafts(
        existingPayments.map((p) => ({
          invoiceId: p.invoiceId,
          amountApplied: p.amountApplied,
          _displayFolio: p.invoice.folioNumber,
          _displayName: p.invoice.businessName,
          _displayTotal: p.invoice.totalAmount,
          _rutIssuer: null as string | null,
        }))
      );
      setQ("");
      const desc = (movement.description ?? "").toLowerCase();
      const isReembolso = reembolsadores.some((r) =>
        desc.includes(r.glosa.toLowerCase())
      );
      setFilterSameClient(!!movement.counterpartyRut && !isReembolso);
      setFilterProjectId("");
      setMontoExacto("");
      setError(null);
      setLearnDismissed(false);
      setLearnDone(null);
      setLearnBusy(false);
    }
  }, [open, existingPayments, movement.counterpartyRut, movement.description, reembolsadores]);

  // Cargar listado de proyectos la primera vez que se abre.
  useEffect(() => {
    if (!open || projects.length > 0) return;
    fetch("/api/proyectos")
      .then((r) => r.json())
      .then((data) => {
        if (data?.projects) setProjects(data.projects);
      })
      .catch(() => {});
  }, [open, projects.length]);

  // Cargar reembolsadores la primera vez que se abre.
  useEffect(() => {
    if (!open || reembolsadores.length > 0) return;
    fetch("/api/reembolsadores")
      .then((r) => r.json())
      .then((data) => {
        if (data?.reembolsadores) setReembolsadores(data.reembolsadores);
      })
      .catch(() => {});
  }, [open, reembolsadores.length]);

  const sumApplied = drafts.reduce((s, d) => s + d.amountApplied, 0);
  const remaining = Math.max(0, absAmount - sumApplied);

  const isCargo = movement.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";

  // ─── Idea A: "Recordar pagador frecuente" ──────────────────────────────
  // Si MJ asigna facturas a un mov que NO tiene reembolsador detectado,
  // proponemos crear o extender la regla (mov ↔ proveedor).
  const learnSuggestion = (() => {
    if (detectedReembolsador) return null; // ya hay regla
    if (learnDismissed || learnDone) return null;
    if (drafts.length === 0) return null;

    // Tomamos el primer draft con rutIssuer poblado (facturas recibidas
    // tienen rutIssuer = el proveedor; emitidas tienen rutReceiver = el
    // cliente — para reembolsadores nos interesa el proveedor, asi que
    // priorizamos recibidas).
    const firstDraft = drafts.find((d) => d._rutIssuer);
    if (!firstDraft) return null;

    // Glosa propuesta: contraparte del mov (más limpia) o description.
    const raw = (movement.counterpartyName ?? movement.description ?? "").trim();
    if (!raw) return null;

    // Nombre propuesto: primera palabra capitalizada de la glosa.
    const firstWord = raw.split(/\s+/)[0] ?? "Pagador";
    const nombre =
      firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();

    return {
      glosa: raw.toLowerCase(),
      glosaDisplay: raw,
      aliasRut: firstDraft._rutIssuer!,
      aliasBusinessName: firstDraft._displayName ?? null,
      nombrePropuesto: nombre,
    };
  })();

  async function handleLearn() {
    if (!learnSuggestion) return;
    setLearnBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reembolsadores/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          glosa: learnSuggestion.glosa,
          nombre: learnSuggestion.nombrePropuesto,
          alias: {
            rut: learnSuggestion.aliasRut,
            businessName: learnSuggestion.aliasBusinessName,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la regla");
        return;
      }
      const name = data.reembolsador?.nombre ?? learnSuggestion.nombrePropuesto;
      const empresa =
        learnSuggestion.aliasBusinessName ?? learnSuggestion.aliasRut;
      setLearnDone(
        data.created
          ? `Pagador "${name}" guardado → ${empresa}`
          : data.aliasAdded
            ? `Agregado a "${name}": ${empresa}`
            : `Ya estaba guardado`
      );
      // Refrescar la lista en memoria asi futuros movs ya tienen la regla
      // sin recargar pagina.
      try {
        const r2 = await fetch("/api/reembolsadores");
        const d2 = await r2.json();
        if (d2?.reembolsadores) setReembolsadores(d2.reembolsadores);
      } catch {
        // no-op: el refresh es nice-to-have, no critico
      }
    } finally {
      setLearnBusy(false);
    }
  }

  // ─── Idea B: sugerir match por monto exacto sin alias ──────────────────
  // Cuando NO hay reembolsador detectado y NO hay drafts aun, miramos
  // los candidatos con saldo ±$10 del mov. La logica de sugerencia:
  //   - 1 candidata        → sugerirla.
  //   - N candidatas, todas del mismo proveedor (mismo rutIssuer/rutReceiver
  //     segun el lado) → sugerir la MAS VIEJA por fecha (FIFO contable —
  //     no importa cual asignamos, son todas del mismo proveedor con el
  //     mismo monto).
  //   - N candidatas, distintos proveedores → no sugerir (MJ decide).
  const exactMatchSuggestion = (() => {
    if (drafts.length > 0) return null;
    if (detectedReembolsador) return null; // ya hay otro banner
    const draftIds = new Set(drafts.map((d) => d.invoiceId));
    const matches = results.filter(
      (f) => !draftIds.has(f.id) && Math.abs(f.remaining - absAmount) <= 10
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // Multi-match: solo sugerimos si todas son del mismo proveedor/cliente.
    // El campo a comparar depende del lado del movimiento (cargo → rutIssuer
    // del proveedor; abono → rutReceiver del cliente).
    const partyField: "rutIssuer" | "rutReceiver" =
      targetType === "emitida" ? "rutReceiver" : "rutIssuer";
    const distinctRuts = new Set(
      matches
        .map((f) => (f[partyField] ?? "").replace(/\D/g, "").slice(-8))
        .filter((r) => r.length > 0)
    );
    if (distinctRuts.size !== 1) return null;
    // Todas mismo proveedor → la mas vieja por issueDate.
    const sorted = [...matches].sort(
      (a, b) =>
        new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()
    );
    return sorted[0];
  })();

  // Si hay N matches del mismo proveedor, queremos avisarle a MJ que hay
  // otras del mismo monto/proveedor disponibles (no asumir que esta es la
  // unica) — para que pueda elegir otra si esta no calza.
  const exactMatchSiblings = (() => {
    if (!exactMatchSuggestion) return 0;
    if (drafts.length > 0) return 0;
    const draftIds = new Set(drafts.map((d) => d.invoiceId));
    const matches = results.filter(
      (f) => !draftIds.has(f.id) && Math.abs(f.remaining - absAmount) <= 10
    );
    return Math.max(0, matches.length - 1);
  })();

  const search = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("type", targetType);
      // Si el Reembolsador detectado tiene aliases (uno o varios), mandamos
      // la lista al endpoint para que busque facturas de cualquiera de esos
      // RUTs (caso "Cristobal" → Paula Johanna O Sodimac). Si no hay aliases
      // y "Mismo proveedor" está marcado, usamos el RUT contraparte normal.
      const aliasRuts = (detectedReembolsador?.aliases ?? [])
        .map((a) => a.rut)
        .filter((r) => r && r.trim().length > 0);
      // Fallback: si el backend nuevo aun no devolvio `aliases` (cache o
      // build viejo), caemos al rutAlias legacy.
      if (aliasRuts.length === 0 && detectedReembolsador?.rutAlias) {
        aliasRuts.push(detectedReembolsador.rutAlias);
      }
      if (aliasRuts.length > 0) {
        params.set("counterpartyRuts", aliasRuts.join(","));
      } else if (filterSameClient && movement.counterpartyRut) {
        params.set("counterpartyRut", movement.counterpartyRut);
      }
      if (filterProjectId) params.set("projectId", filterProjectId);
      params.set("onlyWithBalance", onlyWithBalance ? "1" : "0");
      if (absAmount) params.set("amount", String(absAmount));
      const res = await fetch(`/api/facturas/search?${params.toString()}`);
      if (!res.ok) {
        setError("Error en búsqueda");
        return;
      }
      const data = await res.json();
      // Excluir las que ya están en drafts.
      const draftIds = new Set(drafts.map((d) => d.invoiceId));
      // Filtro adicional: monto exacto ±$10 (cubre redondeos IVA).
      const montoFiltroNum = montoExacto
        ? Number(String(montoExacto).replace(/[.\s]/g, "").replace(",", "."))
        : null;
      // Ordenar candidatos:
      //   1) SIEMPRE primero las que matchean el monto del mov ±$10 — es
      //      la señal más fuerte de "esta factura es la del pago", haya o
      //      no reembolsador detectado. Antes esto solo aplicaba cuando
      //      había reembolsador y las facturas match se perdían en medio
      //      de la lista.
      //   2) Después por proximidad de fecha (lo más cercano al mov).
      const movTime = new Date(movement.date).getTime();
      const matchesAmount = (f: Factura) =>
        Math.abs(f.remaining - absAmount) <= 10;
      const filtered = (data.facturas as Factura[])
        .filter((f) => !draftIds.has(f.id))
        .filter((f) =>
          montoFiltroNum != null && !isNaN(montoFiltroNum)
            ? Math.abs(f.remaining - montoFiltroNum) <= 10 ||
              Math.abs(f.totalAmount - montoFiltroNum) <= 10
            : true
        )
        .sort((a, b) => {
          const ma = matchesAmount(a) ? 0 : 1;
          const mb = matchesAmount(b) ? 0 : 1;
          if (ma !== mb) return ma - mb;
          const da = Math.abs(new Date(a.issueDate).getTime() - movTime);
          const db = Math.abs(new Date(b.issueDate).getTime() - movTime);
          return da - db;
        });
      setResults(filtered);
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, [open, q, targetType, filterSameClient, onlyWithBalance, filterProjectId, absAmount, movement.counterpartyRut, movement.date, drafts, montoExacto, detectedReembolsador]);

  // Buscar al abrir, y cuando cambian filtros (debounced en q).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      search();
    }, 200);
    return () => clearTimeout(t);
  }, [open, q, filterSameClient, onlyWithBalance, filterProjectId, montoExacto, search]);

  // Ventana ±15 días para marcar visualmente facturas "cerca" del movimiento.
  const movTimeRef = new Date(movement.date).getTime();
  const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

  function addDraft(f: Factura) {
    const suggested = Math.min(remaining, f.remaining);
    setDrafts((d) => [
      ...d,
      {
        invoiceId: f.id,
        amountApplied: Math.round(suggested),
        _displayFolio: f.folioNumber,
        _displayName: f.businessName,
        _displayTotal: f.totalAmount,
        // Guardamos rutIssuer en el draft para que la propuesta de
        // "recordar pagador" tenga el RUT al alcance sin volver a la BD.
        _rutIssuer: f.rutIssuer,
      },
    ]);
  }

  function removeDraft(invoiceId: string) {
    setDrafts((d) => d.filter((x) => x.invoiceId !== invoiceId));
  }

  function setDraftAmount(invoiceId: string, amount: number) {
    setDrafts((d) =>
      d.map((x) => (x.invoiceId === invoiceId ? { ...x, amountApplied: amount } : x))
    );
  }

  async function commit() {
    if (sumApplied > absAmount + 1) {
      setError(`Suma (${formatCLP(sumApplied)}) excede el monto del movimiento (${formatCLP(absAmount)})`);
      return;
    }
    if (drafts.some((d) => d.amountApplied <= 0)) {
      setError("Cada monto imputado debe ser positivo");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(
        drafts.map((d) => ({ invoiceId: d.invoiceId, amountApplied: d.amountApplied }))
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Asignar pagos</h2>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="text-xs text-gray-500">
                {new Date(movement.date).toLocaleDateString("es-CL", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {movement.bankAccountAlias}
              </span>
              <span
                className={`text-lg font-semibold tabular-nums ${
                  isCargo ? "text-rose-700" : "text-emerald-700"
                }`}
              >
                {formatCLP(movement.amount)}
              </span>
              <span className="text-xs text-gray-700 truncate">
                {movement.description}
                {movement.counterpartyName && (
                  <span className="text-gray-400 ml-1">· {movement.counterpartyName}</span>
                )}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Body: search + results + drafts */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Drafts (imputaciones pendientes de guardar) */}
          {drafts.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
                Imputaciones para este movimiento
              </p>
              <div className="space-y-1.5">
                {drafts.map((d) => (
                  <div
                    key={d.invoiceId}
                    className="flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1.5 text-xs"
                  >
                    <span className="text-gray-400">✓</span>
                    <span className="text-gray-700 flex-1 truncate">
                      F-{d._displayFolio} · {d._displayName?.slice(0, 40) ?? "—"}
                      <span className="text-gray-400 ml-1">
                        (total {formatCLP(d._displayTotal)})
                      </span>
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={d.amountApplied}
                      onChange={(e) =>
                        setDraftAmount(
                          d.invoiceId,
                          Number(e.target.value.replace(/\D/g, "")) || 0
                        )
                      }
                      className="w-28 px-2 py-0.5 border border-gray-300 rounded tabular-nums text-right"
                    />
                    <button
                      onClick={() => removeDraft(d.invoiceId)}
                      className="text-gray-400 hover:text-rose-600 px-1"
                      aria-label="Quitar"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2 px-1 tabular-nums">
                Imputado: {formatCLP(sumApplied)} de {formatCLP(absAmount)} ·{" "}
                <span className={remaining > 0 ? "text-amber-700 font-medium" : "text-emerald-700"}>
                  {remaining > 0 ? `Saldo libre ${formatCLP(remaining)}` : "Totalmente imputado ✓"}
                </span>
              </p>
            </div>
          )}

          {/* Banner reembolsador / alias de proveedor */}
          {remaining > 0 && detectedReembolsador && (() => {
            // Aliases efectivos: la lista nueva si esta poblada, sino el
            // legacy rutAlias como fallback.
            const aliases = detectedReembolsador.aliases ?? [];
            const hasAliases = aliases.length > 0;
            const legacyAlias = detectedReembolsador.rutAlias
              ? [
                  {
                    rut: detectedReembolsador.rutAlias,
                    businessName: detectedReembolsador.businessName ?? null,
                  },
                ]
              : [];
            const list = hasAliases ? aliases : legacyAlias;
            return (
              <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2 text-xs leading-relaxed">
                {list.length > 0 ? (
                  <>
                    Movimiento detectado para{" "}
                    <span className="font-medium">
                      {detectedReembolsador.nombre}
                    </span>
                    . Se están buscando facturas de{" "}
                    <span className="font-medium">
                      {list
                        .map((a) => a.businessName ?? a.rut)
                        .join(" o ")}
                    </span>
                    {list.length === 1 ? ` (RUT ${list[0].rut})` : ""}.
                  </>
                ) : (
                  <>
                    <span className="font-medium">
                      {detectedReembolsador.nombre}
                    </span>{" "}
                    es reembolsador. La factura puede ser de cualquier
                    proveedor (compra que él pagó con su tarjeta). El filtro
                    &quot;Mismo proveedor&quot; se apagó automáticamente y las
                    facturas con monto exacto match aparecen primero.
                  </>
                )}
              </div>
            );
          })()}

          {/* Idea A: "Recordar pagador frecuente" — solo cuando NO hay
              reembolsador detectado y MJ ya tiene al menos 1 draft con
              rutIssuer poblado. Aparece debajo del banner azul (que en
              este caso no se muestra). */}
          {remaining > 0 && learnSuggestion && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2.5 text-xs leading-relaxed">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 mt-0.5">💡</span>
                <div className="flex-1 space-y-2">
                  <p>
                    ¿Querés recordar este pagador? La próxima vez que llegue un
                    movimiento que diga{" "}
                    <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300 text-[11px]">
                      {learnSuggestion.glosaDisplay}
                    </span>{" "}
                    voy a mostrarte primero las facturas de{" "}
                    <span className="font-medium">
                      {learnSuggestion.aliasBusinessName ??
                        learnSuggestion.aliasRut}
                    </span>
                    .
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLearn}
                      disabled={learnBusy}
                      className="px-3 py-1 bg-amber-900 text-white text-xs rounded hover:bg-amber-800 disabled:opacity-50"
                    >
                      {learnBusy ? "Guardando…" : "Sí, recordar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLearnDismissed(true)}
                      disabled={learnBusy}
                      className="px-3 py-1 text-xs text-amber-800 hover:text-amber-950 disabled:opacity-50"
                    >
                      No, fue puntual
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {learnDone && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-3 py-2 text-xs">
              ✓ {learnDone}
            </div>
          )}

          {/* Idea B: sugerencia de match por monto exacto (sin alias) —
              cuando hay UNA SOLA factura sin pagar con saldo ±$10 del
              mov, ofrecemos un atajo para imputarla con un click. */}
          {remaining > 0 && exactMatchSuggestion && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-3 py-2.5 text-xs leading-relaxed">
              <div className="flex items-start gap-2">
                <span className="text-emerald-600 mt-0.5">✓</span>
                <div className="flex-1">
                  <p>
                    Match por monto exacto:{" "}
                    <span className="font-medium">
                      F-{exactMatchSuggestion.folioNumber} ·{" "}
                      {exactMatchSuggestion.businessName ?? "—"}
                    </span>{" "}
                    tiene saldo {formatCLP(exactMatchSuggestion.remaining)}, que
                    coincide con este movimiento.
                  </p>
                  {exactMatchSiblings > 0 && (
                    <p className="mt-1 text-[11px] text-emerald-700">
                      Hay {exactMatchSiblings}{" "}
                      {exactMatchSiblings === 1 ? "otra factura" : "otras facturas"}{" "}
                      del mismo proveedor con el mismo saldo. Ésta es la más
                      antigua sin pagar. Si querés otra, cancelá y elegí en la lista.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => addDraft(exactMatchSuggestion)}
                  className="px-3 py-1 bg-emerald-900 text-white text-xs rounded hover:bg-emerald-800 whitespace-nowrap"
                >
                  Agregar
                </button>
              </div>
            </div>
          )}

          {/* Search — fila 1: búsqueda libre + filtros tipo toggle.
              Fila 2: filtro de monto exacto separado, con label visible y
              atajo para autocompletar con el monto del movimiento. */}
          {remaining > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Buscar folio, nombre, RUT o monto…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="flex-1 min-w-[240px] px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                />
                <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterSameClient}
                    onChange={(e) => setFilterSameClient(e.target.checked)}
                    disabled={!movement.counterpartyRut}
                  />
                  Mismo {targetType === "emitida" ? "cliente" : "proveedor"}
                </label>
                <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyWithBalance}
                    onChange={(e) => setOnlyWithBalance(e.target.checked)}
                  />
                  Solo con saldo
                </label>
                <select
                  value={filterProjectId}
                  onChange={(e) => setFilterProjectId(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-700 bg-white max-w-[180px] truncate"
                  title="Filtrar por proyecto"
                >
                  <option value="">Cualquier proyecto</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.numeroProyecto ? `${p.numeroProyecto} · ` : ""}
                      {p.name}
                      {p.isInternal ? " (interno)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label
                  htmlFor="mov-monto-exacto"
                  className="text-xs text-gray-700 font-medium"
                >
                  Monto exacto (±$10):
                </label>
                <input
                  id="mov-monto-exacto"
                  type="text"
                  inputMode="numeric"
                  placeholder="Ej. 357000"
                  value={montoExacto}
                  onChange={(e) => setMontoExacto(e.target.value)}
                  className="w-40 px-3 py-1.5 border border-gray-300 rounded text-sm tabular-nums focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setMontoExacto(String(Math.round(absAmount)))}
                  className="text-[11px] text-gray-600 hover:text-gray-900 underline"
                  title="Llenar con el monto exacto del movimiento"
                >
                  usar monto del mov ({formatCLP(absAmount)})
                </button>
                {montoExacto && (
                  <button
                    type="button"
                    onClick={() => setMontoExacto("")}
                    className="text-[11px] text-gray-400 hover:text-rose-700"
                  >
                    limpiar
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          {remaining > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {loading ? (
                <div className="p-4 text-center text-xs text-gray-500">Buscando…</div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500">
                  Sin resultados. Probá ajustar los filtros.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">Folio</th>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Cliente / Proveedor</th>
                      <th className="text-left px-3 py-2">Proyecto</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-right px-3 py-2">Saldo</th>
                      <th className="px-3 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((f) => {
                      // Match de monto con tolerancia ±$10 (cubre redondeos
                      // IVA). Cuando matchea, la fila se sombrea en verde
                      // para que salte a la vista — antes solo el saldo se
                      // pintaba de verde y se perdia en la lista.
                      const isExact = Math.abs(f.remaining - remaining) <= 10;
                      const isLessThanRemaining = f.remaining < remaining;
                      const fTime = new Date(f.issueDate).getTime();
                      const isNear = Math.abs(fTime - movTimeRef) <= FIFTEEN_DAYS_MS;
                      // dd/mm/aa
                      const d = new Date(f.issueDate);
                      const fechaFmt = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`;
                      return (
                        <tr
                          key={f.id}
                          className={
                            isExact
                              ? "bg-emerald-50 hover:bg-emerald-100"
                              : "hover:bg-gray-50"
                          }
                        >
                          <td className="px-3 py-2 tabular-nums text-gray-700 whitespace-nowrap">
                            F-{f.folioNumber}
                            {f.tipoDoc === 34 && (
                              <span className="ml-1 text-[9px] uppercase bg-gray-100 text-gray-600 px-1 rounded">
                                EX
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {isNear && (
                                <span
                                  className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400"
                                  title="Fecha dentro de ±15 días del movimiento"
                                />
                              )}
                              {fechaFmt}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700 truncate max-w-[200px]">
                            {f.businessName ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-500 truncate max-w-[160px]">
                            {f.projectName ?? <span className="italic text-gray-300">sin asignar</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {formatCLP(f.totalAmount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={isExact ? "text-emerald-700 font-semibold" : "text-gray-900"}>
                              {formatCLP(f.remaining)}
                            </span>
                            {f.status === "parcial" && (
                              <div className="text-[9px] uppercase text-blue-700">parcial</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => addDraft(f)}
                              className={
                                "text-xs text-white px-2 py-0.5 rounded " +
                                (isExact
                                  ? "bg-emerald-700 hover:bg-emerald-800"
                                  : "bg-gray-900 hover:bg-gray-800")
                              }
                              title={
                                isExact
                                  ? "Monto coincide con el movimiento"
                                  : isLessThanRemaining
                                    ? "Aplicar saldo factura"
                                    : "Aplicar saldo libre del mov"
                              }
                            >
                              +
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-500 tabular-nums">
            {drafts.length} imputaci{drafts.length === 1 ? "ón" : "ones"} ·{" "}
            {formatCLP(sumApplied)} / {formatCLP(absAmount)}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
            >
              Cancelar
            </button>
            <button
              onClick={commit}
              disabled={busy}
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Guardar imputaciones"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
