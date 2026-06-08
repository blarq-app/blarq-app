"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/utils";

interface MoneyInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  step?: number;
}

/**
 * Input de moneda en pesos chilenos.
 * - Sin foco: muestra valor formateado con puntos de miles (ej: 15.816)
 * - Con foco: muestra número crudo para editar (ej: 15816)
 *
 * Guarda AL TERMINAR (al salir del campo o apretar Enter), NO en cada tecla.
 * Mientras se escribe, el texto vive como borrador local y no se dispara
 * `onChange`. Esto es deliberado: arriba (en la cotización/desglose) cada
 * `onChange` gatilla un guardado + recálculo que volvía a leer del servidor y
 * pisaba el campo apenas se tecleaba el primer dígito — por eso no dejaba
 * escribir una cifra completa como "35000". Con el borrador, MJ tipea tranquila
 * y recién al salir/Enter se guarda el número final, exactamente el que escribió.
 */
export default function MoneyInput({
  value,
  onChange,
  className = "",
  step = 1,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  // Borrador de lo que se está escribiendo. Solo vale mientras `focused`.
  const [draft, setDraft] = useState("");

  // Confirma el borrador: guarda solo si el número cambió de verdad (así no
  // recalcula de gusto al entrar y salir sin tocar nada).
  function commit() {
    setFocused(false);
    const parsed = parseFloat(draft) || 0;
    if (parsed !== value) onChange(parsed);
  }

  return (
    <input
      type={focused ? "number" : "text"}
      value={focused ? draft : formatNumber(value)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        // Arranca el borrador con el valor actual (vacío si es 0, para que el
        // primer dígito lo reemplace en vez de quedar "0...").
        setDraft(value === 0 ? "" : String(value));
        // Selecciona todo al entrar para facilitar reemplazo.
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        // Enter = terminar y guardar (igual que salir del campo).
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      step={step}
      className={className}
    />
  );
}
