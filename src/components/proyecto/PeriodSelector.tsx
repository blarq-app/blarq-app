"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Selector de período para Estado de Resultados.
// Cinco opciones predefinidas + custom (con date inputs).
// Sincroniza el período a search params (?period=month|quarter|ytd|year|custom
// y, si es custom, ?from=...&to=...).

export type Period = "month" | "semester" | "year" | "custom";

const TABS: Array<{ key: Period; label: string }> = [
  { key: "month", label: "Mes actual" },
  { key: "semester", label: "Semestre" },
  { key: "year", label: "Año" },
  { key: "custom", label: "Personalizado" },
];

export default function PeriodSelector({
  currentPeriod,
  fromLabel,
  toLabel,
}: {
  currentPeriod: Period;
  fromLabel: string;
  toLabel: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefFor(p: Period): string {
    const params = new URLSearchParams(sp.toString());
    if (p === "month") {
      params.delete("period");
      params.delete("from");
      params.delete("to");
    } else {
      params.set("period", p);
      if (p !== "custom") {
        params.delete("from");
        params.delete("to");
      }
    }
    return `${pathname}${params.toString() ? "?" + params.toString() : ""}`;
  }

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
        {TABS.map((t) => {
          const isActive = t.key === currentPeriod;
          return (
            <Link
              key={t.key}
              href={hrefFor(t.key)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isActive
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Período: <span className="font-medium text-gray-700">{fromLabel}</span> —{" "}
        <span className="font-medium text-gray-700">{toLabel}</span>
      </p>
    </div>
  );
}
