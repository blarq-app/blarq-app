/**
 * Diagnóstico SOLO LECTURA para decidir cómo guardar una COPIA de las fotos de
 * artefactos en vez del link (2026-09-27).
 *
 * MJ: "de repente se me desaparecían las fotos en una cotización". La app
 * guarda en `imageUrl` el LINK a la foto en el servidor de la tienda; cuando la
 * tienda cambia sus fotos el link muere (404) y la foto desaparece. Antes de
 * proponer dónde guardar la copia hay que saber cuántas fotos son, cuántas
 * están muertas, en qué cotizaciones, y cuánto pesarían copiadas.
 *
 * Qué mide (no escribe NADA, ni en la base ni en la web):
 *   1. fotos por tabla (líneas de cotización, catálogo, herrajes) y por estado
 *      de la cotización: vacías / subidas a mano (data:) / link;
 *   2. cada link distinto: si carga hoy, su peso original y el peso de una
 *      miniatura de 600 px (el mismo tamaño que ya usa la subida a mano);
 *   3. cuántas fotos muertas se pueden recuperar HOY desde la tienda
 *      (`leerFotoWeb`, que desde el arreglo de los links de MK sigue la
 *      redirección al link nuevo);
 *   4. las fotos guardadas en la "foto de lo enviado" (sentSnapshot), que es lo
 *      que repone "Volver a lo enviado";
 *   5. el tamaño de la base y de los PDFs del SII que ya viven en ella, para
 *      comparar.
 *
 * Uso: npx tsx scripts/diag-fotos-copia-analisis.ts <ruta-env> [--json <salida.json>]
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa (con dotenv leería la base VIEJA, CLAUDE.md §4.9).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";
import sharp from "sharp";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Uso: npx tsx scripts/diag-fotos-copia-analisis.ts <ruta-env> [--json salida.json]");
  process.exit(1);
}
const jsonIdx = process.argv.indexOf("--json");
const jsonPath = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;

const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1].trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type Tipo = "vacia" | "data" | "link";
const tipoDe = (u: string | null | undefined): Tipo =>
  !u ? "vacia" : u.startsWith("data:") ? "data" : "link";

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

interface Prueba {
  url: string;
  status: number | "error";
  esImagen: boolean;
  bytes: number;
  ancho?: number;
  alto?: number;
  formato?: string;
  bytesMini?: number; // miniatura 600px JPEG q80 (lo que ya hace la subida a mano)
  bytesMiniWebp?: number; // idem en WebP q80
}

// Baja la foto entera (no HEAD: VTEX no siempre manda content-length) y mide.
async function probar(u: string): Promise<Prueba> {
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const ct = r.headers.get("content-type") ?? "";
    if (!r.ok || !ct.startsWith("image/")) {
      return { url: u, status: r.status, esImagen: false, bytes: 0 };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const p: Prueba = { url: u, status: r.status, esImagen: true, bytes: buf.length };
    try {
      const meta = await sharp(buf).metadata();
      p.ancho = meta.width;
      p.alto = meta.height;
      p.formato = meta.format;
      const base = sharp(buf).rotate().resize(600, 600, { fit: "inside", withoutEnlargement: true });
      // Fondo blanco: las PNG con transparencia se ven igual en la tabla y el PDF.
      p.bytesMini = (await base.clone().flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer()).length;
      p.bytesMiniWebp = (await base.clone().webp({ quality: 80 }).toBuffer()).length;
    } catch {
      // formato raro (svg, avif sin soporte): queda solo el peso original
    }
    return p;
  } catch {
    return { url: u, status: "error", esImagen: false, bytes: 0 };
  }
}

async function enLotes<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return out;
}

const hostDe = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
};

async function main() {
  console.log(`=== BASE: ${host} · SOLO LECTURA ===`);
  if (!host.startsWith("ep-shy-morning")) console.log("  (OJO: esta NO es la base viva)");

  // ── 1. Qué hay guardado ────────────────────────────────────────────────
  const items = await prisma.artefactoItem.findMany({
    select: {
      id: true, name: true, detail: true, imageUrl: true, referenceLink: true, catalogId: true,
      budgetVersion: {
        select: {
          id: true, version: true, status: true, sentAt: true,
          project: { select: { name: true, numeroProyecto: true, status: true } },
        },
      },
    },
  });
  const catalogo = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, imageUrl: true, referenceLink: true, supplier: true },
  });
  const herrajes = await prisma.herrajeCatalog.findMany({ select: { id: true, imageUrl: true } });
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    select: {
      id: true, version: true, status: true, sentAt: true,
      sentSnapshot: true,
      project: { select: { name: true, numeroProyecto: true } },
      _count: { select: { artefactoItems: true } },
    },
  });

  const cuenta = (xs: { imageUrl: string | null }[]) => {
    const c = { vacia: 0, data: 0, link: 0 };
    for (const x of xs) c[tipoDe(x.imageUrl)]++;
    return c;
  };
  console.log(`\nLíneas de cotización de artefactos: ${items.length}`, cuenta(items));
  const porEstado = new Map<string, typeof items>();
  for (const it of items) {
    const k = it.budgetVersion.status;
    porEstado.set(k, [...(porEstado.get(k) ?? []), it]);
  }
  for (const [k, xs] of porEstado) console.log(`  ${k.padEnd(10)} ${String(xs.length).padStart(4)}`, cuenta(xs));
  console.log(`Catálogo de artefactos: ${catalogo.length}`, cuenta(catalogo));
  console.log(`Catálogo de herrajes: ${herrajes.length}`, cuenta(herrajes));

  const datas = [...items, ...catalogo, ...herrajes].filter((x) => tipoDe(x.imageUrl) === "data");
  if (datas.length) {
    const largos = datas.map((x) => x.imageUrl!.length);
    console.log(
      `Fotos subidas a mano (data:): ${datas.length} · promedio ${kb(largos.reduce((a, b) => a + b, 0) / largos.length)} · máx ${kb(Math.max(...largos))} (texto base64)`,
    );
  }

  // Fotos en la "foto de lo enviado"
  let snapLineas = 0;
  const snapUrls: string[] = [];
  let snapDistintaDeLaLinea = 0;
  for (const v of versiones) {
    const snap = v.sentSnapshot as { artefactoItems?: { imageUrl: string | null; name: string }[] } | null;
    if (!snap?.artefactoItems) continue;
    for (const s of snap.artefactoItems) {
      snapLineas++;
      if (tipoDe(s.imageUrl) === "link") snapUrls.push(s.imageUrl!);
    }
  }
  const actualesPorVersion = new Map<string, Set<string>>();
  for (const it of items) {
    const set = actualesPorVersion.get(it.budgetVersion.id) ?? new Set<string>();
    if (it.imageUrl) set.add(it.imageUrl);
    actualesPorVersion.set(it.budgetVersion.id, set);
  }
  for (const v of versiones) {
    const snap = v.sentSnapshot as { artefactoItems?: { imageUrl: string | null }[] } | null;
    if (!snap?.artefactoItems) continue;
    const act = actualesPorVersion.get(v.id) ?? new Set();
    for (const s of snap.artefactoItems) if (s.imageUrl && !act.has(s.imageUrl)) snapDistintaDeLaLinea++;
  }
  const conFoto = versiones.filter((v) => v.sentSnapshot != null);
  console.log(
    `\nVersiones de artefactos: ${versiones.length} · con "foto de lo enviado": ${conFoto.length} · líneas en esas fotos: ${snapLineas} · fotos de ahí que ya no coinciden con la línea: ${snapDistintaDeLaLinea}`,
  );

  // ── 2. Probar cada link distinto ────────────────────────────────────────
  const todas = new Set<string>();
  for (const x of [...items, ...catalogo, ...herrajes]) if (tipoDe(x.imageUrl) === "link") todas.add(x.imageUrl!);
  for (const u of snapUrls) todas.add(u);
  const lista = [...todas];
  console.log(`\nLinks de foto distintos (líneas + catálogo + herrajes + fotos de lo enviado): ${lista.length}`);
  const porHost = new Map<string, number>();
  for (const u of lista) porHost.set(hostDe(u), (porHost.get(hostDe(u)) ?? 0) + 1);
  console.log("  por servidor:", Object.fromEntries([...porHost].sort((a, b) => b[1] - a[1])));

  const pruebas = await enLotes(lista, 8, probar);
  const estado = new Map(pruebas.map((p) => [p.url, p]));
  const vivas = pruebas.filter((p) => p.esImagen);
  const muertas = pruebas.filter((p) => !p.esImagen);
  console.log(`  cargan hoy: ${vivas.length} · NO cargan: ${muertas.length}`);
  const muertasPorHost = new Map<string, number>();
  for (const p of muertas) muertasPorHost.set(hostDe(p.url), (muertasPorHost.get(hostDe(p.url)) ?? 0) + 1);
  console.log("  muertas por servidor:", Object.fromEntries(muertasPorHost));
  console.log("  códigos de las muertas:", Object.fromEntries(
    [...muertas.reduce((m, p) => m.set(String(p.status), (m.get(String(p.status)) ?? 0) + 1), new Map<string, number>())],
  ));

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const orig = vivas.map((p) => p.bytes);
  const mini = vivas.filter((p) => p.bytesMini).map((p) => p.bytesMini!);
  const miniW = vivas.filter((p) => p.bytesMiniWebp).map((p) => p.bytesMiniWebp!);
  console.log(`\nPeso de las ${vivas.length} fotos vivas:`);
  console.log(`  originales: total ${mb(sum(orig))} · promedio ${kb(sum(orig) / orig.length)} · máx ${kb(Math.max(...orig))}`);
  console.log(`  miniatura 600px JPEG: total ${mb(sum(mini))} · promedio ${kb(sum(mini) / mini.length)} · máx ${kb(Math.max(...mini))}`);
  console.log(`  miniatura 600px WebP: total ${mb(sum(miniW))} · promedio ${kb(sum(miniW) / miniW.length)}`);
  const dims = vivas.filter((p) => p.ancho).map((p) => `${p.ancho}x${p.alto}`);
  const dimCount = new Map<string, number>();
  for (const d of dims) dimCount.set(d, (dimCount.get(d) ?? 0) + 1);
  console.log("  tamaños más comunes:", [...dimCount].sort((a, b) => b[1] - a[1]).slice(0, 6));
  const formatos = new Map<string, number>();
  for (const p of vivas) formatos.set(p.formato ?? "?", (formatos.get(p.formato ?? "?") ?? 0) + 1);
  console.log("  formatos:", Object.fromEntries(formatos));

  // Guardado "una vez por foto" vs "una vez por línea": cuántas líneas comparten foto.
  const lineasConLink = items.filter((it) => tipoDe(it.imageUrl) === "link");
  const distintasEnLineas = new Set(lineasConLink.map((it) => it.imageUrl!)).size;
  console.log(
    `\nLíneas con link: ${lineasConLink.length} · fotos distintas entre ellas: ${distintasEnLineas} (la misma foto se repite en varias cotizaciones)`,
  );
  const miniDe = (u: string) => estado.get(u)?.bytesMini ?? 0;
  const pesoPorLinea = sum(lineasConLink.map((it) => miniDe(it.imageUrl!)));
  const pesoPorFoto = sum([...new Set(lineasConLink.map((it) => it.imageUrl!))].map(miniDe));
  console.log(
    `  miniaturas guardadas una vez por LÍNEA: ${mb(pesoPorLinea)} · una vez por FOTO distinta: ${mb(pesoPorFoto)} (como texto base64 dentro de la línea pesa ~1,33× más: ${mb(pesoPorLinea * 1.34)})`,
  );

  // ── 3. Dónde pegan las muertas ──────────────────────────────────────────
  const muertaSet = new Set(muertas.map((p) => p.url));
  const lineasMuertas = items.filter((it) => it.imageUrl && muertaSet.has(it.imageUrl));
  const porVersion = new Map<string, { etiqueta: string; estado: string; n: number; total: number }>();
  const totalPorVersion = new Map<string, number>();
  for (const it of items) totalPorVersion.set(it.budgetVersion.id, (totalPorVersion.get(it.budgetVersion.id) ?? 0) + 1);
  for (const it of lineasMuertas) {
    const v = it.budgetVersion;
    const e = porVersion.get(v.id) ?? {
      etiqueta: `${v.project.name} (#${v.project.numeroProyecto ?? "?"}) ${v.version}`,
      estado: v.status,
      n: 0,
      total: totalPorVersion.get(v.id) ?? 0,
    };
    e.n++;
    porVersion.set(v.id, e);
  }
  console.log(`\nLíneas de cotización con la foto muerta: ${lineasMuertas.length}`);
  for (const e of [...porVersion.values()].sort((a, b) => b.n - a.n)) {
    console.log(`  ${String(e.n).padStart(3)} de ${String(e.total).padStart(3)}  ${e.estado.padEnd(9)} ${e.etiqueta}`);
  }
  const catMuertas = catalogo.filter((c) => c.imageUrl && muertaSet.has(c.imageUrl));
  console.log(`Catálogo con la foto muerta: ${catMuertas.length}`);
  for (const c of catMuertas) console.log(`   - ${c.name} (${c.supplier ?? "?"})`);
  const snapMuertas = snapUrls.filter((u) => muertaSet.has(u)).length;
  console.log(`Fotos muertas dentro de "fotos de lo enviado": ${snapMuertas} (de ${snapUrls.length} con link)`);

  // ── 4. ¿Se pueden recuperar hoy desde la tienda? ───────────────────────
  // Se importa acá (no arriba) para que su cliente Prisma use la base viva y no
  // cargue el .env (que apunta a la vieja): `tiendas.ts` lee las tiendas
  // aprendidas. Solo lectura.
  process.env.DATABASE_URL = url;
  const { leerFotoWeb } = await import("../src/lib/catalog/leerFotoWeb");
  const productosMuertos = new Map<string, { nombre: string; link: string | null; foto: string }>();
  for (const it of lineasMuertas) {
    const clave = it.referenceLink ?? `sin-link:${it.imageUrl}`;
    if (!productosMuertos.has(clave)) productosMuertos.set(clave, { nombre: it.detail ?? it.name, link: it.referenceLink, foto: it.imageUrl! });
  }
  for (const c of catMuertas) {
    const clave = c.referenceLink ?? `sin-link:${c.imageUrl}`;
    if (!productosMuertos.has(clave)) productosMuertos.set(clave, { nombre: c.name, link: c.referenceLink, foto: c.imageUrl! });
  }
  const recup = await enLotes([...productosMuertos.values()], 4, async (p) => ({
    ...p,
    nueva: p.link ? await leerFotoWeb(p.link) : null,
  }));
  const ok = recup.filter((r) => r.nueva);
  console.log(`\nProductos con foto muerta: ${recup.length} · la tienda publica foto HOY para: ${ok.length}`);
  for (const r of recup.filter((x) => !x.nueva)) console.log(`   sin foto hoy: ${r.nombre} · link ${r.link ?? "—"}`);

  // ── 5. Tamaño de la base, para comparar ─────────────────────────────────
  const [tam] = await prisma.$queryRaw<{ base: bigint; pdfs: bigint | null; npdfs: bigint }[]>(Prisma.sql`
    SELECT pg_database_size(current_database()) AS base,
           SUM(octet_length("pdfContent"))::bigint AS pdfs,
           COUNT("pdfContent")::bigint AS npdfs
    FROM "Invoice"`);
  const [snapTam] = await prisma.$queryRaw<{ bytes: bigint | null }[]>(Prisma.sql`
    SELECT SUM(pg_column_size("sentSnapshot"))::bigint AS bytes FROM "BudgetVersion"`);
  console.log(
    `\nBase completa: ${mb(Number(tam.base))} · PDFs del SII guardados en ella: ${tam.npdfs} por ${mb(Number(tam.pdfs ?? 0))} · "fotos de lo enviado" (todas las cotizaciones): ${mb(Number(snapTam.bytes ?? 0))}`,
  );

  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          host,
          pruebas,
          lineasMuertas: lineasMuertas.map((it) => ({
            id: it.id, nombre: it.detail ?? it.name, foto: it.imageUrl, link: it.referenceLink,
            version: it.budgetVersion.version, estado: it.budgetVersion.status,
            proyecto: it.budgetVersion.project.name, numero: it.budgetVersion.project.numeroProyecto,
          })),
          catMuertas,
          recuperables: recup,
          porVersion: [...porVersion.values()],
        },
        null,
        2,
      ),
    );
    console.log(`\nDetalle en ${jsonPath}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
