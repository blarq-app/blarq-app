/**
 * Cajón de fotos (2026-09-27) — foto de control. SOLO LECTURA.
 *
 * La pasada única (`fotos-guardar-copias.ts`) solo puede cambiar la FOTO de
 * cada fila. Este script lo prueba: saca una huella de TODO lo demás (precios,
 * cantidades, nombres, marcas, links, la foto de lo enviado sin sus fotos) de
 * las líneas de artefactos, el catálogo de artefactos, el de herrajes y las
 * versiones. Se corre antes y después y se comparan con `diff`: si algo
 * distinto de una foto se movió, la huella cambia.
 *
 * Además cuenta cómo están guardadas las fotos (vacía / copia en la app /
 * subida a mano / link de tienda), que es lo que SÍ debe cambiar.
 *
 *   npx tsx scripts/diag-fotos-huella.ts <ruta-env> > antes.txt
 *
 * No carga dotenv a propósito: el .env de la carpeta apunta a la base vieja.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env como argumento.");
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
const prisma = new PrismaClient({ datasources: { db: { url } } });

// JSON estable, sin ninguna clave `imageUrl` (en cualquier nivel) ni
// `updatedAt` (lo toca cualquier guardado, aunque solo cambie la foto).
function sinFotos(x: unknown): string {
  return JSON.stringify(x, (k, v) => {
    if (k === "imageUrl" || k === "updatedAt") return undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}
const huella = (filas: unknown[]) => createHash("sha256").update(sinFotos(filas)).digest("hex").slice(0, 16);

function tipos(fotos: (string | null)[]) {
  const c = { vacia: 0, copia: 0, subida: 0, link: 0 };
  for (const f of fotos) {
    if (!f) c.vacia++;
    else if (f.startsWith("/api/fotos/")) c.copia++;
    else if (f.startsWith("data:")) c.subida++;
    else c.link++;
  }
  return `vacías ${c.vacia} · copias ${c.copia} · subidas a mano ${c.subida} · links de tienda ${c.link}`;
}

async function main() {
  console.log(`Base: ${url!.match(/@([^/.:]+)/)?.[1] ?? "?"}`);
  const lineas = await prisma.artefactoItem.findMany({ orderBy: { id: "asc" } });
  const catalogo = await prisma.artefactoCatalog.findMany({ orderBy: { id: "asc" } });
  const herrajes = await prisma.herrajeCatalog.findMany({ orderBy: { id: "asc" } });
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    orderBy: { id: "asc" },
  });
  console.log(`Líneas de artefactos (${lineas.length}): huella ${huella(lineas)}`);
  console.log(`Catálogo de artefactos (${catalogo.length}): huella ${huella(catalogo)}`);
  console.log(`Catálogo de herrajes (${herrajes.length}): huella ${huella(herrajes)}`);
  console.log(`Versiones de artefactos (${versiones.length}), con su foto de lo enviado: huella ${huella(versiones)}`);
  // Total al cliente y costo, por si alguien quiere el número y no la huella.
  const total = lineas.reduce((s, l) => s + l.clientPrice * l.quantity, 0);
  const costo = lineas.reduce((s, l) => s + (l.realCostBlarq ?? 0) * l.quantity, 0);
  console.log(`Total al cliente (todas las líneas): $${Math.round(total).toLocaleString("es-CL")} · costo BLARQ: $${Math.round(costo).toLocaleString("es-CL")}`);
  console.log("");
  console.log(`Fotos de líneas: ${tipos(lineas.map((l) => l.imageUrl))}`);
  console.log(`Fotos del catálogo: ${tipos(catalogo.map((c) => c.imageUrl))}`);
  console.log(`Fotos de herrajes: ${tipos(herrajes.map((h) => h.imageUrl))}`);
  const enEnviados = versiones.flatMap(
    (v) => ((v.sentSnapshot as { artefactoItems?: { imageUrl: string | null }[] } | null)?.artefactoItems ?? []).map((i) => i.imageUrl)
  );
  console.log(`Fotos en "Volver a lo enviado": ${tipos(enEnviados)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
