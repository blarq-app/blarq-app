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
 */
export default function MoneyInput({
  value,
  onChange,
  className = "",
  step = 1,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <input
      type={focused ? "number" : "text"}
      value={focused ? (value === 0 ? "" : value) : formatNumber(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      onFocus={(e) => {
        setFocused(true);
        // Selecciona todo al entrar para facilitar reemplazo
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => setFocused(false)}
      step={step}
      className={className}
    />
  );
}
