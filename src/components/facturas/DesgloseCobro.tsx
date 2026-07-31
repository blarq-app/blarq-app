"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { formatCLP } from "@/lib/utils";

// Desglose de una factura EMITIDA entre los conceptos del Cuadro Resumen:
// Obra, Muebles, y los tres de artefactos (Cocina, Sanitarios, Iluminación).
//
// Dos casos que cubre el mismo mecanismo:
//   - La factura de artefactos que agrupa las tres sub-categorías en un folio
//     ("Diferencia Artefactos"). Era lo único que se podía desglosar hasta el
//     2026-07-30.
//   - La factura COMBINADA, cuando la clienta pide UN documento por todo
//     (Portofino: obra + muebles + artefactos en la misma factura). Sin este
//     desglose el Cuadro Resumen la manda entera a la columna del concepto de
//     la factura y deja las otras en 0%.
//
// Los montos van CON IVA y deben sumar el TOTAL de la factura. La UI muestra la
// suma y si cuadra, y no deja guardar un desglose que no cierre.
//
// Vaciar TODOS los campos quita el desglose y vuelve al comportamiento de
// siempre (concepto único + reparto proporcional dentro de artefactos).

type Props = {
  invoiceId: string;
  totalAmount: number; // total de la factura CON IVA
  initial: {
    montoObra: number | null;
    montoMuebles: number | null;
    artefactoCocina: number | null;
    artefactoSanitario: number | null;
    artefactoIluminacion: number | null;
  };
};

// Misma tolerancia que usa el resto del banco para redondeos de IVA.
const TOLERANCIA = 10;

const CAMPOS = [
  { key: "montoObra", label: "Obra" },
  { key: "montoMuebles", label: "Muebles" },
  { key: "artefactoCocina", label: "Art. Cocina" },
  { key: "artefactoSanitario", label: "Art. Sanitarios" },
  { key: "artefactoIluminacion", label: "Art. Iluminación" },
] as const;

type Campo = (typeof CAMPOS)[number]["key"];

const aTexto = (n: number | null) => (n != null ? String(Math.round(n)) : "");

export default function DesgloseCobro({ invoiceId, totalAmount, initial }: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<Campo, string>>({
    montoObra: aTexto(initial.montoObra),
    montoMuebles: aTexto(initial.montoMuebles),
    artefactoCocina: aTexto(initial.artefactoCocina),
    artefactoSanitario: aTexto(initial.artefactoSanitario),
    artefactoIluminacion: aTexto(initial.artefactoIluminacion),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const yaTeniaDesglose = CAMPOS.some((c) => initial[c.key] != null);

  const { suma, todoVacio } = useMemo(() => {
    let s = 0;
    let vacio = true;
    for (const c of CAMPOS) {
      const txt = valores[c.key];
      if (txt !== "") vacio = false;
      const n = Number(txt);
      if (Number.isFinite(n)) s += n;
    }
    return { suma: s, todoVacio: vacio };
  }, [valores]);

  const delta = suma - totalAmount;
  const cuadra = Math.abs(delta) <= TOLERANCIA;

  // Reparte el saldo que falta en el campo que se elija — evita que MJ tenga
  // que hacer la resta a mano cuando ya cargó los demás.
  function completarCon(campo: Campo) {
    const resto = totalAmount - (suma - Number(valores[campo] || 0));
    setValores((v) => ({ ...v, [campo]: String(Math.round(resto)) }));
  }

  async function guardar() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const payload = Object.fromEntries(
        CAMPOS.map((c) => [
          c.key,
          todoVacio || valores[c.key] === "" ? null : Number(valores[c.key]),
        ])
      );
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Error al guardar el desglose");
        return;
      }
      setOkMsg(
        todoVacio
          ? "Desglose quitado. El cuadro vuelve a tratar la factura con un solo concepto."
          : "Desglose guardado."
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          Desglose del cobro
        </h2>
        <span className="text-xs text-gray-500 tabular-nums">
          Total factura: <span className="text-gray-900">{formatCLP(totalAmount)}</span>
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Si esta factura cobra más de un concepto a la vez, cargá cuánto es de
        cada uno (montos <span className="font-medium">con IVA</span>) para que el
        Cuadro Resumen lo reparta bien. Lo que dejes en blanco cuenta como cero.
        Si los dejás todos vacíos, la factura vuelve a contarse entera en su
        concepto.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CAMPOS.map((c) => (
          <CampoMonto
            key={c.key}
            label={c.label}
            value={valores[c.key]}
            onChange={(v) => setValores((prev) => ({ ...prev, [c.key]: v }))}
            onCompletar={() => completarCon(c.key)}
            mostrarCompletar={!todoVacio && !cuadra}
          />
        ))}
      </div>

      {/* Suma vs total: verde si cuadra, rojo si no. Solo se evalúa cuando hay
          al menos un monto cargado. */}
      {!todoVacio && (
        <div
          className={`mt-4 text-xs rounded px-3 py-2 border flex items-center justify-between gap-3 flex-wrap ${
            cuadra
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <span>
            Suma:{" "}
            <span className="font-semibold tabular-nums">{formatCLP(suma)}</span>
            <span className="text-gray-500"> / {formatCLP(totalAmount)}</span>
          </span>
          <span className="font-medium">
            {cuadra ? (
              "Cuadra con el total"
            ) : (
              <>
                {delta > 0 ? "Sobra " : "Falta "}
                <span className="tabular-nums">{formatCLP(Math.abs(delta))}</span>
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          {okMsg}
        </div>
      )}

      <div className="flex justify-end mt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={guardar}
          // Bloqueamos el guardado si hay montos cargados pero no cuadran con el
          // total — evita cargar un desglose incoherente. Vaciarlos todos (para
          // quitar el desglose) siempre se permite.
          disabled={saving || (!todoVacio && !cuadra)}
        >
          {saving
            ? "Guardando…"
            : todoVacio && yaTeniaDesglose
              ? "Quitar desglose"
              : "Guardar desglose"}
        </Button>
      </div>
    </div>
  );
}

function CampoMonto({
  label,
  value,
  onChange,
  onCompletar,
  mostrarCompletar,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCompletar: () => void;
  mostrarCompletar: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        {mostrarCompletar && (
          <button
            type="button"
            onClick={onCompletar}
            className="text-[11px] text-gray-400 hover:text-gray-900 underline underline-offset-2 mb-1"
            title="Poner acá el monto que falta para cuadrar con el total"
          >
            completar
          </button>
        )}
      </div>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full border border-gray-300 rounded pl-5 pr-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>
    </div>
  );
}
