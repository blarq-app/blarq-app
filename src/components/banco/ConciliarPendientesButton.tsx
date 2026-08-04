"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCLP } from "@/lib/utils";

// Una propuesta del motor (espejo del Propuesta del endpoint).
interface Propuesta {
  movementId: string;
  movDate: string;
  movAmount: number;
  movDescription: string;
  counterpartyName: string | null;
  bankAccountAlias: string;
  invoiceId: string;
  folioNumber: string | null;
  businessName: string | null;
  invoiceDate: string | null;
  invoiceTotal: number;
  invoiceRemaining: number;
  projectName: string | null;
  confianza: "segura" | "probable";
  motivo: string;
  hermanas: number;
}

interface PreviewResult {
  revisados: number;
  seguras: number;
  probables: number;
  sinPropuesta: number;
  propuestas: Propuesta[];
}

function fmtFecha(iso: string): string {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

// "Conciliar pendientes" — el mismo gesto que conciliar un movimiento suelto,
// pero sobre todos los pendientes de una sentada.
//
// El flujo es PROPONER → TILDAR → CONCILIAR (decisión de MJ, 26-07-2026).
// Antes era al revés: aplicaba todo y después mostraba un panel para deshacer
// uno por uno. Se dio vuelta por dos motivos:
//
//   1. Es la misma regla conservadora del resto de la app: si hay duda, no se
//      ata solo. Nada se escribe hasta que MJ confirma.
//   2. Las candidatas "probables" (el monto calza pero el RUT no) antes se
//      quedaban pendientes EN SILENCIO — MJ nunca se enteraba de que existían.
//      Ahora se muestran rotuladas, con el motivo de la duda, destildadas.
//
// Deshacer no se perdió: sigue en Resolver ▾ → Desasignar, en la fila y en
// lote. Y sigue siendo un click, porque las seguras vienen tildadas.
export default function ConciliarPendientesButton({
  pendientesCount,
}: {
  pendientesCount: number;
}) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [tildadas, setTildadas] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    conciliados: number;
    rechazados: { movementId: string; motivo: string }[];
  } | null>(null);

  async function abrirPropuestas() {
    if (cargando) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const res = await fetch("/api/banco/auto-conciliar-pendientes");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      const p = data as PreviewResult;
      setPreview(p);
      // Las seguras vienen tildadas; las probables no. Ése es todo el default:
      // un click concilia lo que el motor ataría solo, igual que antes.
      setTildadas(
        new Set(
          p.propuestas.filter((x) => x.confianza === "segura").map((x) => x.movementId)
        )
      );
    } catch {
      setError("Error de red");
    } finally {
      setCargando(false);
    }
  }

  function toggle(movementId: string) {
    setTildadas((prev) => {
      const n = new Set(prev);
      if (n.has(movementId)) n.delete(movementId);
      else n.add(movementId);
      return n;
    });
  }

  function toggleTodas(marcar: boolean) {
    if (!preview) return;
    setTildadas(marcar ? new Set(preview.propuestas.map((p) => p.movementId)) : new Set());
  }

  async function conciliar() {
    if (!preview || aplicando) return;
    const pares = preview.propuestas
      .filter((p) => tildadas.has(p.movementId))
      .map((p) => ({ movementId: p.movementId, invoiceId: p.invoiceId }));
    if (pares.length === 0) return;

    setAplicando(true);
    setError(null);
    try {
      const res = await fetch("/api/banco/auto-conciliar-pendientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pares }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo conciliar");
        return;
      }
      setResultado(data);
      setPreview(null);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setAplicando(false);
    }
  }

  function cerrar() {
    setPreview(null);
    setError(null);
  }

  const tildadasCount = tildadas.size;

  return (
    <>
      <div className="flex items-center gap-3">
        {error && !preview && (
          <span className="text-xs text-red-600 whitespace-nowrap">{error}</span>
        )}
        {resultado && resultado.rechazados.length === 0 && (
          <span className="text-xs text-gray-600 whitespace-nowrap">
            {resultado.conciliados} conciliado
            {resultado.conciliados === 1 ? "" : "s"}
          </span>
        )}
        <button
          onClick={abrirPropuestas}
          disabled={cargando || pendientesCount === 0}
          className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            pendientesCount === 0
              ? "No hay movimientos pendientes de conciliar"
              : `Busca facturas con saldo para los ${pendientesCount} movimientos pendientes y te muestra qué ataría antes de guardar nada`
          }
        >
          {cargando ? "Buscando…" : `Conciliar pendientes (${pendientesCount})`}
        </button>
      </div>

      {/* Panel de propuestas: nada se escribió todavía. */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cerrar}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Conciliar pendientes
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Miré <span className="tabular-nums">{preview.revisados}</span>{" "}
                  movimientos pendientes. Encontré factura para{" "}
                  <span className="tabular-nums">{preview.propuestas.length}</span>.
                  Todavía no se guardó nada.
                </p>
              </div>
              <button
                onClick={cerrar}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {preview.propuestas.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Ninguno de los {preview.revisados} pendientes tiene una factura
                con saldo parecido. Puede que todavía no hayan llegado del SII,
                o que sean pagos sin factura.
              </div>
            ) : (
              <>
                <div className="px-6 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => toggleTodas(true)}
                      className="text-xs text-gray-700 hover:text-gray-900 underline"
                    >
                      Tildar todas
                    </button>
                    <button
                      onClick={() => toggleTodas(false)}
                      className="text-xs text-gray-500 hover:text-gray-900 underline"
                    >
                      Destildar todas
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-500">
                    Las seguras vienen tildadas · destildá lo que no quieras
                  </span>
                </div>

                <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
                  {preview.propuestas.map((p) => {
                    const marcada = tildadas.has(p.movementId);
                    const segura = p.confianza === "segura";
                    return (
                      <li
                        key={p.movementId}
                        className={`px-6 py-3 flex items-start gap-3 ${
                          marcada ? "" : "bg-gray-50/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => toggle(p.movementId)}
                          className="mt-0.5 accent-gray-900 w-3.5 h-3.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-900">
                              F-{p.folioNumber} · {p.businessName ?? "—"}
                            </span>
                            <span className="text-xs tabular-nums text-gray-700">
                              {formatCLP(p.invoiceRemaining)}
                            </span>
                            {/* Fecha de emisión de la factura. Va acá arriba, y
                                la del movimiento abajo, para que la propuesta se
                                pueda cruzar por monto Y por fecha — con solo el
                                monto, dos compras parecidas del mismo comercio
                                son indistinguibles. Dice "Emitida" porque si no
                                las dos fechas de la fila se confunden. */}
                            {p.invoiceDate && (
                              <span className="text-[11px] tabular-nums text-gray-500">
                                Emitida {fmtFecha(p.invoiceDate)}
                              </span>
                            )}
                            {p.projectName && (
                              <span className="text-[11px] text-gray-400">
                                {p.projectName}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 tabular-nums truncate mt-0.5">
                            {fmtFecha(p.movDate)} · {formatCLP(p.movAmount)} ·{" "}
                            {p.movDescription}
                          </div>
                          <p
                            className={`text-[11px] mt-1 leading-snug ${
                              segura ? "text-gray-500" : "text-amber-700"
                            }`}
                          >
                            {p.motivo}
                          </p>
                        </div>
                        <span
                          className={
                            "text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 " +
                            (segura
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                              : "bg-amber-50 border-amber-200 text-amber-700")
                          }
                        >
                          {segura ? "Segura" : "Mirala"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {preview.sinPropuesta > 0 && (
                  <p className="px-6 py-2 text-[11px] text-gray-500 border-t border-gray-100">
                    Los otros{" "}
                    <span className="tabular-nums">{preview.sinPropuesta}</span>{" "}
                    quedan pendientes: no hay ninguna factura con saldo parecido.
                  </p>
                )}
              </>
            )}

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-500 tabular-nums">
                {error ? (
                  <span className="text-red-600">{error}</span>
                ) : (
                  `${tildadasCount} tildada${tildadasCount === 1 ? "" : "s"} de ${preview.propuestas.length}`
                )}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={cerrar}
                  disabled={aplicando}
                  className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
                >
                  Cancelar
                </button>
                <button
                  onClick={conciliar}
                  disabled={aplicando || tildadasCount === 0}
                  className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aplicando
                    ? "Conciliando…"
                    : tildadasCount === 0
                      ? "Conciliar"
                      : tildadasCount === 1
                        ? "Conciliar la tildada"
                        : `Conciliar las ${tildadasCount} tildadas`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Si algún par se rechazó al aplicar (la factura cambió mientras tanto,
          otra sesión la concilió, entró un sync del SII), hay que decirlo — no
          se puede tragar en silencio, es plata. */}
      {resultado && resultado.rechazados.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white border border-amber-200 rounded-xl shadow-sm p-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-gray-900">
                {resultado.conciliados} conciliado
                {resultado.conciliados === 1 ? "" : "s"} ·{" "}
                {resultado.rechazados.length} no se pudo
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {resultado.rechazados.map((r) => (
                  <li key={r.movementId} className="text-[11px] text-amber-700">
                    {r.motivo}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setResultado(null)}
              className="text-gray-400 hover:text-gray-700 text-sm leading-none"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
