"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Celda "Comprobante" de un gasto (Contabilidad → Gastos). Deja subir una foto
// de la boleta / screenshot del cargo internacional, verla en grande, o
// quitarla. La imagen se COMPRIME en el navegador (canvas → JPEG) antes de
// guardarla como data URL en la BD — la app no usa almacenamiento externo, así
// que achicarla es lo que la hace viable (una foto de celular de ~3MB queda en
// ~150KB). Se guarda con PATCH /api/facturas/[id] { attachmentUrl }.

// Comprime un archivo de imagen a un JPEG data URL, con el lado mayor limitado
// a maxSide px. Devuelve el data URL listo para guardar.
async function compressImage(file: File, maxSide = 1400, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

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
      setError("No se pudo guardar la foto");
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permitir re-elegir el mismo archivo
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Tiene que ser una imagen");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await compressImage(file);
      await save(dataUrl);
    } catch (err) {
      console.error(err);
      setError("No se pudo procesar la imagen");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
      />

      {attachmentUrl ? (
        <>
          {/* Miniatura clickeable → abre la foto en grande. */}
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="block h-9 w-9 rounded overflow-hidden border border-gray-200 hover:border-gray-400"
            title="Ver comprobante"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachmentUrl} alt="Comprobante" className="h-full w-full object-cover" />
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
          {busy ? "…" : "+ Foto"}
        </button>
      )}

      {error && <span className="text-[10px] text-rose-600">{error}</span>}

      {/* Vista grande de la foto. Overlay en flujo normal (fixed inset). */}
      {preview && attachmentUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setPreview(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentUrl}
            alt="Comprobante"
            className="max-h-full max-w-full rounded shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
