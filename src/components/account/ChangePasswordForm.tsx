"use client";

import { useState } from "react";

/**
 * Clases del input. `rounded` y `ring-1` para alinear con el resto de la app
 * (docs/principles.md pide `rounded` en inputs, no `rounded-lg`). El tamaño de
 * letra en el celular lo sube a 16px una regla de globals.css, para que Safari
 * no haga zoom al enfocar — acá eran tres campos seguidos, o sea tres zooms.
 */
const INPUT =
  "w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900";

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Las contraseñas nuevas no coinciden." });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Mínimo 8 caracteres." });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "No se pudo cambiar." });
        return;
      }
      setMessage({ type: "ok", text: "✓ Contraseña actualizada." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setMessage({ type: "error", text: "Error de red." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Contraseña actual
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          className={INPUT}
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Nueva contraseña
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={INPUT}
        />
        <p className="text-[11px] text-gray-400 mt-1">Mínimo 8 caracteres.</p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Confirmar nueva contraseña
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          className={INPUT}
        />
      </div>

      {message && (
        <div
          className={`text-sm rounded px-3 py-2 ${
            message.type === "ok"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full sm:w-auto min-h-11 sm:min-h-0 bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
