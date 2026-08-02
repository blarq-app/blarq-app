"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import { derivePaymentRespaldo } from "@/lib/banco/movementDisplay";

// Un pago del movimiento, con la factura a la que está imputado. Es el mismo
// shape que ya viaja en MovementRow.payments — este componente NO pide datos
// nuevos al servidor salvo el nombre de la obra.
export type PaymentDetail = {
  id: string;
  amountApplied: number;
  invoice: {
    id: string;
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
    origin: string | null;
    // Obra a la que está imputada la factura. null = sin centro de costo.
    projectName: string | null;
    projectNumero: number | null;
  };
};

// Desplegable con TODAS las facturas conciliadas a un movimiento.
//
// Contexto (pedido MJ, ago 2026): cuando un movimiento se reparte entre varias
// facturas —el caso real es un reembolso de tarjeta repartido en 25— la columna
// Respaldo mostraba SOLO la primera con link y las otras 24 como un texto muerto
// ("25 pagos · $1.523.415") que no se podía abrir. Los datos ya estaban todos en
// la fila; lo único que faltaba era poder verlos.
//
// Se eligió popover y no acordeón inline: la columna Respaldo mide 288px y ahí
// no entra folio + obra + monto sin que cada línea se parta en tres. El popover
// se dibuja con portal a <body> para que no lo recorte el `overflow-x-auto` de
// la tabla (mismo patrón que MovementResolveMenu).
export default function PaymentsDetailPopover({
  payments,
  sumApplied,
}: {
  payments: PaymentDetail[];
  sumApplied: number;
}) {
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

  // El orden en que Prisma devuelve los pagos no está definido (no hay orderBy
  // sobre la relación), así que Postgres lo decide y puede cambiar entre
  // consultas. Ordenamos acá: primero por obra —así se lee de una cuánto se
  // fue a cada una— y dentro de cada obra por folio.
  const ordenados = [...payments].sort((a, b) => {
    const oa = a.invoice.projectName ?? "￿"; // sin obra, al final
    const ob = b.invoice.projectName ?? "￿";
    if (oa !== ob) return oa.localeCompare(ob, "es");
    return (a.invoice.folioNumber ?? "").localeCompare(
      b.invoice.folioNumber ?? "",
      "es",
      { numeric: true }
    );
  });

  // Posicionar anclado al botón, con position:fixed. Igual que el menú
  // "Resolver": abriendo hacia arriba se ancla el borde INFERIOR (`bottom`),
  // nunca un alto estimado, para que quede pegado mida lo que mida.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const ANCHO = 380;
    const MARGEN = 12;
    // Alto estimado: solo decide hacia qué lado abre, no dónde queda.
    const estH = Math.min(360, 60 + payments.length * 34);

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
  }, [open, payments.length]);

  // Cerrar al click afuera / Escape / scroll / resize.
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
    // Al scrollear la página el popover queda descolgado del botón, así que se
    // cierra. PERO el listener va en fase de captura para pescar el scroll de
    // cualquier contenedor, y eso incluye la propia lista: sin esta guarda,
    // scrollear para ver la factura 25 cerraba el desplegable en el acto.
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        // El subrayado punteado está SIEMPRE, no solo en hover: antes esto era
        // un texto muerto, así que hay que ver de entrada que se puede abrir.
        className="block text-[10px] text-gray-500 tabular-nums underline decoration-dotted decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
      >
        {payments.length} pagos · {formatCLP(sumApplied)}
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
            aria-label="Facturas de este movimiento"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: 380,
              maxHeight: pos.maxHeight,
            }}
            className="z-[60] bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-gray-100 flex items-baseline justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Facturas de este movimiento
              </p>
              {/* El conteo va también acá: la lista scrollea y el botón que la
                  abrió queda tapado, así que si no, se pierde cuántas son. */}
              <p className="text-[11px] text-gray-900 tabular-nums font-medium whitespace-nowrap">
                {payments.length} · {formatCLP(sumApplied)}
              </p>
            </div>

            {/* min-h-0 para que el scroll funcione dentro del flex column. */}
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100">
              {ordenados.map((p) => {
                // Mismo criterio que la etiqueta de la columna: el folio
                // fantasma SR- de un pago sin respaldo no se muestra.
                const resp = derivePaymentRespaldo(
                  [p.invoice.origin],
                  p.invoice.folioNumber
                );
                const obra = p.invoice.projectName
                  ? p.invoice.projectNumero
                    ? `#${p.invoice.projectNumero} ${p.invoice.projectName}`
                    : p.invoice.projectName
                  : null;
                const contenido = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-gray-900 truncate">
                        {resp.label}
                      </span>
                      <span className="block text-[10px] text-gray-500 truncate">
                        {obra ?? "Sin obra"}
                        {p.invoice.businessName && (
                          <span className="text-gray-400">
                            {" · "}
                            {p.invoice.businessName}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-[11px] text-gray-900 tabular-nums whitespace-nowrap">
                      {formatCLP(p.amountApplied)}
                    </span>
                  </>
                );
                return resp.linkeable ? (
                  <Link
                    key={p.id}
                    href={`/facturas?invoiceId=${p.invoice.id}`}
                    className="flex items-start gap-3 px-3 py-1.5 hover:bg-gray-50"
                  >
                    {contenido}
                  </Link>
                ) : (
                  // Boleta / internacional: no tienen ficha propia que abrir.
                  <div key={p.id} className="flex items-start gap-3 px-3 py-1.5">
                    {contenido}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
