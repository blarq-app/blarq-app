"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  procesarComprobante,
  esPdf,
  ComprobanteInvalido,
} from "@/lib/comprobante";

// Celda "Comprobante" de un gasto (Contabilidad → Gastos). Deja subir el
// respaldo del gasto —una FOTO (boleta, screenshot) o un PDF (factura de un
// proveedor internacional: Anthropic, Neon, CapCut…)— verlo en grande, o
// quitarlo. Las imágenes se comprimen; los PDF se guardan tal cual (ver
// @/lib/comprobante). Todo va como data URL en la BD (sin almacenamiento
// externo). Se guarda con PATCH /api/facturas/[id] { attachmentUrl }.

export default function GastoAttachmentCell({
  invoiceId,
  attachmentUrl,
}: {
  invoiceId: string;
  attachmentUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdf = attachmentUrl ? esPdf(attachmentUrl) : false;

  async function save(dataUrl: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facturas/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentUrl: dataUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      console.error(e);
      setError("No se pudo guardar el comprobante");
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permitir re-elegir el mismo archivo
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await procesarComprobante(file);
      await save(dataUrl);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof ComprobanteInvalido
          ? err.message
          : "No se pudo procesar el archivo"
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={onPick}
        className="hidden"
      />

      {attachmentUrl ? (
        <>
          {/* Miniatura clickeable → abre el comprobante en grande. Un PDF no
              tiene miniatura visual, así que se muestra un ícono de documento. */}
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="block h-9 w-9 rounded overflow-hidden border border-gray-200 hover:border-gray-400"
            title="Ver comprobante"
          >
            {pdf ? (
              <span className="flex h-full w-full items-center justify-center bg-gray-50 text-[8px] font-semibold uppercase tracking-wide text-gray-500">
                PDF
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentUrl} alt="Comprobante" className="h-full w-full object-cover" />
            )}
          </button>
          <button
            type="button"
            onClick={() => save(null)}
            disabled={busy}
            className="text-[10px] text-gray-400 hover:text-rose-600 underline-offset-2 hover:underline disabled:opacity-50"
            title="Quitar comprobante"
          >
            quitar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 hover:border-gray-400 rounded px-2 py-1 disabled:opacity-50"
        >
          {busy ? "…" : "+ Comprobante"}
        </button>
      )}

      {error && <span className="text-[10px] text-rose-600">{error}</span>}

      {/* Vista grande del comprobante. Foto → imagen; PDF → visor embebido. */}
      {preview && attachmentUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setPreview(false)}
        >
          {pdf ? (
            <iframe
              src={attachmentUrl}
              title="Comprobante"
              className="h-full w-full max-w-3xl rounded bg-white shadow-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachmentUrl}
              alt="Comprobante"
              className="max-h-full max-w-full rounded shadow-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
