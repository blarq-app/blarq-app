"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Señal de guardado compartida por los desplegables de la tabla de movimientos
// (imputación, mes del sueldo, obra y concepto de un traspaso interno). Todos
// mueven plata de lugar en el Estado de Resultados y todos guardaban en
// silencio: el único indicio era el parpadeo del refresh, que no distingue
// "quedó guardado" de "no pasó nada".
//
// El "✓ guardado" aparece cuando el refresh del servidor terminó, no apenas
// responde el PATCH: si se mostrara antes, MJ vería el visto y después la
// pantalla parpadearía, que es justo la confusión que esto viene a resolver.
// Por eso el refresh va dentro de una transición — es la forma de saber cuándo
// terminó de verdad.

const MS_CONFIRMACION = 2500;

export function useSenalGuardado() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  // "Hay un guardado esperando confirmarse en pantalla". Mientras el refresh
  // corre (pending), todavía no se confirma; en cuanto termina, se confirma —
  // por eso `confirmado` se deriva en vez de guardarse en otro estado.
  const [esperando, setEsperando] = useState(false);
  const confirmado = esperando && !pending;

  // Lo único que hace falta programar es el apagado del cartel.
  useEffect(() => {
    if (!confirmado) return;
    const t = setTimeout(() => setEsperando(false), MS_CONFIRMACION);
    return () => clearTimeout(t);
  }, [confirmado]);

  function refrescarYConfirmar() {
    setEsperando(true);
    startTransition(() => router.refresh());
  }

  return {
    // El desplegable queda bloqueado durante el guardado Y el refresh, para
    // que no se encimen dos cambios sobre la misma fila.
    busy: saving || pending,
    confirmado,
    setSaving,
    refrescarYConfirmar,
  };
}

// Borde y texto del desplegable: verde mientras dura la confirmación, y lo que
// el componente use normalmente el resto del tiempo.
export function claseSenal(confirmado: boolean, normal: string): string {
  return confirmado ? "border-green-600 text-green-800" : normal;
}

// El cartelito al lado del desplegable. No ocupa lugar cuando no hay nada que
// decir (es lo normal: aparece solo al guardar).
//
// `flotante` es para las celdas apretadas — la de un traspaso interno lleva DOS
// desplegables en el mismo ancho, y un cartel en el flujo los aplasta hasta
// dejarlos ilegibles. Flotando encima nada se mueve de lugar; el cartel se va
// solo a los 2,5 segundos.
export function SenalGuardado({
  busy,
  confirmado,
  flotante = false,
}: {
  busy: boolean;
  confirmado: boolean;
  flotante?: boolean;
}) {
  if (!busy && !confirmado) return null;
  return (
    <span
      aria-live="polite"
      className={`text-force-10 whitespace-nowrap shrink-0 ${
        confirmado ? "text-green-700" : "text-gray-500"
      } ${
        flotante
          ? "absolute left-full top-1/2 -translate-y-1/2 ml-1 z-10 bg-white px-1 rounded pointer-events-none"
          : ""
      }`}
    >
      {confirmado ? "✓ guardado" : "guardando…"}
    </span>
  );
}
