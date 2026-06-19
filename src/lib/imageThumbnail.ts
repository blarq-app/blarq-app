// Toma un archivo de imagen y lo achica a una miniatura comprimida (JPEG),
// devuelta como data URL para guardar directo en imageUrl. Evita subir fotos
// de 3-5 MB: las deja en ~40-100 KB. Sin almacenamiento externo.
//
// Vive como util compartido porque lo usan tanto el catálogo de artefactos
// (ArtefactosCatalogClient) como el alta de un artefacto nuevo dentro de una
// cotización (AddArtefactoFromCatalog).
export function fileToThumbnailDataUrl(
  file: File,
  maxSize = 600,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen inválido"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo procesar la imagen"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
