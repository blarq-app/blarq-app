import { comprimirImagen } from "@/lib/comprimirImagen";

// Procesamiento de un comprobante de gasto antes de guardarlo. Acepta dos
// tipos de archivo:
//   - Imagen (foto de boleta, screenshot de un cargo): se COMPRIME en el
//     navegador (una foto de celular de ~3MB queda en ~150KB).
//   - PDF (factura de un proveedor internacional: Anthropic, Neon, CapCut…):
//     se guarda tal cual, sin comprimir — un PDF no se puede "achicar" con
//     canvas y además ya suele venir liviano (las facturas de Anthropic pesan
//     ~35KB). Solo se le pone un techo para que no infle la fila de la BD.
//
// Todo se guarda como data URL en Invoice.attachmentUrl (la app no usa
// almacenamiento externo). El tipo se reconoce después por el prefijo del
// data URL (ver esPdf).

// Techo de un PDF de comprobante. Las facturas reales andan por 35–200KB; 4MB
// es un margen amplio que igual frena un PDF escaneado enorme.
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export function esPdf(dataUrl: string): boolean {
  return dataUrl.startsWith("data:application/pdf");
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export class ComprobanteInvalido extends Error {}

// Devuelve el data URL listo para guardar, o tira ComprobanteInvalido con un
// mensaje en español si el archivo no sirve.
export async function procesarComprobante(file: File): Promise<string> {
  if (file.type.startsWith("image/")) {
    return comprimirImagen(file);
  }
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) {
      throw new ComprobanteInvalido("El PDF es muy pesado (máximo 4 MB)");
    }
    return leerComoDataUrl(file);
  }
  throw new ComprobanteInvalido("Tiene que ser una imagen o un PDF");
}
