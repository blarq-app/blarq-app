"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";

// El otro lado de una devolución neto cero: el movimiento con el que este se
// cancela. Viaja ya resuelto desde el server (mismo netZeroGroupId).
export type NetZeroPar = {
  id: string;
  date: string; // ISO
  amount: number;
  description: string;
  counterpartyName: string | null;
  bankAccountAlias: string;
  // Cuánto de ESE movimiento quedó neteado. En un sobrepago devuelto, el pago
  // grande solo netea el sobrante: $47.991 de $2.153.598.
  netZeroAmount: number | null;
  // Folio de la factura que tiene pegada, si tiene. Es la pista de por qué ese
  // movimiento no es "todo devolución": una parte pagó algo real.
  facturaFolio: string | null;
};

// Desplegable que muestra CON QUÉ se cancela un movimiento marcado como
// devolución neto cero.
//
// Contexto (MJ, ago 2026, mirando la devolución de Da Ingeniería de $47.991):
// "esta devolución también queda sin rastro". El movimiento quedaba bien
// cerrado, pero la pastilla decía "Devolución" a secas: desde la devolución no
// se podía llegar al pago que cancela, ni desde el pago a su devolución. El
// dato estaba guardado —los dos comparten netZeroGroupId— y no se mostraba.
//
// Funciona en los DOS sentidos a propósito: el texto del disparador y del
// título se arman mirando el SIGNO del otro lado, no el del movimiento actual,
// así que parado en la devolución dice "pago" y parado en el pago dice
// "devolución" sin que haya que decírselo.
//
// Calcado de PaymentsDetailPopover (el de "N pagos · $X"): mismo disparador con
// subrayado punteado, mismo portal a <body> para que no lo recorte el
// `overflow-x-auto` de la tabla, mismo cierre por click afuera / Escape /
// scroll / resize.
export default function NetZeroDetailPopover({ pares }: { pares: NetZeroPar[] }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Ordenados por fecha: se lee como la historia de la plata (salió, volvió).
  const ordenados = [...pares].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const ANCHO = 340;
    const MARGEN = 12;
    const estH = Math.min(320, 60 + pares.length * 46);

    let left = r.left;
    if (left + ANCHO > window.innerWidth - 8) left = window.innerWidth - ANCHO - 8;
    if (left < 8) left = 8;

    const espacioAbajo = window.innerHeight - r.bottom - MARGEN;
    const espacioArriba = r.top - MARGEN;
    const abreArriba = espacioAbajo < estH && espacioArriba > espacioAbajo;

    setPos(
      abreArriba
        ? { bottom: window.innerHeight - r.top + 4, left, maxHeight: espacioArriba }
        : { top: r.bottom + 4, left, maxHeight: espacioAbajo }
    );
  }, [open, pares.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // Igual que en el popover de pagos: el listener va en captura para pescar
    // el scroll de cualquier contenedor, con guarda para no cerrarse cuando el
    // que scrollea es el propio desplegable.
    function onScroll(e: Event) {
      const t = e.target as Node | null;
      if (t && popRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  if (ordenados.length === 0) return null;

  // Formato fijo dd-mm, armado a mano: `toLocaleDateString("es-CL")` ignora el
  // `2-digit` del mes y devuelve "29/7", que al lado de las otras fechas de la
  // tabla se lee desprolijo. Se leen las partes en UTC porque los movimientos
  // se guardan a medianoche UTC — con la hora local, la fecha se corre un día.
  const fechaCorta = (iso: string) => {
    const f = new Date(iso);
    const dd = String(f.getUTCDate()).padStart(2, "0");
    const mm = String(f.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}`;
  };

  // El sustantivo sale del signo del OTRO lado: si de allá salió plata es un
  // pago, si entró es una devolución. Así el mismo componente sirve parado en
  // cualquiera de los dos movimientos.
  const nombreDe = (p: NetZeroPar) => (p.amount < 0 ? "pago" : "devolución");

  const uno = ordenados.length === 1 ? ordenados[0] : null;
  const totalOtroLado = ordenados.reduce(
    (s, p) => s + (p.netZeroAmount ?? Math.abs(p.amount)),
    0
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Subrayado punteado SIEMPRE visible (no solo en hover): es la única
        // señal de que la pastilla "Devolución" ahora lleva a algún lado.
        className="block text-left text-[10px] text-gray-500 tabular-nums underline decoration-dotted decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
      >
        {uno
          ? `${nombreDe(uno)} ${fechaCorta(uno.date)} · ${formatCLP(Math.abs(uno.amount))}`
          : `${ordenados.length} movimientos · ${formatCLP(totalOtroLado)}`}
        <span aria-hidden="true" className="ml-0.5 text-[8px] leading-none">
          ▾
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Con qué se cancela este movimiento"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: 340,
              maxHeight: pos.maxHeight,
            }}
            className="z-[60] bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Se cancela con
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100">
              {ordenados.map((p) => {
                const neteado = p.netZeroAmount ?? Math.abs(p.amount);
                // Neteo parcial: el movimiento es más grande que lo que se
                // canceló porque el resto paga una factura de verdad. Decirlo
                // evita la lectura de que se anuló el pago entero.
                const esParcial = Math.abs(p.amount) - neteado > 1;
                return (
                  <Link
                    key={p.id}
                    href={`/banco/movimientos?id=${p.id}`}
                    className="block px-3 py-2 hover:bg-gray-50"
                  >
                    <span className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] text-gray-900 truncate">
                          {nombreDe(p) === "pago" ? "Pago" : "Devolución"} del{" "}
                          {new Date(p.date).toLocaleDateString("es-CL", {
                            timeZone: "UTC",
                          })}
                        </span>
                        <span className="block text-[10px] text-gray-500 truncate">
                          {p.counterpartyName ?? p.description}
                        </span>
                        {esParcial && (
                          <span className="block text-[10px] text-gray-400">
                            se neteó {formatCLP(neteado)}
                            {p.facturaFolio && ` · el resto paga F-${p.facturaFolio}`}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-gray-900 tabular-nums whitespace-nowrap">
                        {formatCLP(p.amount)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
