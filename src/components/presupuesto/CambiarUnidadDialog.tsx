"use client";

// Ventana que confirma el cambio de unidad de una partida de obra (pendiente 156).
//
// Pide primero la cuenta al servidor SIN escribir (simular) y muestra los
// números de verdad antes de que MJ confirme. Tres casos:
//   - "convierte": pasar a GL con cantidad. Tabla "hoy por cada m²" al lado de
//     "en GL, toda la partida", con el total igual. Es el diseño que MJ eligió
//     viendo la maqueta (opción A, versión con plata y unidades).
//   - "sin-multiplicar": pasar a GL con la cantidad en 0. Queda en 1 GL y el
//     desglose como está; el total pasa de $0 a lo que sume.
//   - "rotulo": solo cambia el nombre de la unidad (M2 → ML, o volver de GL).
// Si el cambio es solo de nombre en una partida que ya no está enganchada al
// catálogo y sin estados de pago, no hay nada que avisar: se aplica directo.

import { useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";

interface Linea {
  descripcion: string;
  unidad: string;
  cantidadAntes: number;
  cantidadDespues: number;
  montoAntes: number;
  montoDespues: number;
}

interface Resumen {
  unidadAntes: string;
  unidadDespues: string;
  cantidadAntes: number;
  cantidadDespues: number;
  modo: "convierte" | "sin-multiplicar" | "rotulo";
  precioUnitarioAntes: number;
  precioUnitarioDespues: number;
  totalAntes: number;
  totalDespues: number;
  lineas: Linea[];
  tieneDesglose: boolean;
  hayPorcentajes: boolean;
  sueltaDelCatalogo: boolean;
  avisoEP: string | null;
  bloqueo: string | null;
}

// La partida fresca que devuelve el servidor después de guardar.
export interface PartidaActualizada {
  id: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  costMaterial: number | null;
  costLabor: number | null;
  costTools: number | null;
  costSubcontract: number | null;
  costLoss: number | null;
  costMargin: number | null;
  catalogPartidaId: string | null;
  // Mismo desglose que devuelve el GET de la partida (con el tilde de provisión).
  components: unknown[];
}

// Cantidades a la chilena: 2,7 · 33,6 · 0,054 (sin ceros de más).
function cant(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 4 });
}

