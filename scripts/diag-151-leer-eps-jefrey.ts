/**
 * Lee los PDFs reales de los EPs de un maestro y saca el texto, para poder
 * revisar los montos contra lo que muestra la app.
 *
 * Los PDFs los generó la propia app con Chromium: el texto va en streams
 * FlateDecode y con FUENTES SUBSETEADAS, así que cada letra viaja como un
 * código de glifo (<0048>) que no es su Unicode. Para leerlo hay que:
 *   1. inflar los streams con zlib;
 *   2. sacar el CMap /ToUnicode de cada fuente (beginbfchar / beginbfrange);
 *   3. seguir qué fuente está activa (/Fx Tf) y traducir código → letra.
 * Por eso no alcanza con un grep: sin el paso 2 sale un jeroglífico.
 *
 * Correr con:  npx tsx scripts/diag-151-leer-eps-jefrey.ts <pdf> [pdf...]
 */
import { readFileSync } from "fs";
import { inflateSync } from "zlib";

type Objetos = Map<number, { crudo: string; stream: Buffer | null }>;

// Corta el PDF en objetos "N 0 obj … endobj", guardando su stream si lo tiene.
function leerObjetos(buf: Buffer): Objetos {
  const objetos: Objetos = new Map();
  const texto = buf.toString("latin1");
  const re = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const num = Number(m[1]);
    const desde = m.index + m[0].length;
    const hasta = texto.indexOf("endobj", desde);
    if (hasta === -1) continue;
    const cuerpo = texto.slice(desde, hasta);
    let stream: Buffer | null = null;
    const s = cuerpo.indexOf("stream");
    if (s !== -1) {
      let d = desde + s + 6;
      if (buf[d] === 0x0d) d++;
      if (buf[d] === 0x0a) d++;
      const fin = buf.indexOf("endstream", d);
      if (fin !== -1) {
        try {
          stream = inflateSync(buf.subarray(d, fin));
        } catch {
          stream = null;
        }
      }
    }
    objetos.set(num, { crudo: cuerpo, stream });
  }
  return objetos;
}

// Un CMap /ToUnicode: código de glifo (hex) → texto.
function parsearToUnicode(cmap: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const hexATexto = (h: string) => {
    let s = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    }
    return s;
  };
  for (const bloque of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const par of bloque.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      const [, a, b] = par.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/)!;
      mapa.set(a.toUpperCase(), hexATexto(b));
    }
  }
  for (const bloque of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bloque))) {
      const ini = parseInt(m[1], 16);
      const fin = parseInt(m[2], 16);
      const base = parseInt(m[3], 16);
      for (let c = ini; c <= fin; c++) {
        mapa.set(
          c.toString(16).toUpperCase().padStart(m[1].length, "0"),
          String.fromCharCode(base + (c - ini))
        );
      }
    }
  }
  return mapa;
}

// Nombre de fuente (/F1) → su CMap.
function fuentes(objetos: Objetos): Map<string, Map<string, string>> {
  const porObjeto = new Map<number, Map<string, string>>();
  for (const [, o] of objetos) {
    const m = o.crudo.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!m) continue;
    const cm = objetos.get(Number(m[1]))?.stream;
    if (cm) porObjeto.set(Number(m[1]), parsearToUnicode(cm.toString("latin1")));
  }
  // Los recursos mapean el nombre corto (/F1) al objeto de la fuente.
  const porNombre = new Map<string, Map<string, string>>();
  for (const [, o] of objetos) {
    for (const par of o.crudo.match(/\/(F\d+)\s+(\d+)\s+0\s+R/g) ?? []) {
      const [, nombre, num] = par.match(/\/(F\d+)\s+(\d+)\s+0\s+R/)!;
      const fuente = objetos.get(Number(num));
      const tu = fuente?.crudo.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
      if (tu && porObjeto.has(Number(tu[1]))) {
        porNombre.set(nombre, porObjeto.get(Number(tu[1]))!);
      }
    }
  }
  return porNombre;
}

// Recorre el contenido y arma las líneas de texto. Un salto grande en Y (Td/TD
// /Tm) o un cambio de bloque cierra la línea.
function textoDeContenido(
  contenido: string,
  porNombre: Map<string, Map<string, string>>
): string[] {
  const lineas: string[] = [];
  let actual: Map<string, string> | undefined;
  let buffer = "";
  const cerrar = () => {
    if (buffer.trim()) lineas.push(buffer.trim());
    buffer = "";
  };
  for (const linea of contenido.split(/\r?\n/)) {
    const f = linea.match(/\/(F\d+)\s+[\d.]+\s+Tf/);
    if (f) actual = porNombre.get(f[1]);
    if (/\bBT\b|\bTm\b|\bTD\b/.test(linea)) cerrar();
    for (const t of linea.match(/<([0-9A-Fa-f]+)>\s*Tj/g) ?? []) {
      const hex = t.match(/<([0-9A-Fa-f]+)>/)![1].toUpperCase();
      for (let i = 0; i + 1 < hex.length + 1; i += 2) {
        const cod = hex.slice(i, i + 2);
        buffer += actual?.get(cod) ?? actual?.get(cod.padStart(4, "0")) ?? "";
      }
    }
    // Un desplazamiento horizontal grande = espacio entre columnas.
    const td = linea.match(/^([\d.-]+)\s+([\d.-]+)\s+Td/);
    if (td && Math.abs(Number(td[1])) > 12) buffer += "  ";
  }
  cerrar();
  return lineas;
}

for (const ruta of process.argv.slice(2)) {
  const buf = readFileSync(ruta);
  const objetos = leerObjetos(buf);
  const porNombre = fuentes(objetos);
  const lineas: string[] = [];
  for (const [, o] of objetos) {
    if (!o.stream) continue;
    const c = o.stream.toString("latin1");
    if (!/T[jJ]/.test(c)) continue;
    lineas.push(...textoDeContenido(c, porNombre));
  }
  console.log(`\n${"=".repeat(72)}\n${ruta.split("/").pop()}\n${"=".repeat(72)}`);
  console.log(lineas.join("\n"));
}
