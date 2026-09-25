/**
 * Pendiente 186 — ¿Por qué quedaron despegadas del catálogo las líneas de
 * artefactos? SOLO LECTURA: no escribe nada.
 *
 * Mide dos cosas:
 *   1. Casa Los Algarrobos (#65), V4 de artefactos: cada línea despegada
 *      (priceOverridden) con su causa probable, comparando contra el catálogo
 *      de HOY.
 *   2. Todas las cotizaciones de artefactos: cuántas líneas despegadas tienen el
 *      precio IDÉNTICO al del catálogo (lista, descuento y precio al cliente).
 *      Esas son las candidatas a una corrección de datos de una vez — que NO
 *      hace este script.
 *
 * Uso (la ruta del .env va como argumento; NO se carga dotenv, porque el .env
 * de la carpeta apunta a la base vieja):
 *   npx tsx scripts/diag-186-despegados.ts /Users/mjblanco/Desktop/blarq-app/.env.prod
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env como argumento.");
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const EPS_PESO = 1;
const EPS_DCTO = 0.005;
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (d: number | null) => `${Math.round((d ?? 0) * 1000) / 10}%`;

interface Linea {
  id: string;
  name: string;
  room: string;
  quantity: number;
  listPrice: number;
  discountPercent: number | null;
  clientPrice: number;
  catalogId: string | null;
  priceOverridden: boolean;
  discountOverridden: boolean;
  imageUrl: string | null;
}
interface Cat {
  id: string;
  name: string;
  listPrice: number;
  discountPercent: number | null;
  webListPrice: number | null;
  webSalePrice: number | null;
  webCheckedAt: Date | null;
}

type Causa =
  | "sin catálogo"
  | "descuento propio"
  | "idéntico al catálogo"
  | "precio distinto al catálogo";

function clasificar(l: Linea, cat: Cat | undefined): Causa {
  if (!l.catalogId || !cat) return "sin catálogo";
  if (l.discountOverridden) return "descuento propio";
  const catDcto = cat.discountPercent ?? 0;
  const catCliente = cat.listPrice * (1 - catDcto);
  const igual =
    Math.abs(l.listPrice - cat.listPrice) <= EPS_PESO &&
    Math.abs((l.discountPercent ?? 0) - catDcto) <= EPS_DCTO &&
    Math.abs(l.clientPrice - catCliente) <= EPS_PESO;
  return igual ? "idéntico al catálogo" : "precio distinto al catálogo";
}

async function main() {
  console.log(`Base: ${host}`);
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  const ultima = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true },
  });
  console.log(
    `Marcador #64: ${p64?.name ?? "(no existe)"} · última factura ${ultima?.issueDate?.toISOString().slice(0, 10) ?? "-"}\n`
  );

  const cats = await prisma.artefactoCatalog.findMany({
    select: {
      id: true,
      name: true,
      listPrice: true,
      discountPercent: true,
      webListPrice: true,
      webSalePrice: true,
      webCheckedAt: true,
    },
  });
  const catById = new Map(cats.map((c) => [c.id, c]));

  // ── 1. Casa Los Algarrobos, todas sus versiones de artefactos ───────────
  const alg = await prisma.project.findFirst({
    where: { numeroProyecto: 65 },
    select: { id: true, name: true },
  });
  if (!alg) throw new Error("No existe el proyecto #65.");
  const versiones = await prisma.budgetVersion.findMany({
    where: { projectId: alg.id, type: "artefactos" },
    select: { id: true, version: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`#65 ${alg.name} — versiones de artefactos:`);
  for (const v of versiones)
    console.log(`  ${v.version.padEnd(6)} ${v.status.padEnd(10)} ${v.id}`);

  const v4 = versiones.find((v) => /^v?4$/i.test(v.version.trim()));
  if (!v4) throw new Error("No encontré la V4 de artefactos de #65.");
  const lineas: Linea[] = await prisma.artefactoItem.findMany({
    where: { budgetVersionId: v4.id },
    select: {
      id: true,
      name: true,
      room: true,
      quantity: true,
      listPrice: true,
      discountPercent: true,
      clientPrice: true,
      catalogId: true,
      priceOverridden: true,
      discountOverridden: true,
      imageUrl: true,
    },
    orderBy: [{ room: "asc" }, { sortOrder: "asc" }],
  });
  const despegadas = lineas.filter((l) => l.priceOverridden);
  const conDctoPropio = lineas.filter((l) => l.discountOverridden);
  console.log(
    `\nV4 (${v4.status}): ${lineas.length} líneas · ${despegadas.length} despegadas · ${conDctoPropio.length} con descuento propio\n`
  );

  const grupos = new Map<Causa, Linea[]>();
  for (const l of despegadas) {
    const c = clasificar(l, l.catalogId ? catById.get(l.catalogId) : undefined);
    grupos.set(c, [...(grupos.get(c) ?? []), l]);
  }
  for (const [causa, ls] of grupos) {
    let deMas = 0;
    console.log(`── ${causa}: ${ls.length}`);
    for (const l of ls) {
      const cat = l.catalogId ? catById.get(l.catalogId) : undefined;
      const catDcto = cat?.discountPercent ?? 0;
      const catCliente = cat ? cat.listPrice * (1 - catDcto) : null;
      if (catCliente != null) deMas += (l.clientPrice - catCliente) * l.quantity;
      const web =
        cat?.webSalePrice != null
          ? ` · web ${clp(cat.webListPrice ?? 0)}/${clp(cat.webSalePrice)} (${cat.webCheckedAt?.toISOString().slice(0, 10) ?? "-"})`
          : "";
      console.log(
        `   ${l.name.slice(0, 38).padEnd(38)} ${l.room.slice(0, 16).padEnd(16)} x${l.quantity}  ` +
          `línea ${clp(l.listPrice)} · ${pct(l.discountPercent)} · ${clp(l.clientPrice)}` +
          (cat
            ? `  | catálogo ${clp(cat.listPrice)} · ${pct(catDcto)} · ${clp(catCliente!)}${web}`
            : "") +
          (l.discountOverridden ? "  [dcto propio]" : "")
      );
    }
    if (causa !== "sin catálogo")
      console.log(`   Diferencia contra el catálogo de hoy (× cantidad): ${clp(deMas)}\n`);
    else console.log("");
  }

  // Líneas con descuento propio que NO están despegadas (para entender el
  // caso de los Teka).
  const dctoSinDespegar = conDctoPropio.filter((l) => !l.priceOverridden);
  if (dctoSinDespegar.length > 0) {
    console.log(`── con descuento propio pero SIN despegar: ${dctoSinDespegar.length}`);
    for (const l of dctoSinDespegar)
      console.log(`   ${l.name.slice(0, 38).padEnd(38)} ${pct(l.discountPercent)}`);
    console.log("");
  }

  // ── 2. Todas las cotizaciones: despegadas idénticas al catálogo ─────────
  const todas = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    select: {
      id: true,
      version: true,
      status: true,
      project: { select: { numeroProyecto: true, name: true } },
      artefactoItems: {
        where: { priceOverridden: true },
        select: {
          id: true,
          name: true,
          room: true,
          quantity: true,
          listPrice: true,
          discountPercent: true,
          clientPrice: true,
          catalogId: true,
          priceOverridden: true,
          discountOverridden: true,
          imageUrl: true,
        },
      },
    },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }],
  });
  console.log("Todas las cotizaciones de artefactos con líneas despegadas:");
  console.log(
    "  proyecto                              versión  estado      despeg.  idénticas  dcto-propio  sin-cat  distintas"
  );
  const tot = { desp: 0, ident: 0, identBorr: 0, dcto: 0, sin: 0, dist: 0 };
  for (const v of todas) {
    if (v.artefactoItems.length === 0) continue;
    const c = { ident: 0, dcto: 0, sin: 0, dist: 0 };
    for (const l of v.artefactoItems) {
      const k = clasificar(l, l.catalogId ? catById.get(l.catalogId) : undefined);
      if (k === "idéntico al catálogo") c.ident++;
      else if (k === "descuento propio") c.dcto++;
      else if (k === "sin catálogo") c.sin++;
      else c.dist++;
    }
    tot.desp += v.artefactoItems.length;
    tot.ident += c.ident;
    if (v.status === "borrador") tot.identBorr += c.ident;
    tot.dcto += c.dcto;
    tot.sin += c.sin;
    tot.dist += c.dist;
    const nombre = `#${v.project.numeroProyecto ?? "-"} ${v.project.name}`;
    console.log(
      `  ${nombre.slice(0, 36).padEnd(36)}  ${v.version.padEnd(7)}  ${v.status.padEnd(10)}  ` +
        `${String(v.artefactoItems.length).padStart(6)}  ${String(c.ident).padStart(9)}  ${String(c.dcto).padStart(11)}  ${String(c.sin).padStart(7)}  ${String(c.dist).padStart(9)}`
    );
  }
  console.log(
    `\n  TOTAL despegadas ${tot.desp} · idénticas al catálogo ${tot.ident} (en borradores: ${tot.identBorr}) · dcto propio ${tot.dcto} · sin catálogo ${tot.sin} · distintas ${tot.dist}`
  );

  // ── 3. Marcas de "descuento de MJ" perdidas al crear una versión ────────
  // Hasta el 2026-09-25 "Duplicar" copiaba el porcentaje pero no la marca. Se
  // busca, para cada versión con versión madre, la línea equivalente (mismo
  // nombre, ambiente y producto) que en la madre tenía la marca y en la hija
  // no, con el MISMO porcentaje (si MJ lo cambió después, no es una pérdida).
  const hijas = await prisma.budgetVersion.findMany({
    where: { type: "artefactos", parentVersionId: { not: null } },
    select: {
      version: true,
      status: true,
      parentVersionId: true,
      project: { select: { numeroProyecto: true, name: true } },
      artefactoItems: {
        select: { id: true, name: true, room: true, catalogId: true, discountPercent: true, discountOverridden: true, priceOverridden: true },
      },
    },
  });
  console.log("\nMarcas de descuento de MJ perdidas al crear una versión:");
  let perdidas = 0;
  for (const h of hijas) {
    const madre = await prisma.budgetVersion.findUnique({
      where: { id: h.parentVersionId! },
      select: {
        version: true,
        artefactoItems: {
          where: { discountOverridden: true },
          select: { name: true, room: true, catalogId: true, discountPercent: true },
        },
      },
    });
    if (!madre || madre.artefactoItems.length === 0) continue;
    for (const m of madre.artefactoItems) {
      const hija = h.artefactoItems.find(
        (l) =>
          l.name === m.name &&
          l.room === m.room &&
          l.catalogId === m.catalogId &&
          !l.discountOverridden &&
          Math.abs((l.discountPercent ?? 0) - (m.discountPercent ?? 0)) < 0.0005
      );
      if (!hija) continue;
      perdidas++;
      console.log(
        `  #${h.project.numeroProyecto ?? "-"} ${h.project.name} ${madre.version}→${h.version} (${h.status})  ` +
          `${m.name.slice(0, 40).padEnd(40)} ${pct(m.discountPercent)}${hija.priceOverridden ? "  [además no sigue al catálogo]" : ""}  ${hija.id}`
      );
    }
  }
  console.log(`  TOTAL: ${perdidas}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
