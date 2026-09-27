/**
 * Diagnóstico SOLO LECTURA: links de MK que cambiaron y fotos de artefactos rotas.
 *
 * Contexto (2026-09-25): MK cambió el link de todos sus productos
 *   https://www.mk.cl/acc080034-pro-asis-stapa-cr-accesorios/p
 *     → 301 → https://www.mk.cl/acc080034-accesorios-klipen-asis/p
 * El código del inicio (acc080034) se mantiene. La API de VTEX no sigue esa
 * redirección: con el link viejo responde [] y el producto queda "ilegible".
 * Además, la app guarda el LINK a la foto de la tienda (no la foto), así que
 * cuando MK reemplaza una imagen el link viejo da 404.
 *
 * Qué hace, sin escribir nada en la base:
 *   1. Junta los links de MK del catálogo y de las líneas de cotización.
 *   2. Para cada link distinto pregunta adónde redirige (HEAD, sin seguir) y,
 *      si va a otra página de producto, confirma con la API que el producto
 *      nuevo tenga el MISMO código que el link viejo.
 *   3. Prueba cada foto guardada (HEAD: tiene que responder como imagen).
 *   4. Cuenta por dónde están: catálogo, borradores, enviadas/aprobadas.
 *
 * MK corta si se le pega muy seguido: todo va de a uno y con pausas.
 *
 * Uso:
 *   npx tsx scripts/diag-mk-links-y-fotos.ts <ruta-env> [--json salida.json]
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa (con dotenv leería la base VIEJA, CLAUDE.md §4.9).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";
import { fotoSigueViva } from "../src/lib/catalog/leerFotoWeb";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Uso: npx tsx scripts/diag-mk-links-y-fotos.ts <ruta-env> [--json salida.json]");
  process.exit(1);
}
const jsonIdx = process.argv.indexOf("--json");
const jsonPath = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;

const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1].trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hostDe = (u: string | null) => {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const slugDe = (u: string) => new URL(u).pathname.replace(/\/+$/, "").replace(/\/p$/i, "").split("/").filter(Boolean).pop() ?? "";
// El código de MK es el primer tramo del slug: "acc080034-pro-asis…" → "acc080034".
const codigoDe = (u: string) => slugDe(u).split("-")[0].toLowerCase();
// La API lo publica con guiones y en mayúsculas: "ACC-08-0034" → "acc080034".
const normalizarRef = (r: unknown) => (typeof r === "string" ? r.replace(/[^a-z0-9]/gi, "").toLowerCase() : "");

type Donde = "catalogo" | "borrador" | "enviado" | "aprobado" | "rechazado";

interface LinkMk {
  link: string;
  usos: Record<Donde, number>;
  estado: number | null; // HTTP del link guardado (sin seguir la redirección)
  destino: string | null; // adónde redirige, si redirige
  tipo:
    | "vigente" // el link guardado responde 200: no cambió
    | "redirige-mismo-codigo" // 301 a otro producto con el mismo código (el caso esperado)
    | "redirige-otro-codigo" // 301 a un producto con OTRO código: sospechoso
    | "redirige-no-producto" // 301 a una búsqueda / portada / categoría
    | "no-existe" // 404
    | "error";
  apiNueva: { encontrado: boolean; ref: string | null; nombre: string | null; lista: number | null; venta: number | null } | null;
}

interface Foto {
  imageUrl: string;
  usos: Record<Donde, number>;
  viva: boolean;
}

const vacio = (): Record<Donde, number> => ({ catalogo: 0, borrador: 0, enviado: 0, aprobado: 0, rechazado: 0 });

async function headSinSeguir(link: string): Promise<{ status: number | null; location: string | null }> {
  try {
    const r = await fetch(link, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    return { status: r.status, location: r.headers.get("location") };
  } catch {
    return { status: null, location: null };
  }
}

async function apiPorSlug(link: string) {
  const api = `https://www.mk.cl/api/catalog_system/pub/products/search/${slugDe(link)}/p`;
  try {
    const r = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { encontrado: false, ref: null, nombre: null, lista: null, venta: null, http: r.status };
    const d = (await r.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(d) || d.length === 0) return { encontrado: false, ref: null, nombre: null, lista: null, venta: null, http: 200 };
    const p = d[0];
    const it = (p.items as Array<Record<string, unknown>>)?.[0];
    const co = ((it?.sellers as Array<Record<string, unknown>>)?.[0]?.commertialOffer ?? {}) as Record<string, unknown>;
    return {
      encontrado: true,
      ref: (p.productReference as string) ?? null,
      nombre: (p.productName as string) ?? null,
      lista: Number(co.ListPrice) || null,
      venta: Number(co.Price) || null,
      http: 200,
    };
  } catch {
    return { encontrado: false, ref: null, nombre: null, lista: null, venta: null, http: null };
  }
}

async function main() {
  const host = url!.match(/@([^/.]+)/)?.[1];
  console.log(`=== BASE: ${host} · SOLO LECTURA ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name ?? "(no existe)"}\n`);

  const cat = await prisma.artefactoCatalog.findMany({ select: { referenceLink: true, imageUrl: true } });
  const lineas = await prisma.artefactoItem.findMany({
    select: { referenceLink: true, imageUrl: true, budgetVersion: { select: { status: true } } },
  });

  const registros: { link: string | null; foto: string | null; donde: Donde }[] = [
    ...cat.map((c) => ({ link: c.referenceLink, foto: c.imageUrl, donde: "catalogo" as Donde })),
    ...lineas.map((l) => ({ link: l.referenceLink, foto: l.imageUrl, donde: l.budgetVersion.status as Donde })),
  ];

  // ── 1) Links de MK ─────────────────────────────────────────────────────
  const links = new Map<string, LinkMk>();
  for (const r of registros) {
    if (!r.link || hostDe(r.link) !== "mk.cl") continue;
    const l = links.get(r.link) ?? {
      link: r.link, usos: vacio(), estado: null, destino: null, tipo: "error" as const, apiNueva: null,
    };
    l.usos[r.donde] = (l.usos[r.donde] ?? 0) + 1;
    links.set(r.link, l);
  }
  console.log(`Links de MK distintos: ${links.size}. Probando de a uno…`);

  let n = 0;
  for (const l of links.values()) {
    n++;
    process.stdout.write(`  ${n}/${links.size}\r`);
    const h = await headSinSeguir(l.link);
    l.estado = h.status;
    await pausa(300);
    if (h.status === 200) {
      l.tipo = "vigente";
      continue;
    }
    if (h.status === 404) {
      l.tipo = "no-existe";
      continue;
    }
    if (h.status && h.status >= 300 && h.status < 400 && h.location) {
      const destino = new URL(h.location, l.link).href;
      l.destino = destino;
      const esProducto = hostDe(destino) === "mk.cl" && /\/p\/?$/i.test(new URL(destino).pathname);
      if (!esProducto) {
        l.tipo = "redirige-no-producto";
        continue;
      }
      const api = await apiPorSlug(destino);
      await pausa(300);
      l.apiNueva = { encontrado: api.encontrado, ref: api.ref, nombre: api.nombre, lista: api.lista, venta: api.venta };
      // Mismo producto = el código del link viejo es el del producto nuevo. Se
      // mira contra la referencia que publica la API (no solo contra el texto
      // del link nuevo), que es el dato de la tienda.
      const mismo =
        codigoDe(destino) === codigoDe(l.link) &&
        (!api.encontrado || normalizarRef(api.ref) === codigoDe(l.link));
      l.tipo = mismo ? "redirige-mismo-codigo" : "redirige-otro-codigo";
      continue;
    }
    l.tipo = "error";
  }
  console.log();

  const porTipo = new Map<string, LinkMk[]>();
  for (const l of links.values()) porTipo.set(l.tipo, [...(porTipo.get(l.tipo) ?? []), l]);
  console.log("\n── LINKS DE MK ─────────────────────────────────────────────");
  for (const [tipo, ls] of porTipo) {
    const usos = ls.reduce((a, l) => {
      for (const k of Object.keys(a) as Donde[]) a[k] += l.usos[k];
      return a;
    }, vacio());
    console.log(
      `${tipo.padEnd(24)} ${String(ls.length).padStart(3)} links · usos: catálogo ${usos.catalogo}, borrador ${usos.borrador}, enviado ${usos.enviado}, aprobado ${usos.aprobado}, rechazado ${usos.rechazado}`
    );
  }
  const apiFalla = [...links.values()].filter((l) => l.tipo === "redirige-mismo-codigo" && !l.apiNueva?.encontrado);
  console.log(`  (de los que redirigen al mismo código, la API NO encuentra el nuevo: ${apiFalla.length})`);
  for (const tipo of ["redirige-otro-codigo", "redirige-no-producto", "no-existe", "error"]) {
    for (const l of porTipo.get(tipo) ?? []) {
      console.log(`  [${tipo}] ${l.link}\n      → ${l.destino ?? l.estado} ${l.apiNueva?.nombre ? `(${l.apiNueva.ref} ${l.apiNueva.nombre})` : ""}`);
    }
  }
  for (const l of apiFalla) console.log(`  [api-no-encuentra] ${l.link}\n      → ${l.destino}`);

  // ── 2) Fotos ───────────────────────────────────────────────────────────
  const fotos = new Map<string, Foto>();
  for (const r of registros) {
    if (!r.foto || r.foto.startsWith("data:")) continue;
    const f = fotos.get(r.foto) ?? { imageUrl: r.foto, usos: vacio(), viva: true };
    f.usos[r.donde] = (f.usos[r.donde] ?? 0) + 1;
    fotos.set(r.foto, f);
  }
  console.log(`\nFotos distintas (sin las embebidas): ${fotos.size}. Probando…`);
  n = 0;
  for (const f of fotos.values()) {
    n++;
    process.stdout.write(`  ${n}/${fotos.size}\r`);
    f.viva = await fotoSigueViva(f.imageUrl);
    await pausa(120);
  }
  console.log();
  const rotas = [...fotos.values()].filter((f) => !f.viva);
  console.log("\n── FOTOS ROTAS ─────────────────────────────────────────────");
  console.log(`Rotas: ${rotas.length} de ${fotos.size}`);
  const porHost = new Map<string, number>();
  for (const f of rotas) porHost.set(hostDe(f.imageUrl) ?? "?", (porHost.get(hostDe(f.imageUrl) ?? "?") ?? 0) + 1);
  console.log("  por servidor:", [...porHost.entries()]);
  const usosRotas = rotas.reduce((a, f) => {
    for (const k of Object.keys(a) as Donde[]) a[k] += f.usos[k];
    return a;
  }, vacio());
  console.log(
    `  registros que las usan: catálogo ${usosRotas.catalogo}, borrador ${usosRotas.borrador}, enviado ${usosRotas.enviado}, aprobado ${usosRotas.aprobado}, rechazado ${usosRotas.rechazado}`
  );

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ base: host, fecha: new Date().toISOString(), links: [...links.values()], fotos: [...fotos.values()] }, null, 2));
    console.log(`\nDetalle en ${jsonPath}`);
  }
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(() => prisma.$disconnect());
