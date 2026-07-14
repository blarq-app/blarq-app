"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import MovementReconcileModal from "./MovementReconcileModal";
import InvoicePickerModal from "./InvoicePickerModal";
import GastoObraModal from "./GastoObraModal";

// Un movimiento, con lo que el menú necesita para decidir qué acciones ofrecer
// y para abrir los modales (asignar/editar necesita la descripción, fecha, etc.).
export type MenuMovement = {
  id: string;
  amount: number;
  status: string;
  hasPayments: boolean;
  counterpartyRut: string | null;
  counterpartyName: string | null;
  description: string;
  date: string;
  bankAccountAlias: string;
  payments: {
    id: string;
    invoiceId: string;
    amountApplied: number;
    invoice: {
      folioNumber: string | null;
      businessName: string | null;
      totalAmount: number;
    };
  }[];
};

type ItemDef = {
  label: string;
  icon: string; // clase lucide/tabler (glifo textual acá; ver nota abajo)
  onClick: () => void;
  danger?: boolean;
};
type SectionDef = { title: string | null; items: ItemDef[] };

// Menú único "Resolver ▾" para /banco/movimientos. Reemplaza el racimo de
// botones sueltos de la fila (Asignar, Sin factura, ✨, ↔, deshacer) y la
// barra negra de acciones masivas por UN solo gesto, con el MISMO vocabulario
// tanto para un movimiento (mode="row") como para una selección (mode="selection").
//
// El menú es contextual: solo muestra las acciones que aplican a ese/esos
// movimiento(s). Agrupado según el mapa "¿qué es esta plata?":
//   1. Contra factura   2. Sin factura   3. No es plata real   4. Deshacer.
//
// Nada de esto toca plata ni cálculos: son los mismos endpoints de antes,
// reorganizados en un solo lugar.
export default function MovementResolveMenu({
  movements,
  mode,
  projects,
  categories,
  imputacionCategories,
  blarqRutDigits,
  onDone,
}: {
  movements: MenuMovement[];
  mode: "row" | "selection";
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
  imputacionCategories: { value: string; label: string }[];
  blarqRutDigits: string;
  // Se llama tras una acción exitosa en modo selección (para limpiar el tildado).
  onDone?: () => void;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Subvista dentro del menú: la lista de categorías de "sueldo/retiro".
  const [subview, setSubview] = useState<null | "sueldo">(null);
  const [saveRule, setSaveRule] = useState(false);
  const [busy, setBusy] = useState(false);

  // Modales.
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Modal de costo de obra: "pago" (pago a maestro sin factura) o "gasto"
  // (boleta / internacional). null = cerrado.
  const [gastoVariant, setGastoVariant] = useState<null | "pago" | "gasto">(null);

  const single = movements.length === 1 ? movements[0] : null;
  const ids = movements.map((m) => m.id);
  const neto = movements.reduce((s, m) => s + m.amount, 0);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setSubview(null);
    setSaveRule(false);
  }, []);

  // Posicionar el menú con position:fixed anclado al botón. Usamos portal a
  // document.body para que NO lo recorte el overflow-x de la tabla.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const MENU_W = 260;
    const estH = 320;
    // Alinear el borde derecho del menú con el del botón; si no cabe abajo,
    // abrir hacia arriba.
    let left = r.right - MENU_W;
    if (left < 8) left = 8;
    const openUp = r.bottom + estH > window.innerHeight && r.top > estH;
    const top = openUp ? r.top - 4 - estH : r.bottom + 4;
    setPos({ top: Math.max(8, top), left });
  }, [open]);

  // Cerrar al click afuera / escape / scroll / resize.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        menuRef.current?.contains(t) ||
        btnRef.current?.contains(t)
      )
        return;
      closeMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    function onScrollOrResize() {
      closeMenu();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, closeMenu]);

  // ── Handlers ────────────────────────────────────────────────────────────
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "No se pudo completar la acción");
        return false;
      }
      onDone?.();
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "No se pudo completar la acción");
        return false;
      }
      onDone?.();
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function savePayments(
    payments: { invoiceId: string; amountApplied: number }[]
  ) {
    if (!single) return;
    const res = await fetch(`/api/banco/movimientos/${single.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Error al guardar");
    }
    onDone?.();
    router.refresh();
  }

  async function asignarLote(invoiceId: string) {
    const ok = await post({ action: "asignar", movementIds: ids, invoiceId });
    if (ok) setPickerOpen(false);
  }

  async function marcarSinFactura(category: string) {
    if (!single) return;
    const ok = await patch(single.id, { category, saveRule });
    if (ok) closeMenu();
  }

  async function marcarInterna() {
    if (!single) return;
    const ok = await patch(single.id, { markInternal: true });
    if (ok) closeMenu();
  }

  async function deshacerNetoCero() {
    if (!single) return;
    if (
      !confirm(
        '¿Deshacer la devolución neto cero?\n\nLos movimientos del grupo vuelven a "pendiente".'
      )
    )
      return;
    const ok = await patch(single.id, { undoNetZero: true });
    if (ok) closeMenu();
  }

  async function marcarNetoCero() {
    if (
      !confirm(
        `¿Marcar estos ${ids.length} movimientos como devolución (neto cero)?\n\n` +
          `Son plata que entró y volvió (se cancelan entre sí). Salen de ` +
          `"pendiente" y NO cuentan como ingreso ni gasto. Lo podés deshacer ` +
          `después con "deshacer" en cualquiera de los movimientos.`
      )
    )
      return;
    const ok = await post({ action: "neto_cero", movementIds: ids });
    if (ok) closeMenu();
  }

  async function desasignar() {
    const conPagos = movements.filter((m) => m.hasPayments).length;
    if (
      !confirm(
        `¿Quitar las imputaciones de ${conPagos} movimiento${conPagos !== 1 ? "s" : ""}?\n\n` +
          `Los movimientos vuelven a "Pendiente". Las facturas que pierdan ` +
          `el cobro recalculan su estado. No se borra ningún movimiento — ` +
          `solo se deshace la conciliación.`
      )
    )
      return;
    const ok = await post({ action: "desasignar", movementIds: ids });
    if (ok) closeMenu();
  }

  // ── Construcción del menú (contextual) ───────────────────────────────────
  const sections: SectionDef[] = [];

  if (mode === "row" && single) {
    const m = single;
    if (m.status === "neto_cero") {
      sections.push({
        title: null,
        items: [
          {
            label: "Deshacer devolución neto cero",
            icon: "arrow-back",
            onClick: deshacerNetoCero,
          },
        ],
      });
    } else {
      const pending = m.status === "sin_asignar" || m.status === "parcial";
      const egreso = m.amount < 0;
      const isBlarq = (m.counterpartyRut ?? "")
        .replace(/\D/g, "")
        .includes(blarqRutDigits);

      sections.push({
        title: "Contra factura",
        items: [
          {
            label: m.hasPayments ? "Editar imputación…" : "Asignar a factura…",
            icon: "file",
            onClick: () => {
              setReconcileOpen(true);
              closeMenu();
            },
          },
        ],
      });

      // Dos encabezados a propósito: separar "costo de una obra" de "gasto
      // propio" refuerza la distinción contable (un sueldo NO es costo de obra).
      if (pending && egreso) {
        sections.push({
          title: "Costo de una obra, sin factura",
          items: [
            {
              label: "Pago a obra sin factura…",
              icon: "tools",
              onClick: () => {
                setGastoVariant("pago");
                closeMenu();
              },
            },
            {
              label: "Registrar gasto (boleta / internacional)…",
              icon: "receipt",
              onClick: () => {
                setGastoVariant("gasto");
                closeMenu();
              },
            },
          ],
        });
      }
      if (pending) {
        sections.push({
          title: "Gasto propio de BLARQ",
          items: [
            {
              label: "Sueldo, retiro, previred…",
              icon: "user",
              onClick: () => setSubview("sueldo"),
            },
          ],
        });
      }

      if (pending && isBlarq) {
        sections.push({
          title: "No es plata real",
          items: [
            {
              label: "Marcar transferencia interna",
              icon: "swap",
              onClick: marcarInterna,
            },
          ],
        });
      }
    }
  } else {
    // Selección (varios).
    const conPagos = movements.filter((m) => m.hasPayments).length;
    const hasIngreso = movements.some((m) => m.amount > 0);
    const hasEgreso = movements.some((m) => m.amount < 0);
    const egresosSinPago = movements.filter(
      (m) => m.amount < 0 && !m.hasPayments
    ).length;
    const netoCeroElegible =
      movements.length >= 2 &&
      conPagos === 0 &&
      hasIngreso &&
      hasEgreso &&
      Math.abs(neto) <= 10;

    sections.push({
      title: "Contra factura",
      items: [
        {
          label: "Asignar a factura…",
          icon: "file",
          onClick: () => {
            setPickerOpen(true);
            closeMenu();
          },
        },
      ],
    });

    if (egresosSinPago > 0) {
      sections.push({
        title: "Costo de una obra, sin factura",
        items: [
          {
            label: "Pago a obra sin factura…",
            icon: "tools",
            onClick: () => {
              setGastoVariant("pago");
              closeMenu();
            },
          },
          {
            label: "Registrar gasto (boleta / internacional)…",
            icon: "receipt",
            onClick: () => {
              setGastoVariant("gasto");
              closeMenu();
            },
          },
        ],
      });
    }

    if (netoCeroElegible) {
      sections.push({
        title: "No es plata real",
        items: [
          {
            label: "Devolución (neto cero)",
            icon: "swap",
            onClick: marcarNetoCero,
          },
        ],
      });
    }

    if (conPagos > 0) {
      sections.push({
        title: "Deshacer",
        items: [
          {
            label: `Desasignar (${conPagos})`,
            icon: "arrow-back",
            onClick: desasignar,
            danger: true,
          },
        ],
      });
    }
  }

  // Los movimientos internos no tienen acciones acá (se editan en la columna
  // Imputación con los selectores de obra/concepto). No mostramos botón.
  if (mode === "row" && single && single.status === "interno") return null;

  // Etiqueta del disparador según el estado (en la fila) o "Resolver" (selección).
  function triggerLabel(): string {
    if (mode === "selection") return "Resolver";
    const m = single!;
    if (m.status === "neto_cero") return "Deshacer";
    if (m.status === "conciliado") return "Editar";
    if (m.status === "sin_factura") return "Cambiar";
    return "Resolver";
  }

  const pendingRow =
    mode === "row" &&
    single &&
    (single.status === "sin_asignar" || single.status === "parcial");

  const triggerClass =
    mode === "selection"
      ? "inline-flex items-center gap-1 text-xs font-medium bg-white text-gray-900 px-3 py-1 rounded hover:bg-gray-100"
      : pendingRow
        ? "inline-flex items-center gap-1 text-[11px] bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800"
        : "inline-flex items-center gap-1 text-[11px] text-gray-600 border border-gray-300 px-2 py-0.5 rounded hover:bg-gray-50";

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? closeMenu() : setOpen(true))}
        disabled={busy}
        className={triggerClass + " disabled:opacity-50"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? "…" : triggerLabel()}
        <span aria-hidden="true" className="text-[9px] leading-none">▾</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 260 }}
            className="z-[60] bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-sm"
          >
            {subview === "sueldo" ? (
              <SueldoSubmenu
                options={imputacionCategories}
                saveRule={saveRule}
                setSaveRule={setSaveRule}
                busy={busy}
                onPick={marcarSinFactura}
                onBack={() => setSubview(null)}
              />
            ) : (
              sections.map((sec, i) => (
                <div
                  key={i}
                  className={i > 0 ? "border-t border-gray-100 mt-1 pt-1" : ""}
                >
                  {sec.title && (
                    <p className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-gray-400">
                      {sec.title}
                    </p>
                  )}
                  {sec.items.map((it, j) => (
                    <button
                      key={j}
                      role="menuitem"
                      onClick={it.onClick}
                      disabled={busy}
                      className={
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left disabled:opacity-50 " +
                        (it.danger
                          ? "text-rose-700 hover:bg-rose-50"
                          : "text-gray-700 hover:bg-gray-50")
                      }
                    >
                      <MenuGlyph name={it.icon} />
                      <span className="flex-1">{it.label}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>,
          document.body
        )}

      {/* Modales — solo se montan al abrirse */}
      {single && (
        <MovementReconcileModal
          open={reconcileOpen}
          onClose={() => setReconcileOpen(false)}
          movement={{
            id: single.id,
            amount: single.amount,
            description: single.description,
            counterpartyName: single.counterpartyName,
            counterpartyRut: single.counterpartyRut,
            date: single.date,
            bankAccountAlias: single.bankAccountAlias,
          }}
          existingPayments={single.payments.map((p) => ({
            id: p.id,
            invoiceId: p.invoiceId,
            amountApplied: p.amountApplied,
            invoice: {
              folioNumber: p.invoice.folioNumber,
              businessName: p.invoice.businessName,
              totalAmount: p.invoice.totalAmount,
            },
          }))}
          onSave={savePayments}
        />
      )}

      {pickerOpen && (
        <InvoicePickerModal
          movementCount={movements.length}
          totalNeto={neto}
          sharedCounterpartyRut={(() => {
            const ruts = movements
              .map((m) => (m.counterpartyRut ?? "").replace(/\D/g, ""))
              .filter((r) => r.length > 0);
            if (ruts.length === 0) return null;
            return new Set(ruts).size === 1 ? ruts[0] : null;
          })()}
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onPick={asignarLote}
        />
      )}

      {gastoVariant && (
        <GastoObraModal
          variant={gastoVariant}
          movementIds={ids}
          movementCount={movements.length}
          totalNeto={neto}
          projects={projects}
          categories={categories}
          onClose={() => setGastoVariant(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

// Subvista con las categorías de gasto propio (sueldo, retiro, previred…).
// Equivale al viejo MarkSinFacturaButton: PATCH { category, saveRule }.
function SueldoSubmenu({
  options,
  saveRule,
  setSaveRule,
  busy,
  onPick,
  onBack,
}: {
  options: { value: string; label: string }[];
  saveRule: boolean;
  setSaveRule: (v: boolean) => void;
  busy: boolean;
  onPick: (category: string) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-900"
      >
        <span aria-hidden="true">‹</span> Volver
      </button>
      <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-gray-400">
        Gasto propio de BLARQ
      </p>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onPick(o.value)}
          disabled={busy}
          className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {o.label}
        </button>
      ))}
      <label className="flex items-start gap-1.5 px-3 pt-2 pb-1.5 mt-1 border-t border-gray-100 text-[11px] text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={saveRule}
          onChange={(e) => setSaveRule(e.target.checked)}
          className="mt-0.5 accent-gray-900"
        />
        <span>
          Guardar regla
          <span className="block text-[10px] text-gray-400">
            Etiqueta solas las próximas con glosa parecida.
          </span>
        </span>
      </label>
    </div>
  );
}

// Íconos monocromáticos simples (SVG inline) — el repo no usa lucide-react;
// los glifos textuales (✨ ↔) están prohibidos por la guía de marca. Un set
// mínimo para el menú.
function MenuGlyph({ name }: { name: string }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "text-gray-400 shrink-0",
    "aria-hidden": true,
  };
  switch (name) {
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3 18l3 3 6.4-6.4a4 4 0 0 0 5.3-5.3l-2.8 2.8-2.1-2.1z" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 12 0v1" />
        </svg>
      );
    case "swap":
      return (
        <svg {...common}>
          <path d="M7 8h13M7 8l3-3M7 8l3 3" />
          <path d="M17 16H4m13 0l-3-3m3 3l-3 3" />
        </svg>
      );
    case "arrow-back":
      return (
        <svg {...common}>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}
