/**
 * Busca en la tienda los productos del catálogo que quedaron SIN link o con el
 * link muerto, para que ninguna línea quede "descolgada de internet" (pedido de
 * MJ, 2026-08-02). SOLO LECTURA: propone candidatos, no escribe nada.
 *
 *   npx tsx scripts/diag-buscar-links-faltantes.ts
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

interface Candidato {
  nombre: string;
  link: string;
  lista: number;
  venta: number;
}

// Búsqueda de texto en la tienda VTEX de MK.
async function buscarEnMk(texto: string): Promise<Candidato[]> {
  const api = `https://www.mk.cl/api/catalog_system/pub/products/search?ft=${encodeURIComponent(texto)}&_from=0&_to=5`;
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    // VTEX responde 200 o 206 (contenido parcial) — las dos traen datos.
    if (res.status !== 200 && res.status !== 206) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];
    return data.flatMap((p) => {
      const items = p["items"] as Array<Record<string, unknown>> | undefined;
      const co = (items?.[0]?.["sellers"] as Array<Record<string, unknown>> | undefined)?.[0]?.[
        "commertialOffer"
      ] as Record<string, unknown> | undefined;
      if (!co) return [];
      return [{
        nombre: String(p["productName"] ?? ""),
        link: `https://www.mk.cl/${String(p["linkText"] ?? "")}/p`,
        lista: Math.round(Number(co["ListPrice"]) || 0),
        venta: Math.round(Number(co["Price"]) || 0),
      }];
    });
  } catch {
    return [];
  }
}

// Términos de búsqueda a partir del nombre: se sacan las palabras cortas y se
// deja lo distintivo (línea, medida, color).
function terminos(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/[^\wáéíóúñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["con", "sin", "para", "del", "los", "las"].includes(w))
    .slice(0, 5)
    .join(" ");
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, listPrice: true, discountPercent: true, referenceLink: true },
  });

  const rotos: Array<{ name: string; motivo: string; listPrice: number }> = [];
  for (const c of cats) {
    if (!c.referenceLink) {
      rotos.push({ name: c.name, motivo: "sin link", listPrice: c.listPrice });
      continue;
    }
    const web = await leerPrecioWeb(c.referenceLink);
    if (!web) rotos.push({ name: c.name, motivo: "el link no responde", listPrice: c.listPrice });
  }

  console.log(`\nProductos del catálogo descolgados de internet: ${rotos.length}\n`);
  for (const r of rotos) {
    console.log(`── ${r.name}`);
    console.log(`   ${r.motivo} · precio guardado ${CLP(r.listPrice)}`);
    const cands = await buscarEnMk(terminos(r.name));
    if (cands.length === 0) {
      console.log("   no aparece en la búsqueda de MK (puede ser de otra tienda o estar descontinuado)\n");
      continue;
    }
    console.log("   candidatos en mk.cl:");
    for (const c of cands.slice(0, 3)) {
      const marca = Math.abs(c.venta - r.listPrice) <= 2 || Math.abs(c.lista - r.listPrice) <= 2 ? "  ← el precio calza" : "";
      console.log(`     · ${c.nombre.slice(0, 56)}`);
      console.log(`       lista ${CLP(c.lista)} · venta ${CLP(c.venta)}${marca}`);
      console.log(`       ${c.link}`);
    }
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
