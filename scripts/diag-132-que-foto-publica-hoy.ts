// Diagnóstico SOLO LECTURA: para las entradas del catálogo cuya foto está rota
// o vacía, ¿de qué tienda son y qué foto publica hoy esa página? Sirve para
// decidir por dónde entra la foto nueva (API de VTEX vs scraper de og:image).
//
// No escribe nada. Uso: npx tsx scripts/diag-132-que-foto-publica-hoy.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { fetchArtefactoData } from "../src/lib/catalog/fetchArtefactoData";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) process.exit(1);
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function cargaComoImagen(u: string): Promise<boolean> {
  try {
    const r = await fetch(u, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
      signal: AbortSignal.timeout(15000),
    });
    return r.ok && (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

// La API pública de catálogo de VTEX trae la foto junto con el precio.
async function fotoVtex(link: string): Promise<string | null> {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    const slug = u.pathname.replace(/\/+$/, "").replace(/\/p$/i, "").split("/").filter(Boolean).pop();
    if (!slug) return null;
    const r = await fetch(
      `https://www.${host}/api/catalog_system/pub/products/search/${slug}/p`,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return null;
    const d = (await r.json()) as Array<Record<string, unknown>>;
    const items = d?.[0]?.["items"] as Array<Record<string, unknown>> | undefined;
    const imgs = items?.[0]?.["images"] as Array<Record<string, unknown>> | undefined;
    const first = imgs?.[0]?.["imageUrl"];
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== HOST:", url!.match(/@([^/.]+)/)?.[1], "===\n");

  const cat = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, brand: true, imageUrl: true, referenceLink: true },
    orderBy: { name: "asc" },
  });

  // Candidatos: tienen link y (no tienen foto o la que tienen no carga).
  const conLink = cat.filter((a) => a.referenceLink);
  const candidatos: typeof conLink = [];
  for (const a of conLink) {
    if (!a.imageUrl) { candidatos.push(a); continue; }
    if (a.imageUrl.startsWith("data:")) continue; // embebida, siempre carga
    if (!(await cargaComoImagen(a.imageUrl))) candidatos.push(a);
  }

  console.log(`Candidatos (link + foto rota o vacía): ${candidatos.length}\n`);
  console.log("=".repeat(100));

  for (const a of candidatos) {
    const link = a.referenceLink!;
    const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return "?"; } })();
    const porScraper = (await fetchArtefactoData(link))?.imageUrl ?? null;
    const porVtex = await fotoVtex(link);
    console.log(`\n${a.name}  (${a.brand ?? "—"})  [${host}]`);
    console.log(`  guardada : ${a.imageUrl ? a.imageUrl.slice(0, 80) : "NO TIENE"}`);
    console.log(`  scraper  : ${porScraper ? porScraper.slice(0, 80) : "— (la página no publica og:image/JSON-LD)"}`);
    console.log(`  API vtex : ${porVtex ? porVtex.slice(0, 80) : "—"}`);
    const nueva = porVtex ?? porScraper;
    if (nueva) console.log(`  ¿la nueva carga? ${(await cargaComoImagen(nueva)) ? "SÍ" : "NO"}`);
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
