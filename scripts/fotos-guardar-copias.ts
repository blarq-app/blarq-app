/**
 * Cajón de fotos — pasada única (2026-09-27).
 *
 * Copia a la app TODAS las fotos de artefactos y herrajes que hoy son un link de
 * tienda (o una subida a mano guardada como texto), y recupera las que ya
 * murieron. Después de esto ninguna foto depende de que la tienda la mantenga.
 *
 * Qué toca — UN SOLO campo, la foto (`imageUrl`), nunca precios ni cantidades:
 *   - líneas de cotizaciones de artefactos, en TODOS los estados (MJ lo pidió
 *     también para enviadas y aprobadas, "Devolverles las fotos");
 *   - productos del catálogo de artefactos y del de herrajes;
 *   - la foto de lo enviado (`sentSnapshot`), que es lo que repone "Volver a lo
 *     enviado": ahí también se cambia solo la foto de cada línea.
 *
 * De dónde sale cada foto:
 *   1. si el link todavía carga → la copia de esa misma foto;
 *   2. si murió → la foto que la tienda publica HOY para ese producto (el link
 *      del producto; con MK funciona gracias al arreglo de sus links nuevos);
 *   3. si la tienda ya no lo vende → la foto del mismo producto (mismo código,
 *      ej. ACC-08-0324) que haya en el catálogo o en otra cotización;
 *   4. si tampoco → la foto sacada del PDF que se le mandó al cliente
 *      (`--pdf-fotos <carpeta>`, un archivo por código: ACC-08-0326.png…);
 *   5. si nada → la línea queda como estaba y sale listada.
 * Cuando la foto se recupera (2 a 4), el link muerto queda anotado en la copia:
 * una pantalla abierta desde antes que todavía lo tenga no pisa la copia.
 *
 * Uso:
 *   npx tsx scripts/fotos-guardar-copias.ts <ruta-env>                      (dry-run: no escribe)
 *   npx tsx scripts/fotos-guardar-copias.ts <ruta-env> --html a.html        (+ página para mirar)
 *   npx tsx scripts/fotos-guardar-copias.ts <ruta-env> --pdf-fotos <dir>    (fotos del PDF enviado)
 *   npx tsx scripts/fotos-guardar-copias.ts <ruta-env> --aplicar            (respalda y escribe)
 * Contra la base VIVA, además de --aplicar hay que pasar --es-la-viva.
 *
 * Con --aplicar, ANTES de escribir guarda en backups/ la foto vieja de cada fila
 * y la foto de lo enviado completa de cada versión que cambia. Cada escritura
 * exige que la fila siga con la foto que se miró: si alguien la cambió en el
 * medio, no se pisa. Se puede volver a correr: lo ya copiado no se toca.
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa (con dotenv leería la base VIEJA, CLAUDE.md §4.9).
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

const envPath = process.argv[2];
if (!envPath || envPath.startsWith("--")) {
  console.error(
    "Uso: npx tsx scripts/fotos-guardar-copias.ts <ruta-env> [--html a.html] [--pdf-fotos dir] [--aplicar [--es-la-viva]]"
  );
  process.exit(1);
}
const arg = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i > 0 ? process.argv[i + 1] ?? null : null;
};
const aplicar = process.argv.includes("--aplicar");
const htmlPath = arg("--html");
const pdfDir = arg("--pdf-fotos");

const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const host = url.match(/@([^/:]+)/)?.[1] ?? "?";
const esLaViva = host.includes("ep-shy-morning");
if (aplicar && esLaViva && !process.argv.includes("--es-la-viva")) {
  console.error("Esto es la base VIVA: para escribir hay que pasar también --es-la-viva (y tener el OK de MJ).");
  process.exit(1);
}
// Las funciones de la app (tiendas conocidas, cajón) usan su propio cliente:
// que apunte a la MISMA base que este script, nunca a la del .env.
process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Tabla = "linea" | "catalogo" | "herraje" | "enviado";
interface Uso {
  tabla: Tabla;
  id: string; // fila (o versión, para "enviado")
  idx?: number; // posición de la línea dentro de la foto de lo enviado
  donde: string; // "Casa Los Algarrobos V1 (enviado)", "Catálogo"…
  nombre: string;
  link: string | null; // link del PRODUCTO en la tienda
  foto: string; // imageUrl de hoy
}
type Origen = "ya estaba" | "copia" | "subida a mano" | "tienda hoy" | "otra foto del producto" | "PDF enviado" | "sin fuente";
interface Destino {
  origen: Origen;
  bytes?: Buffer;
  desde?: string | null; // link del que se bajó (se anota en la copia)
  linkCopia?: string; // "/api/fotos/<id>" cuando ya existe
  detalle?: string;
}

const esLinkTienda = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);
// Código de producto de MK en el nombre de la foto (…/ACC-08-0326_1.jpg) o en el
// link del producto (…/acc080326-portarrollos…/p).
const codigoDeFoto = (u: string) => u.match(/\/([A-Z]{3}-\d{2}-\d{4})_/)?.[1] ?? null;
const codigoDeLink = (u: string | null) => {
  const m = u?.split(/[?#]/)[0].match(/\/([a-z]{3})(\d{2})(\d{4})-[^/]*\/p\/?$/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}-${m[3]}` : null;
};

async function enLotes<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return out;
}

async function main() {
  const { guardarBytes, bajarFoto, copiasYaGuardadas, anotarOrigen, achicarFoto } = await import(
    "../src/lib/fotos/guardarFoto"
  );
  const { esFotoGuardada, linkDeFotoGuardada } = await import("../src/lib/fotos/linkFoto");
  const { leerFotoWeb } = await import("../src/lib/catalog/leerFotoWeb");

  console.log(`=== BASE: ${host}${esLaViva ? " (VIVA)" : ""} · ${aplicar ? "APLICAR (escribe)" : "DRY-RUN (no escribe)"} ===\n`);

  // ── 1. Dónde hay fotos por copiar ─────────────────────────────────────
  const usos: Uso[] = [];
  const porCopiar = (u: string | null): u is string => !!u && !esFotoGuardada(u) && (esLinkTienda(u) || u.startsWith("data:"));

  const catalogo = await prisma.artefactoCatalog.findMany({ select: { id: true, name: true, imageUrl: true, referenceLink: true } });
  for (const c of catalogo) if (porCopiar(c.imageUrl)) usos.push({ tabla: "catalogo", id: c.id, donde: "Catálogo", nombre: c.name, link: c.referenceLink, foto: c.imageUrl });
  const herrajes = await prisma.herrajeCatalog.findMany({ select: { id: true, name: true, imageUrl: true, referenceLink: true } });
  for (const h of herrajes) if (porCopiar(h.imageUrl)) usos.push({ tabla: "herraje", id: h.id, donde: "Herrajes", nombre: h.name, link: h.referenceLink, foto: h.imageUrl });
  const lineas = await prisma.artefactoItem.findMany({
    select: {
      id: true, name: true, detail: true, imageUrl: true, referenceLink: true,
      budgetVersion: { select: { version: true, status: true, project: { select: { name: true } } } },
    },
  });
  for (const l of lineas) {
    if (!porCopiar(l.imageUrl)) continue;
    const v = l.budgetVersion;
    usos.push({ tabla: "linea", id: l.id, donde: `${v.project.name} ${v.version} (${v.status})`, nombre: l.detail || l.name, link: l.referenceLink, foto: l.imageUrl });
  }
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    select: { id: true, version: true, status: true, sentSnapshot: true, project: { select: { name: true } } },
  });
  const enviadosOriginales = new Map<string, unknown>();
  for (const v of versiones) {
    const snap = v.sentSnapshot as { artefactoItems?: { imageUrl: string | null; name: string; detail?: string | null; referenceLink?: string | null }[] } | null;
    if (!snap?.artefactoItems) continue;
    let alguna = false;
    snap.artefactoItems.forEach((s, idx) => {
      if (!porCopiar(s.imageUrl)) return;
      alguna = true;
      usos.push({ tabla: "enviado", id: v.id, idx, donde: `${v.project.name} ${v.version} — "Volver a lo enviado"`, nombre: s.detail || s.name, link: s.referenceLink ?? null, foto: s.imageUrl });
    });
    if (alguna) enviadosOriginales.set(v.id, v.sentSnapshot);
  }
  const fotos = [...new Set(usos.map((u) => u.foto))];
  console.log(
    `Fotos por copiar: ${fotos.length} distintas, usadas en ${usos.length} lugares ` +
      `(${usos.filter((u) => u.tabla === "linea").length} líneas, ${usos.filter((u) => u.tabla === "catalogo").length} del catálogo, ` +
      `${usos.filter((u) => u.tabla === "herraje").length} herrajes, ${usos.filter((u) => u.tabla === "enviado").length} en fotos de lo enviado)`
  );

  // ── 2. Qué copia le toca a cada foto ─────────────────────────────────
  const destino = new Map<string, Destino>();
  const ya = await copiasYaGuardadas(fotos, prisma);
  for (const [f, link] of ya) destino.set(f, { origen: "ya estaba", linkCopia: link });

  for (const f of fotos) {
    if (destino.has(f) || !f.startsWith("data:")) continue;
    const coma = f.indexOf(",");
    destino.set(f, { origen: "subida a mano", bytes: Buffer.from(f.slice(coma + 1), "base64"), desde: null });
  }
  const links = fotos.filter((f) => !destino.has(f) && esLinkTienda(f));
  const bajadas = await enLotes(links, 6, async (f) => [f, await bajarFoto(f)] as const);
  const muertas: string[] = [];
  for (const [f, bytes] of bajadas) {
    if (bytes) destino.set(f, { origen: "copia", bytes, desde: f });
    else muertas.push(f);
  }
  console.log(`  cargan hoy: ${bajadas.length - muertas.length} · ya copiadas: ${ya.size} · subidas a mano: ${fotos.filter((f) => f.startsWith("data:")).length} · muertas: ${muertas.length}`);

  // Fotos que sirven, por código de producto (para el paso 3).
  const fotoBuenaPorCodigo = new Map<string, string>();
  for (const u of usos) {
    const d = destino.get(u.foto);
    if (!d || d.origen === "sin fuente") continue;
    const cod = codigoDeLink(u.link) ?? (esLinkTienda(u.foto) ? codigoDeFoto(u.foto) : null);
    // El catálogo manda: es donde MJ corrige las fotos a mano.
    if (cod && (!fotoBuenaPorCodigo.has(cod) || u.tabla === "catalogo")) fotoBuenaPorCodigo.set(cod, u.foto);
  }
  const archivosPdf = pdfDir && existsSync(pdfDir) ? readdirSync(pdfDir) : [];

  for (const f of muertas) {
    const usosF = usos.filter((u) => u.foto === f);
    const nombre = usosF[0].nombre;
    // 2. La tienda hoy, por el link del producto de cualquiera de sus usos.
    let hecho = false;
    for (const link of [...new Set(usosF.map((u) => u.link).filter((l): l is string => !!l))]) {
      const nueva = await leerFotoWeb(link).catch(() => null);
      const bytes = nueva ? await bajarFoto(nueva) : null;
      if (bytes) {
        destino.set(f, { origen: "tienda hoy", bytes, desde: nueva, detalle: link });
        hecho = true;
        break;
      }
    }
    if (hecho) continue;
    // 3. Otra foto buena del mismo producto (mismo código).
    const cod = codigoDeFoto(f) ?? usosF.map((u) => codigoDeLink(u.link)).find(Boolean) ?? null;
    const otra = cod ? fotoBuenaPorCodigo.get(cod) : undefined;
    if (otra && destino.get(otra)) {
      const d = destino.get(otra)!;
      destino.set(f, { ...d, origen: "otra foto del producto", desde: d.desde ?? null, detalle: `mismo código ${cod}` });
      continue;
    }
    // 4. El PDF que se le mandó al cliente.
    const archivo = cod ? archivosPdf.find((a) => a.startsWith(`${cod}.`)) : undefined;
    if (archivo) {
      destino.set(f, { origen: "PDF enviado", bytes: readFileSync(path.join(pdfDir!, archivo)), desde: null, detalle: archivo });
      continue;
    }
    destino.set(f, { origen: "sin fuente", detalle: `${nombre}${cod ? ` (${cod})` : ""}` });
  }

  // ── 3. Reporte ────────────────────────────────────────────────────────
  const cuenta = new Map<string, number>();
  for (const u of usos) {
    const o = destino.get(u.foto)!.origen;
    const k = `${u.tabla === "linea" ? "línea" : u.tabla} · ${o}`;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  console.log("\nPor lugar y origen de la copia:");
  for (const [k, n] of [...cuenta].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);

  const recuperadas = muertas.filter((f) => destino.get(f)!.origen !== "sin fuente");
  console.log(`\nFotos muertas: ${muertas.length} · recuperadas: ${recuperadas.length}`);
  for (const f of muertas) {
    const d = destino.get(f)!;
    const donde = [...new Set(usos.filter((u) => u.foto === f).map((u) => u.donde))];
    console.log(`  [${d.origen}] ${usos.find((u) => u.foto === f)!.nombre.slice(0, 60)}${d.detalle ? ` — ${d.detalle.slice(0, 70)}` : ""}`);
    console.log(`      en: ${donde.join(" · ").slice(0, 220)}`);
  }
  const lineasQueVuelven = usos.filter((u) => u.tabla === "linea" && muertas.includes(u.foto) && destino.get(u.foto)!.origen !== "sin fuente");
  console.log(`\nLíneas de cotización que recuperan su foto: ${lineasQueVuelven.length}`);
  const porVersion = new Map<string, number>();
  for (const u of lineasQueVuelven) porVersion.set(u.donde, (porVersion.get(u.donde) ?? 0) + 1);
  for (const [k, n] of [...porVersion].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

  if (htmlPath) await escribirHtml(htmlPath, usos, muertas, destino, achicarFoto);

  if (!aplicar) {
    console.log("\nDRY-RUN: no se escribió nada. Para aplicar: --aplicar (y --es-la-viva si es la base viva).");
    return;
  }

  // ── 4. Aplicar ────────────────────────────────────────────────────────
  mkdirSync("backups", { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo = path.join("backups", `fotos-copia-${host.slice(0, 20)}-${marca}.json`);
  writeFileSync(
    respaldo,
    JSON.stringify(
      {
        host,
        cuando: new Date().toISOString(),
        filas: usos.filter((u) => u.tabla !== "enviado").map((u) => ({ tabla: u.tabla, id: u.id, fotoVieja: u.foto })),
        fotosDeLoEnviado: Object.fromEntries(enviadosOriginales),
      },
      null,
      1
    )
  );
  console.log(`\nRespaldo: ${respaldo}`);

  // Guarda las copias (una por foto distinta; el cajón no duplica).
  const linkNuevo = new Map<string, string>();
  for (const f of fotos) {
    const d = destino.get(f)!;
    if (d.origen === "sin fuente") continue;
    if (d.linkCopia) {
      linkNuevo.set(f, d.linkCopia);
      continue;
    }
    const id = await guardarBytes(d.bytes!, d.desde ?? null, prisma);
    // Link muerto (o subido a mano no) → queda anotado como esta misma foto.
    if (esLinkTienda(f) && f !== d.desde) await anotarOrigen(id, f, prisma);
    linkNuevo.set(f, linkDeFotoGuardada(id));
  }

  let escritas = 0;
  let saltadas = 0;
  for (const u of usos.filter((x) => x.tabla !== "enviado")) {
    const nuevo = linkNuevo.get(u.foto);
    if (!nuevo) continue;
    const where = { id: u.id, imageUrl: u.foto };
    const r =
      u.tabla === "linea"
        ? await prisma.artefactoItem.updateMany({ where, data: { imageUrl: nuevo } })
        : u.tabla === "catalogo"
          ? await prisma.artefactoCatalog.updateMany({ where, data: { imageUrl: nuevo } })
          : await prisma.herrajeCatalog.updateMany({ where, data: { imageUrl: nuevo } });
    if (r.count === 1) escritas++;
    else saltadas++;
  }

  // Fotos de lo enviado: solo el campo de la foto de cada línea, y solo si la
  // foto de lo enviado sigue exactamente como se leyó.
  let versionesEnviadas = 0;
  for (const [versionId, original] of enviadosOriginales) {
    const actual = await prisma.budgetVersion.findUnique({ where: { id: versionId }, select: { sentSnapshot: true } });
    if (JSON.stringify(actual?.sentSnapshot) !== JSON.stringify(original)) {
      console.log(`  saltada (cambió mientras tanto): foto de lo enviado ${versionId}`);
      saltadas++;
      continue;
    }
    const copia = JSON.parse(JSON.stringify(original)) as { artefactoItems: { imageUrl: string | null }[] };
    let cambios = 0;
    for (const it of copia.artefactoItems) {
      const nuevo = it.imageUrl ? linkNuevo.get(it.imageUrl) : undefined;
      if (nuevo) {
        it.imageUrl = nuevo;
        cambios++;
      }
    }
    if (cambios === 0) continue;
    // Control: fuera de la foto, la foto de lo enviado queda idéntica.
    const sinFotos = (x: unknown) =>
      JSON.stringify(x, (k, v) => (k === "imageUrl" ? undefined : v));
    if (sinFotos(copia) !== sinFotos(original)) throw new Error(`La foto de lo enviado ${versionId} cambiaría algo más que las fotos`);
    await prisma.budgetVersion.update({ where: { id: versionId }, data: { sentSnapshot: copia as never } });
    versionesEnviadas++;
  }
  console.log(`Escritas: ${escritas} filas + ${versionesEnviadas} fotos de lo enviado · saltadas: ${saltadas}`);
}

// Página para mirar las fotos que vuelven (antes → después) y las que no.
async function escribirHtml(
  archivo: string,
  usos: Uso[],
  muertas: string[],
  destino: Map<string, Destino>,
  achicarFoto: (b: Buffer) => Promise<{ bytes: Buffer }>
) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const filas: string[] = [];
  for (const f of muertas) {
    const d = destino.get(f)!;
    const u = usos.filter((x) => x.foto === f);
    const donde = [...new Set(u.map((x) => x.donde))].map(esc).join("<br>");
    const img = d.bytes ? `<img src="data:image/jpeg;base64,${(await achicarFoto(d.bytes)).bytes.toString("base64")}">` : "<div class=vacia>sin fuente</div>";
    filas.push(
      `<tr><td><b>${esc(u[0].nombre)}</b><div class=chico>${donde}</div></td><td><div class=vacia>no carga</div></td><td>${img}<div class=chico>${esc(d.origen)}</div></td></tr>`
    );
  }
  writeFileSync(
    archivo,
    `<!doctype html><meta charset=utf-8><title>Fotos que vuelven</title>
<style>body{font:13px system-ui;margin:24px;color:#222}table{border-collapse:collapse}td{border-top:1px solid #ddd;padding:8px;vertical-align:top}
img{width:120px;height:120px;object-fit:contain;border:1px solid #eee}.vacia{width:120px;height:120px;background:#f3f3f3;display:flex;align-items:center;justify-content:center;color:#999}
.chico{font-size:11px;color:#777;margin-top:4px;max-width:420px}</style>
<h1>Fotos muertas: antes → después</h1><table><tr><th>Producto · dónde</th><th>Hoy</th><th>Con la copia</th></tr>${filas.join("")}</table>`
  );
  console.log(`\nPágina: ${archivo}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
