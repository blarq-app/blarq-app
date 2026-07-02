"use client";

import { useState } from "react";

// Recuadro "Portada del PDF": deja que MJ escriba los textos de la carátula de
// la cotización (título, bajada y una nota opcional). Si un campo queda vacío,
// el generador del PDF usa un default por tipo (ver *PDF.html.ts) — el
// placeholder muestra ese default para que se sepa qué va a salir.

interface CoverFieldsProps {
  budgetId: string;
  type: string; // obra | muebles | artefactos
  projectName: string;
  address: string | null;
  initialTitle: string | null;
  initialSubtitle: string | null;
  initialNote: string | null;
}

function defaultTitle(type: string, projectName: string): string {
  if (type === "muebles") return "Mobiliario a medida";
  if (type === "artefactos") return "Artefactos y equipamiento";
  return projectName; // obra: default = nombre del proyecto (MJ suele escribir la obra)
}

export default function CoverFields({
  budgetId,
  type,
  projectName,
  address,
  initialTitle,
  initialSubtitle,
  initialNote,
}: CoverFieldsProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  // Plegable: arranca cerrado para no ocupar espacio. Si ya hay algo escrito,
  // arranca abierto para que se vea que la portada está personalizada.
  const [open, setOpen] = useState(
    Boolean(initialTitle || initialSubtitle || initialNote)
  );

  const subtitleDefault = `${projectName}${address ? " · " + address : ""}`;

  async function save(field: string, value: string) {
    try {
      await fetch(`/api/presupuestos/${budgetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      setSaved(field);
      setTimeout(() => setSaved((s) => (s === field ? null : s)), 1500);
    } catch {
      // silencioso: el PATCH es best-effort, no bloquea la edición
    }
  }

  const labelCls =
    "block text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1";
  const inputCls =
    "w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none";

  const personalizada = Boolean(title.trim() || subtitle.trim() || note.trim());

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-900">Portada del PDF</span>
        </span>
        <span className="text-[11px] text-gray-400">
          {saved
            ? "Guardado"
            : open
              ? "Se completa solo si lo dejás en blanco"
              : personalizada
                ? "Personalizada"
                : "Textos por defecto"}
        </span>
      </button>

      {open && (
      <div className="px-4 pb-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr]">
        <div>
          <label className={labelCls}>Título</label>
          <input
            className={inputCls}
            value={title}
            placeholder={defaultTitle(type, projectName)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => save("coverTitle", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Bajada</label>
          <input
            className={inputCls}
            value={subtitle}
            placeholder={subtitleDefault}
            onChange={(e) => setSubtitle(e.target.value)}
            onBlur={(e) => save("coverSubtitle", e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className={labelCls}>Nota (opcional)</label>
        <input
          className={inputCls}
          value={note}
          placeholder="Línea de contexto opcional bajo la bajada"
          onChange={(e) => setNote(e.target.value)}
          onBlur={(e) => save("coverNote", e.target.value)}
        />
      </div>
      </div>
      )}
    </div>
  );
}
