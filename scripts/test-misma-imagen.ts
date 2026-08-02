/**
 * Test de `esLaMismaImagen` (arreglo 2026-08-02): la migración de CDN de VTEX
 * hacía que el modal ofreciera "actualizar" fotos idénticas, y aplicar eso
 * despegaba la línea del catálogo.
 */
import { esLaMismaImagen } from "../src/lib/catalog/mismaImagen";

const CASOS: Array<[string, string | null, string | null, boolean]> = [
  ["el caso real del MEZCLADOR: mismo archivo, CDN nuevo vs viejo",
   "https://mkchile.vtexassets.com/arquivos/ids/7296954/GKL-03-0061_1.jpg",
   "https://mkchile.vteximg.com.br/arquivos/ids/7296954/GKL-03-0061_1.jpg", true],
  ["idénticas",
   "https://mkchile.vtexassets.com/arquivos/ids/1/a.jpg",
   "https://mkchile.vtexassets.com/arquivos/ids/1/a.jpg", true],
  ["LED Studio, misma migración",
   "https://ledstudiocl.vtexassets.com/arquivos/ids/999/f.jpg",
   "https://ledstudiocl.vteximg.com.br/arquivos/ids/999/f.jpg", true],
  ["archivos DISTINTOS en el mismo CDN → son distintas",
   "https://mkchile.vtexassets.com/arquivos/ids/1/a.jpg",
   "https://mkchile.vtexassets.com/arquivos/ids/2/b.jpg", false],
  ["misma ruta pero TIENDAS distintas → no se asumen iguales",
   "https://mkchile.vtexassets.com/arquivos/ids/1/a.jpg",
   "https://byp.vtexassets.com/arquivos/ids/1/a.jpg", false],
  ["misma ruta en dominios que NO son CDN de VTEX → no se asumen iguales",
   "https://tienda-a.cl/fotos/1.jpg", "https://tienda-b.cl/fotos/1.jpg", false],
  ["Shopify contra sí mismo, distinto archivo",
   "https://cdn.shopify.com/s/files/1/x/a.jpg",
   "https://cdn.shopify.com/s/files/1/x/b.jpg", false],
  ["una foto nueva cuando no había ninguna",
   "https://mkchile.vtexassets.com/arquivos/ids/1/a.jpg", null, false],
  ["las dos vacías", null, null, true],
];

let fallas = 0;
for (const [nombre, a, b, esperado] of CASOS) {
  const real = esLaMismaImagen(a, b);
  const ok = real === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? "OK  " : "FALLA"} | ${nombre} → ${real} (esperado ${esperado})`);
}
console.log(`\n${CASOS.length - fallas}/${CASOS.length} OK`);
if (fallas > 0) process.exitCode = 1;
