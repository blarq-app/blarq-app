// Diagnóstico SOLO LECTURA (pendiente 139): muestra cómo quedaría cada nombre
// del catálogo de herrajes y de las líneas ya cargadas en cotizaciones al
// aplicarles el estilo oración. NO escribe nada.
//
// Uso: npx tsx scripts/diag-139-nombres-herrajes.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { formatHerrajeName } from "../src/lib/presupuesto/herrajeNombre";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

// Clasifica el estilo con el que está escrito hoy un nombre.
function estilo(s: string): string {
  const letras = s.replace(/[^\p{L}]/gu, "");
  if (!letras) return "—";
  if (letras === letras.toUpperCase()) return "MAYÚSCULA";
  const palabras = s.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const conMayus = palabras.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (conMayus >= 2 && conMayus >= palabras.length - 1) return "Title Case";
  return "oración";
}

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador base viva — proyecto #64:", p64?.name ?? "(no existe)");
  console.log("");

  const cat = await prisma.herrajeCatalog.findMany({
    orderBy: [{ supplier: "asc" }, { category: "asc" }, { name: "asc" }],
    select: { name: true, supplier: true, category: true },
  });

  const conteo: Record<string, number> = {};
  const cambian: { antes: string; despues: string }[] = [];
  const raros: { antes: string; despues: string; motivo: string }[] = [];

  console.log(`── CATÁLOGO DE HERRAJES (${cat.length} nombres) ──`);
  let prov = "";
  for (const h of cat) {
    if (h.supplier !== prov) {
      prov = h.supplier;
      console.log(`\n  ${prov}`);
    }
    const nuevo = formatHerrajeName(h.name);
    const est = estilo(h.name);
    conteo[est] = (conteo[est] ?? 0) + 1;
    const marca = nuevo === h.name ? "  " : "→ ";
    console.log(`  ${marca}${h.name}`);
    if (nuevo !== h.name) {
      console.log(`      ${nuevo}`);
      cambian.push({ antes: h.name, despues: nuevo });
    }
    // Casos raros = tokens que dejan de leerse como sigla al bajar a minúscula.
    // Se descartan las palabras comunes: si el nombre entero está en MAYÚSCULA
    // todas sus palabras "parecen" sigla, así que ahí solo se miran los tokens
    // que mezclan letra y número (2X33L, 40KG, X10, 5MM) o que son una letra
    // suelta de modelo (MERIVOBOX E / M).
    const todoMayus = h.name === h.name.toUpperCase();
    const tokens = h.name.match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const t of tokens) {
      if (t !== t.toUpperCase()) continue; // no está en mayúscula → no aplica
      const esSiglaClara = todoMayus
        ? /\d/.test(t) || t.length <= 2 // mezcla con número, o letra de modelo
        : t.length <= 4 && !/^\d+$/.test(t); // mayúscula aislada en texto normal
      if (!esSiglaClara) continue;
      if (!nuevo.includes(t)) {
        raros.push({ antes: t, despues: t.toLowerCase(), motivo: h.name });
      }
    }
  }

  console.log("\n── ESTILO ACTUAL DEL CATÁLOGO ──");
  for (const [k, v] of Object.entries(conteo)) console.log(`  ${k}: ${v}`);
  console.log(`  cambian con la homologación: ${cambian.length} de ${cat.length}`);

  // Líneas ya cargadas en cotizaciones.
  const lineas = await prisma.muebleHerraje.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  const conteoL: Record<string, number> = {};
  let cambianL = 0;
  for (const l of lineas) {
    const e = estilo(l.name);
    conteoL[e] = (conteoL[e] ?? 0) + 1;
    if (formatHerrajeName(l.name) !== l.name) cambianL++;
  }
  console.log(`\n── LÍNEAS EN COTIZACIONES (${lineas.length}) ──`);
  for (const [k, v] of Object.entries(conteoL)) console.log(`  ${k}: ${v}`);
  console.log(`  cambian con la homologación: ${cambianL} de ${lineas.length}`);

  if (raros.length) {
    console.log("\n── CASOS RAROS (siglas que se pierden) ──");
    const vistos = new Set<string>();
    for (const r of raros) {
      const k = `${r.antes}→${r.despues}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      console.log(`  ${r.antes} → ${r.despues}   (en: ${r.motivo})`);
    }
  } else {
    console.log("\n── CASOS RAROS: ninguno detectado ──");
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
