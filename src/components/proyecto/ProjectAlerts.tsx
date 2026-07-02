"use client";

import * as React from "react";

// Alertas de presupuesto del proyecto (ej. "Materiales: 114% del presupuesto
// consumido"). Se calculan en el server y se pasan acá ya armadas; este
// componente solo se encarga de mostrarlas y de poder OCULTAR cada una con una
// cruz.
//
// Comportamiento del ocultar (decidido con MJ, 2026-06-16): "hasta que el dato
// cambie". La firma de una alerta oculta es su texto completo (incluye el %).
// Si el dato cambia, el texto cambia → la firma vieja deja de aplicar y la
// alerta vuelve a aparecer; así no se pierde un empeoramiento. Se recuerda en
// el navegador (localStorage), por proyecto — no toca la base.

// Acepta el tipo de alerta que produce metrics.ts (fuente única). Incluye
// "info" por completitud del tipo, aunque hoy solo se emiten danger/warning;
// cualquier severidad no-danger se muestra en ámbar.
type Alerta = { severity: "info" | "warning" | "danger"; message: string };

export default function ProjectAlerts({
  projectId,
  alertas,
}: {
  projectId: string;
  alertas: Alerta[];
}) {
  const storageKey = `blarq-alertas-ocultas-${projectId}`;
  const [ocultas, setOcultas] = React.useState<string[]>([]);
  const [listo, setListo] = React.useState(false);

  // Al montar: leer las ocultas guardadas y PODAR las que ya no corresponden a
  // ninguna alerta actual (si el dato cambió, su firma cambió). Eso es lo que
  // hace que una alerta vuelva cuando el número se mueve.
  React.useEffect(() => {
    try {
      const guardadas: string[] = JSON.parse(localStorage.getItem(storageKey) || "[]");
      const vigentes = guardadas.filter((m) => alertas.some((a) => a.message === m));
      setOcultas(vigentes);
      if (vigentes.length !== guardadas.length) {
        localStorage.setItem(storageKey, JSON.stringify(vigentes));
      }
    } catch {
      /* localStorage no disponible: mostramos todas, sin romper */
    }
    setListo(true);
  }, [storageKey, alertas]);

  function ocultar(message: string) {
    setOcultas((prev) => {
      const next = [...prev, message];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignorar */
      }
      return next;
    });
  }

  // Antes de leer el navegador (SSR + primer render) mostramos todas para que
  // el contenido no parpadee. Después de `listo`, filtramos las ocultas.
  const visibles = listo
    ? alertas.filter((a) => !ocultas.includes(a.message))
    : alertas;

  if (visibles.length === 0) return null;

  return (
    <div className="mb-5 space-y-2">
      {visibles.map((a) => {
        const isDanger = a.severity === "danger";
        return (
          <div
            key={a.message}
            className={`rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm ${
              isDanger
                ? "bg-red-50 border border-red-200 text-red-900"
                : "bg-amber-50 border border-amber-200 text-amber-900"
            }`}
          >
            <span className={`text-lg shrink-0 ${isDanger ? "text-red-600" : "text-amber-700"}`}>
              ⚠
            </span>
            <span className="flex-1">{a.message}</span>
            <button
              type="button"
              onClick={() => ocultar(a.message)}
              aria-label="Ocultar esta alerta"
              title="Ocultar (vuelve si el dato cambia)"
              className={`shrink-0 leading-none text-lg px-1 rounded transition-colors ${
                isDanger
                  ? "text-red-400 hover:text-red-700 hover:bg-red-100"
                  : "text-amber-500 hover:text-amber-800 hover:bg-amber-100"
              }`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