export default function CambiarUnidadDialog({
  budgetId,
  itemId,
  itemName,
  unidadNueva,
  onClose,
  onDone,
}: {
  budgetId: string;
  itemId: string;
  itemName: string;
  unidadNueva: string;
  onClose: () => void;
  onDone: (item: PartidaActualizada) => void;
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const url = `/api/presupuestos/${budgetId}/partidas/${itemId}/unidad`;

  async function confirmar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: unidadNueva }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.item) throw new Error(data.error || "No se pudo cambiar la unidad.");
      onDone(data.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la unidad.");
      setGuardando(false);
    }
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit: unidadNueva, simular: true }),
        });
        const data = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(data.error || "No se pudo calcular el cambio.");
        if (data.sinCambios) return onClose();
        const s = data as Resumen;
        // Solo el nombre, sin catálogo ni estados de pago de por medio: nada
        // que confirmar. Salir de GL siempre pregunta: el desglose es de toda
        // la partida y hay que avisar que cambiar la cantidad lo multiplica.
        if (
          s.modo === "rotulo" &&
          s.unidadAntes.trim().toUpperCase() !== "GL" &&
          !s.sueltaDelCatalogo &&
          !s.avisoEP &&
          !s.bloqueo
        ) {
          setResumen(s);
          await confirmar();
          return;
        }
        setResumen(s);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo calcular el cambio.");
      }
    })();
    return () => {
      vivo = false;
    };
    // Se calcula una vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = resumen;
  const aGlobal = unidadNueva === "GL";
  const titulo = aGlobal ? "Pasar a GL" : `Cambiar la unidad a ${unidadNueva}`;
  const ua = s?.unidadAntes ?? "";

  return (
    <Modal open onClose={guardando ? () => {} : onClose} size="md">
      <ModalHeader title={titulo} subtitle={itemName} onClose={guardando ? undefined : onClose} />
      <ModalBody>
        {!s && !error && <p className="text-sm text-gray-500">Calculando…</p>}

        {s?.modo === "convierte" && (
          <div className="space-y-3 text-sm text-gray-800">
            <p>
              Hoy el desglose es <b>por cada {ua}</b> y se multiplica por{" "}
              <b className="tabular-nums">{cant(s.cantidadAntes)}</b>. En GL queda en{" "}
              <b>1</b>, así que cada línea pasa a ser <b>lo de toda la partida</b>. El total no
              cambia.
            </p>
            <table className="w-full text-xs tabular-nums border-collapse">
              <thead>
                <tr className="bg-gray-100 text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-normal px-2 py-1">Línea</th>
                  <th className="text-right font-normal px-2 py-1">Hoy · por cada {ua}</th>
                  <th className="text-right font-normal px-2 py-1">En GL · toda la partida</th>
                </tr>
              </thead>
              <tbody>
                {s.lineas.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-800">{l.descripcion}</td>
                    <td className="px-2 py-1 text-right text-gray-600 whitespace-nowrap">
                      {cant(l.cantidadAntes)} {l.unidad} · {formatCLP(l.montoAntes)}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-900 whitespace-nowrap">
                      {cant(l.cantidadDespues)} {l.unidad} · {formatCLP(l.montoDespues)}
                    </td>
                  </tr>
                ))}
                {s.hayPorcentajes && (
                  <tr className="border-b border-gray-100 text-gray-500">
                    <td className="px-2 py-1">Pérdida, leyes y margen (%)</td>
                    <td className="px-2 py-1 text-right">igual</td>
                    <td className="px-2 py-1 text-right">igual</td>
                  </tr>
                )}
                <tr className="font-semibold text-gray-900">
                  <td className="px-2 py-1.5">Partida</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {cant(s.cantidadAntes)} {ua} × {formatCLP(s.precioUnitarioAntes)} ={" "}
                    {formatCLP(s.precioUnitarioAntes * s.cantidadAntes)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    1 GL × {formatCLP(s.precioUnitarioDespues)} = {formatCLP(s.totalDespues)}
                  </td>
                </tr>
              </tbody>
            </table>
            {!s.tieneDesglose && (
              <p className="text-xs text-gray-500">
                La partida no tiene desglose: el precio unitario pasa de{" "}
                {formatCLP(s.precioUnitarioAntes)} a {formatCLP(s.precioUnitarioDespues)}.
              </p>
            )}
            <p className="text-xs text-gray-500">
              Después puedes dejar cada línea con sus metros, o ponerla en GL con el total.
            </p>
          </div>
        )}

        {s?.modo === "sin-multiplicar" && (
          <div className="space-y-2 text-sm text-gray-800">
            <p>
              La cantidad está en 0, así que no hay nada que multiplicar. La partida queda en{" "}
              <b>1 GL</b> y el desglose queda como está, por 1 {ua}.
            </p>
            <p>
              Pon en cada línea cuántos {ua} son. Por ahora el total pasa de $0 a{" "}
              <b className="tabular-nums">{formatCLP(s.totalDespues)}</b>.
            </p>
          </div>
        )}

        {s?.modo === "rotulo" && (
          <div className="space-y-2 text-sm text-gray-800">
            <p>
              Solo cambia el nombre de la unidad: queda{" "}
              <b className="tabular-nums">
                {cant(s.cantidadDespues)} {s.unidadDespues}
              </b>{" "}
              con el mismo desglose y el mismo total (
              <span className="tabular-nums">{formatCLP(s.totalAntes)}</span>).
            </p>
            {ua.trim().toUpperCase() === "GL" && (
              <p className="text-xs text-gray-500">
                Si después cambias la cantidad, el total se multiplica por esa cantidad.
              </p>
            )}
          </div>
        )}

        {s?.sueltaDelCatalogo && (
          <p className="text-xs text-gray-500">
            Queda solo de este presupuesto: el catálogo no se toca y los botones &quot;↑ a
            catálogo&quot; dejan de aparecer en esta partida.
          </p>
        )}
        {s?.avisoEP && <p className="text-xs text-amber-700">{s.avisoEP}</p>}
        {s?.bloqueo && <p className="text-sm text-red-700">{s.bloqueo}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={guardando}
          className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={!s || !!s.bloqueo || guardando}
          className="bg-gray-900 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {guardando ? "Guardando…" : aGlobal ? "Pasar a GL" : `Cambiar a ${unidadNueva}`}
        </button>
      </ModalFooter>
    </Modal>
  );
}
