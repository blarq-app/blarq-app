/**
 * Links de MK: pasa los links guardados al link NUEVO del mismo producto, en el
 * CATÁLOGO y en las líneas de cotizaciones en BORRADOR.
 *
 * Por qué (2026-09-27): MK cambió el link de todos sus productos y deja una
 * redirección desde el viejo:
 *   https://www.mk.cl/acc080034-pro-asis-stapa-cr-accesorios/p
 *     → 301 → https://www.mk.cl/acc080034-accesorios-klipen-asis/p
 * Desde el PR #455 la app sigue esa redirección para leer precio y foto, así que
 * con el link viejo ya funciona. Pasar al link nuevo es para no depender de que
 * MK mantenga las redirecciones para siempre, y para que cada lectura haga un
 * viaje a MK en vez de cuatro.
 *
 * Toca UN SOLO campo: `referenceLink`. Nunca precio, descuento, foto ni marcas.
 * El link no sale en el PDF del cliente: la app lo usa para leer la tienda.
 * Solo toca:
 *   - productos del catálogo,
 *   - líneas de cotizaciones en BORRADOR.
 * Las enviadas / aprobadas / rechazadas NO se tocan.
 *
 * Un link se cambia SOLO si:
 *   - MK lo redirige a otra página de producto de mk.cl (…/p),
 *   - el link nuevo empieza con el MISMO código que el viejo (acc080034),
 *   - y la página nueva abre (200).
 * Queda EXACTAMENTE el link al que redirige MK. Los que no cumplen quedan como
 * están y salen listados (productos que MK dio de baja, links raros).
 *
 * Uso:
 *   npx tsx scripts/fix-mk-links-nuevos.ts <ruta-env>             (dry-run: no escribe)
 *   npx tsx scripts/fix-mk-links-nuevos.ts <ruta-env> --aplicar   (respalda y escribe)
 *
 * Con `--aplicar`, ANTES de escribir guarda en backups/ el link viejo de cada
 * fila que va a cambiar (ya se perdieron links correctos por no respaldar).
 * Cada escritura exige que la fila siga con el link viejo (y la línea, en
 * borrador): si algo cambió desde que se miró, no se pisa.
 *
 * MK corta si se le pega muy seguido: va de a un link y con pausas.
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa (con dotenv leería la base VIEJA, CLAUDE.md §4.9).
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath || envPath.startsWith("--")) {
  console.error("Uso: npx tsx scripts/fix-mk-links-nuevos.ts <ruta-env> [--aplicar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");

const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const esMk = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, "") === "mk.cl";
  } catch {
    return false;
  }
};
// "…/acc080034-pro-asis-stapa-cr-accesorios/p" → "acc080034"
const codigoDe = (link: string) =>
  (new URL(link).pathname.replace(/\/+$/, "").replace(/\/p$/i, "").split("/").filter(Boolean).pop() ?? "")
    .split("-")[0]
    .toLowerCase();

// Si MK no contesta (corte de red, timeout) se reintenta una vez: en la
// primera corrida un link sano quedó afuera por un corte de un segundo.
async function head(link: string, intento = 1): Promise<{ status: number | null; location: string | null }> {
  try {
    const r = await fetch(link, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    return { status: r.status, location: r.headers.get("location") };
  } catch {
    if (intento === 1) {
      await pausa(2000);
      return head(link, 2);
    }
    return { status: null, location: null };
  }
}

type Veredicto = { nuevo: string } | { motivo: string };

// ¿A qué link nuevo pasa este link? Una sola redirección, que es lo que hace MK.
async function linkNuevo(link: string): Promise<Veredicto> {
  const h = await head(link);
  if (h.status === 200) return { motivo: "ya es el link vigente" };
  if (h.status === 404) return { motivo: "MK dio de baja el producto (404)" };
  if (!h.status || h.status < 300 || h.status >= 400 || !h.location) {
    return { motivo: `respuesta inesperada de MK (${h.status ?? "sin respuesta"})` };
  }
  const destino = new URL(h.location, link).href;
  if (!esMk(destino) || !/\/p\/?$/i.test(new URL(destino).pathname)) {
    return { motivo: `redirige a algo que no es un producto: ${destino}` };
  }
  if (codigoDe(destino) !== codigoDe(link)) {
    return { motivo: `redirige a otro código (${codigoDe(destino)}): ${destino}` };
  }
  await pausa(300);
  const h2 = await head(destino);
  if (h2.status !== 200) return { motivo: `la página nueva no abre (${h2.status ?? "sin respuesta"}): ${destino}` };
  return { nuevo: destino };
}

interface Fila {
  tabla: "catalogo" | "cotizacion";
  id: string;
  nombre: string;
  donde: string;
  linkViejo: string;
  linkNuevo: string | null;
  motivo: string | null;
}

async function main() {
  const host = url!.match(/@([^/.]+)/)?.[1];
  console.log(`=== BASE: ${host} · ${aplicar ? "APLICAR (escribe)" : "DRY-RUN (no escribe)"} ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name ?? "(no existe)"}\n`);

  const cat = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { contains: "mk.cl" } },
    select: { id: true, name: true, referenceLink: true },
    orderBy: { name: "asc" },
  });
  const lineas = await prisma.artefactoItem.findMany({
    where: { referenceLink: { contains: "mk.cl" }, budgetVersion: { status: "borrador" } },
    select: {
      id: true,
      name: true,
      referenceLink: true,
      budgetVersion: { select: { version: true, project: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });
  const filas: Fila[] = [
    ...cat.map((c) => ({ tabla: "catalogo" as const, id: c.id, nombre: c.name, donde: "Catálogo", linkViejo: c.referenceLink!, linkNuevo: null, motivo: null })),
    ...lineas.map((l) => ({
      tabla: "cotizacion" as const,
      id: l.id,
      nombre: l.name,
      donde: `${l.budgetVersion.project.name} ${l.budgetVersion.version}`,
      linkViejo: l.referenceLink!,
      linkNuevo: null,
      motivo: null,
    })),
  ].filter((f) => esMk(f.linkViejo));

  const distintos = [...new Set(filas.map((f) => f.linkViejo))];
  console.log(`Con link de MK: catálogo ${filas.filter((f) => f.tabla === "catalogo").length}, borradores ${filas.filter((f) => f.tabla === "cotizacion").length} · links distintos: ${distintos.length}`);
  const veredicto = new Map<string, Veredicto>();
  for (let i = 0; i < distintos.length; i++) {
    process.stdout.write(`  consultando MK: ${i + 1}/${distintos.length}\r`);
    veredicto.set(distintos[i], await linkNuevo(distintos[i]));
    await pausa(300);
  }
  console.log();
  for (const f of filas) {
    const v = veredicto.get(f.linkViejo)!;
    if ("nuevo" in v) f.linkNuevo = v.nuevo;
    else f.motivo = v.motivo;
  }

  const cambian = filas.filter((f) => f.linkNuevo);
  const quedan = filas.filter((f) => !f.linkNuevo);
  const linea = "=".repeat(100);
  console.log(`${linea}\nPASAN AL LINK NUEVO: ${cambian.length} (catálogo ${cambian.filter((f) => f.tabla === "catalogo").length}, borradores ${cambian.filter((f) => f.tabla === "cotizacion").length})\n${linea}`);
  for (const f of cambian) console.log(`  [${f.donde}] ${f.nombre}\n      ${f.linkViejo}\n   →  ${f.linkNuevo}`);
  console.log(`\n${linea}\nQUEDAN COMO ESTÁN: ${quedan.length}\n${linea}`);
  for (const f of quedan) console.log(`  [${f.donde}] ${f.nombre} — ${f.motivo}\n      ${f.linkViejo}`);

  if (!aplicar) {
    console.log("\nDRY-RUN: no se escribió nada. Para aplicar: --aplicar");
    return;
  }
  if (cambian.length === 0) {
    console.log("\nNada que aplicar.");
    return;
  }

  // Respaldo ANTES de escribir.
  mkdirSync("backups", { recursive: true });
  const respaldo = `backups/links-mk-antes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    respaldo,
    JSON.stringify(
      {
        base: host,
        fecha: new Date().toISOString(),
        nota: "Links (referenceLink) que tenían estas filas antes de fix-mk-links-nuevos.ts. Para volver atrás: poner linkViejo en referenceLink de cada id.",
        filas: cambian.map(({ tabla, id, nombre, donde, linkViejo, linkNuevo }) => ({ tabla, id, nombre, donde, linkViejo, linkNuevo })),
      },
      null,
      2
    )
  );
  console.log(`\nRespaldo: ${respaldo}`);

  let hechas = 0;
  const saltadas: Fila[] = [];
  for (const f of cambian) {
    const r =
      f.tabla === "catalogo"
        ? await prisma.artefactoCatalog.updateMany({
            where: { id: f.id, referenceLink: f.linkViejo },
            data: { referenceLink: f.linkNuevo! },
          })
        : await prisma.artefactoItem.updateMany({
            where: { id: f.id, referenceLink: f.linkViejo, budgetVersion: { status: "borrador" } },
            data: { referenceLink: f.linkNuevo! },
          });
    if (r.count === 1) hechas++;
    else saltadas.push(f);
  }
  console.log(`Escritos: ${hechas} de ${cambian.length}`);
  for (const f of saltadas) console.log(`  SALTADO (cambió desde que se miró): [${f.donde}] ${f.nombre}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
