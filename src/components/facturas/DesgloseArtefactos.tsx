"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { formatCLP } from "@/lib/utils";

// Desglose del cobro de artefactos de una factura EMITIDA que agrupa Cocina,
// Sanitarios e Iluminación en un solo folio ("Diferencia Artefactos").
//
// Sin este desglose, el Cuadro Resumen reparte el cobro proporcional al
// presupuesto de artefactos (aproximado, a veces mal). Cargando los tres
// montos acá, el cuadro los usa tal cual (prorrateados por la fracción de
// cada pago). Ver cuadroResumen.ts (~L204-215).
//
// Los tres montos van CON IVA y deben sumar el TOTAL de la factura (con IVA).
// La UI muestra la suma y si cuadra o no, para que MJ no se equivoque.

type Props = {
  invoiceId: string;
  totalAmount: number; // total de la factura CON IVA
  initial: {
    artefactoCocina: number | null;
    artefactoSanitario: number | null;
    artefactoIluminacion: number | null;
  };
};

// Misma tolerancia que usa el resto del banco para redondeos de IVA.
const TOLERANCIA = 10;

export default function DesgloseArtefactos({
  invoiceId,
  totalAmount,
  initial,
}: Props) {
  const router = useRouter();
  const [cocina, setCocina] = useState<string>(
    initial.artefactoCocina != null ? String(Math.round(initial.artefactoCocina)) : ""
  );
  const [sanitario, setSanitario] = useState<string>(
    initial.artefactoSanitario != null ? String(Math.round(initial.artefactoSanitario)) : ""
  );
  const [iluminacion, setIluminacion] = useState<string>(
    initial.artefactoIluminacion != null ? String(Math.round(initial.artefactoIluminacion)) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const yaTeniaDesglose =
    initial.artefactoCocina != null ||
    initial.artefactoSanitario != null ||
    initial.artefactoIluminacion != null;

  const nums = useMemo(() => {
    const parse = (s: string) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      cocina: parse(cocina),
      sanitario: parse(sanitario),
      iluminacion: parse(iluminacion),
    };
  }, [cocina, sanitario, iluminacion]);

  const suma = nums.cocina + nums.sanitario + nums.iluminacion;
  const delta = suma - totalAmount;
  const cuadra = Math.abs(delta) <= TOLERANCIA;
  const todoVacio = cocina === "" && sanitario === "" && iluminacion === "";

  async function guardar() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      // Si los tres quedan vacíos, se guarda null en los tres (vuelve al
      // reparto proporcional por presupuesto).
      const payload = todoVacio
        ? {
            artefactoCocina: null,
            artefactoSanitario: null,
            artefactoIluminacion: null,
          }
        : {
            artefactoCocina: nums.cocina,
            artefactoSanitario: nums.sanitario,
            artefactoIluminacion: nums.iluminacion,
          };
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
          ? "Desglose quitado. El cuadro vuelve al reparto proporcional."
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
          Desglose de artefactos
        </h2>
        <span className="text-xs text-gray-500 tabular-nums">
          Total factura: <span className="text-gray-900">{formatCLP(totalAmount)}</span>
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Esta factura cobra los tres tipos de artefacto juntos. Cargá cuánto es de
        cada uno (montos <span className="font-medium">con IVA</span>) para que el
        Cuadro Resumen los reparta bien. Si lo dejás en blanco, el cuadro reparte
        proporcional al presupuesto.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CampoMonto label="Cocina" value={cocina} onChange={setCocina} />
        <CampoMonto label="Sanitarios" value={sanitario} onChange={setSanitario} />
        <CampoMonto label="Iluminación" value={iluminacion} onChange={setIluminacion} />
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
          // total — evita cargar un desglose incoherente. Vaciar los tres (para
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </label>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white tabular-nums focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
      />
    </div>
  );
}
