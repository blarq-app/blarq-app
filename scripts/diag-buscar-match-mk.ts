/**
 * Busca en mk.cl los productos del catálogo que no tienen precio de internet
 * —los que están sin link y los que lo tienen caído— y propone el candidato
 * más parecido. SOLO LECTURA: no escribe nada.
 *
 * El parecido no se mide "a ojo": se puntúa. Lo que importa en estos nombres,
 * por orden:
 *   - Las MEDIDAS (30, 60, 700, 130): un toallero de 30 y uno de 60 son
 *     productos distintos aunque el nombre sea casi igual. Si el catálogo dice
 *     una medida y el candidato dice otra, queda descartado.
 *   - La LÍNEA (Atlas, Luxor, Urban, Delfos…) y el COLOR/terminación (brushed
 *     nickel, gun grey, cromo): definen el producto tanto como el tipo.
 *   - El TIPO (toallero, percha, portarrollo, mueble…).
 * Y aparte, si el precio guardado calza con el del candidato, suma confianza.
 *
 * Solo se marcan como SEGUROS los que coinciden en tipo, línea, color y
 * medidas. El resto queda para que MJ los mire.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

interface Cand { nombre: string; link: string; lista: number; venta: number }

function norm(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palabras que no distinguen nada.
const VACIAS = new Set(["con", "sin", "para", "del", "los", "las", "por", "una", "uno", "cm", "mm", "de", "la", "el", "y"]);

function tokens(s: string): string[] {
  return norm(s).split(" ").filter((w) => w.length > 2 && !VACIAS.has(w));
}

// Medidas: números de 2+ dígitos. Son lo que más distingue estos productos.
function medidas(s: string): string[] {
  return (norm(s).match(/\b\d{2,4}\b/g) ?? []).filter((n) => n !== "000");
}

// El TIPO de producto es lo primero que tiene que coincidir: un "contenedor
// ducha Atlas 30 brushed" comparte línea, medida y color con un "toallero Atlas
// brushed 30" y aun así es otra cosa. Sin este filtro el matcher los daba por
// iguales.
const TIPOS = [
  "toallero", "percha", "portarrollo", "portarrollos", "griferia", "mueble",
  "columna", "desague", "mampara", "lavamanos", "mezclador", "plato",
  "ampolleta", "lavaplatos", "contenedor", "dispensador", "brazo", "set",
  "union", "tina", "espejo", "repisa", "gancho", "jabonera", "escobillero",
  "horno", "encimera", "campana", "microondas", "lavavajillas", "refrigerador",
  "freezer", "grifo", "foco", "plafon", "downlight", "lampara", "panel",
];

function tipoDe(s: string): string | null {
  for (const t of tokens(s)) {
    if (TIPOS.includes(t)) return t === "portarrollos" ? "portarrollo" : t;
  }
  return null;
}

const COLORES = ["brushed", "nickel", "cromo", "cromado", "gun", "grey", "bronce", "bronze", "antique", "negro", "mate", "blanco", "dorado", "latón", "laton", "zinc", "grafito", "oak", "moon", "vison", "white", "natural"];
const LINEAS = ["atlas", "luxor", "urban", "delfos", "albany", "queen", "trend", "stellar", "asis", "home", "niza", "brizo", "atenas", "aura", "micenas", "trani", "ares", "astoria", "eta", "lota", "amantia"];

function score(catalogo: string, cand: string): { pts: number; medidaChoca: boolean; tipoChoca: boolean } {
  const a = tokens(catalogo);
  const b = tokens(cand);
  const setB = new Set(b);
  let pts = 0;
  for (const t of a) {
    if (!setB.has(t)) continue;
    if (LINEAS.includes(t)) pts += 3;
    else if (COLORES.includes(t)) pts += 2;
    else pts += 1;
  }
  // Las medidas mandan: si las dos las declaran y no comparten ninguna, es otro
  // producto por más que el resto del nombre coincida.
  const ma = medidas(catalogo);
  const mb = medidas(cand);
  const medidaChoca = ma.length > 0 && mb.length > 0 && !ma.some((m) => mb.includes(m));
  if (!medidaChoca && ma.length > 0 && ma.some((m) => mb.includes(m))) pts += 4;
  // Tipos distintos = productos distintos, por más que el resto calce.
  const ta = tipoDe(catalogo);
  const tb = tipoDe(cand);
  const tipoChoca = ta != null && tb != null && ta !== tb;
  if (!tipoChoca && ta != null && ta === tb) pts += 4;
  return { pts, medidaChoca, tipoChoca };
}

async function buscar(texto: string): Promise<Cand[]> {
  const api = `https://www.mk.cl/api/catalog_system/pub/products/search?ft=${encodeURIComponent(texto)}&_from=0&_to=15`;
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (res.status !== 200 && res.status !== 206) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];
    return data.flatMap((p) => {
      const co = ((p["items"] as Array<Record<string, unknown>> | undefined)?.[0]?.["sellers"] as Array<Record<string, unknown>> | undefined)?.[0]?.["commertialOffer"] as Record<string, unknown> | undefined;
      if (!co) return [];
      return [{
        nombre: String(p["productName"] ?? ""),
        link: `https://www.mk.cl/${String(p["linkText"] ?? "")}/p`,
        lista: Math.round(Number(co["ListPrice"]) || 0),
        venta: Math.round(Number(co["Price"]) || 0),
      }];
    });
  } catch { return []; }
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, listPrice: true, referenceLink: true, subcategory: true },
    orderBy: { name: "asc" },
  });

  // Los que no tienen precio de internet: sin link, o con el link caído.
  const objetivo: Array<{ c: (typeof cats)[number]; motivo: string }> = [];
  for (const c of cats) {
    if (!c.referenceLink) { objetivo.push({ c, motivo: "sin link" }); continue; }
    const web = await leerPrecioWeb(c.referenceLink);
    if (!web) objetivo.push({ c, motivo: "link caído" });
  }
  console.log(`\nProductos a buscar en MK: ${objetivo.length}\n`);

  const seguros: string[] = [];
  const revisar: string[] = [];
  const nada: string[] = [];

  for (const { c, motivo } of objetivo) {
    // Dos búsquedas: uuna con las palabras fuertes y otra con el nombre entero.
    const fuertes = tokens(c.name).filter((t) => LINEAS.includes(t) || COLORES.includes(t) || /^\d+$/.test(t));
    const consultas = [tokens(c.name).slice(0, 4).join(" ")];
    if (fuertes.length) consultas.push(fuertes.join(" "));
    const vistos = new Map<string, Cand>();
    for (const q of consultas) {
      for (const cand of await buscar(q)) vistos.set(cand.link, cand);
    }

    const puntuados = [...vistos.values()]
      .map((cand) => ({ cand, ...score(c.name, cand.nombre) }))
      .filter((x) => !x.medidaChoca && !x.tipoChoca)
      .sort((a, b) => b.pts - a.pts);

    if (puntuados.length === 0) {
      nada.push(`${c.name}  (${motivo})`);
      continue;
    }
    const mejor = puntuados[0];
    const precioCalza = c.listPrice > 0 &&
      (Math.abs(mejor.cand.lista - c.listPrice) <= 2 || Math.abs(mejor.cand.venta - c.listPrice) <= 2);
    // Seguro: mucho parecido de nombre, y nadie más cerca.
    const segundo = puntuados[1]?.pts ?? 0;
    // Seguro = coincide el TIPO, y además mucho parecido de nombre con nadie
    // más cerca (o el precio calzando).
    const tipoIgual = tipoDe(c.name) != null && tipoDe(c.name) === tipoDe(mejor.cand.nombre);
    const esSeguro = tipoIgual && mejor.pts >= 9 && (mejor.pts - segundo >= 3 || precioCalza);

    const linea =
      `${c.name}\n      ${motivo} · guardado ${CLP(c.listPrice)}\n` +
      `      → ${mejor.cand.nombre}\n` +
      `        ${CLP(mejor.cand.lista)} lista · ${CLP(mejor.cand.venta)} venta${precioCalza ? "  ← el precio calza" : ""}\n` +
      `        ${mejor.cand.link}` +
      (puntuados[1] ? `\n      (otro parecido: ${puntuados[1].cand.nombre.slice(0, 50)})` : "");
    (esSeguro ? seguros : revisar).push(linea);
  }

  console.log("═══ MATCH CLARO — se pueden cargar ═══\n");
  if (!seguros.length) console.log("  (ninguno)");
  for (const l of seguros) console.log(`  · ${l}\n`);

  console.log("\n═══ HAY CANDIDATO PERO CONVIENE MIRARLO ═══\n");
  if (!revisar.length) console.log("  (ninguno)");
  for (const l of revisar) console.log(`  · ${l}\n`);

  console.log("\n═══ NO APARECE NADA PARECIDO EN MK ═══\n");
  if (!nada.length) console.log("  (ninguno)");
  for (const l of nada) console.log(`  · ${l}`);

  console.log(`\n\nRESUMEN: ${seguros.length} claros · ${revisar.length} a mirar · ${nada.length} sin resultados`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
