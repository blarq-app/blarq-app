// Compresión de fotos en el navegador, antes de guardarlas.
//
// La app no usa almacenamiento externo: las fotos de respaldo viven como data
// URL dentro de la base. Achicarlas es lo que hace viable eso — una foto de
// celular de ~3 MB queda en ~150 KB sin perder legibilidad de una boleta.
//
// Vive suelta (y no dentro de un componente) porque la usan tanto la celda
// "Comprobante" de Gastos como el modal de reembolso de boletas.

export async function comprimirImagen(
  file: File,
  maxSide = 1400,
  quality = 0.7
): Promise<string> {
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
