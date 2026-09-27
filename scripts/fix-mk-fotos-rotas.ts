/**
 * Fotos rotas de artefactos: las repone desde la tienda en el CATÁLOGO y en las
 * líneas de cotizaciones en BORRADOR.
 *
 * Por qué (2026-09-27): la app no guarda la foto, guarda el LINK a la foto que
 * vive en el servidor de la tienda. MK reemplazó imágenes y cambió los links de
 * todos sus productos; el link viejo de la foto da 404 y la pantalla (y el PDF)
 * muestran el recuadro vacío aunque el campo tenga dato. Desde el arreglo de
 * los links de MK (PR #455) la app vuelve a leer esos productos, así que la foto
 * de hoy se puede pedir a la tienda aunque el link guardado sea el viejo.
 *
 * Toca UN SOLO campo: `imageUrl`. Nunca precio, descuento, link ni marcas.
 * Solo toca:
 *   - productos del catálogo,
 *   - líneas de cotizaciones en BORRADOR.
 * Las enviadas / aprobadas / rechazadas NO se tocan: son lo que vio el cliente
 * (guardar copia de esas fotos es otra tarea).
 * Solo entra una foto que se probó que carga como imagen. Si la tienda no
 * publica una foto que cargue, la fila se deja como está y sale listada aparte.
 * Las filas SIN foto guardada no se tocan: esto repara fotos rotas, no agrega.
 *
 * Por defecto solo MK (mk.cl); `--todas` suma las otras tiendas.
 *
 * Uso:
 *   npx tsx scripts/fix-mk-fotos-rotas.ts <ruta-env>                  (dry-run: no escribe)
 *   npx tsx scripts/fix-mk-fotos-rotas.ts <ruta-env> --html a.html    (+ página antes/después)
 *   npx tsx scripts/fix-mk-fotos-rotas.ts <ruta-env> --aplicar        (respalda y escribe)
 *
 * Con `--aplicar`, ANTES de escribir guarda en backups/ la foto vieja de cada
 * fila que va a cambiar. Cada escritura exige que la fila siga con la foto vieja
 * (y la línea, en borrador): si algo cambió desde que se miró, no se pisa.
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa (con dotenv leería la base VIEJA, CLAUDE.md §4.9). Para no escribir
 * por accidente en otra base con las funciones de la app, correrlo con
 * DATABASE_URL apuntando a nada: DATABASE_URL=postgresql://nadie@127.0.0.1:1/x
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { leerFotoWeb, fotoSigueViva } from "../src/lib/catalog/leerFotoWeb";

const envPath = process.argv[2];
if (!envPath || envPath.startsWith("--")) {
  console.error("Uso: npx tsx scripts/fix-mk-fotos-rotas.ts <ruta-env> [--html a.html] [--todas] [--aplicar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const todas = process.argv.includes("--todas");
const htmlIdx = process.argv.indexOf("--html");
const htmlPath = htmlIdx > 0 ? process.argv[htmlIdx + 1] : null;

const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tiendaDe = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
};

interface Fila {
  tabla: "catalogo" | "cotizacion";
  id: string;
  nombre: string;
  donde: string; // "Catálogo" o "Proyecto V4"
  tienda: string;
  link: string;
  fotoVieja: string;
  fotoNueva: string | null;
}

async function main() {
  const host = url!.match(/@([^/.]+)/)?.[1];
  console.log(`=== BASE: ${host} · ${aplicar ? "APLICAR (escribe)" : "DRY-RUN (no escribe)"} · ${todas ? "todas las tiendas" : "solo MK"} ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name ?? "(no existe)"}\n`);

  const cat = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { not: null }, imageUrl: { not: null } },
    select: { id: true, name: true, referenceLink: true, imageUrl: true },
    orderBy: { name: "asc" },
  });
  const lineas = await prisma.artefactoItem.findMany({
    where: {
      referenceLink: { not: null },
      imageUrl: { not: null },
      budgetVersion: { status: "borrador" },
    },
    select: {
      id: true,
      name: true,
      referenceLink: true,
      imageUrl: true,
      budgetVersion: { select: { version: true, project: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });

  const candidatas: Fila[] = [
    ...cat.map((c) => ({
      tabla: "catalogo" as const,
      id: c.id,
      nombre: c.name,
      donde: "Catálogo",
      tienda: tiendaDe(c.referenceLink!),
      link: c.referenceLink!,
      fotoVieja: c.imageUrl!,
      fotoNueva: null,
    })),
    ...lineas.map((l) => ({
      tabla: "cotizacion" as const,
      id: l.id,
      nombre: l.name,
      donde: `${l.budgetVersion.project.name} ${l.budgetVersion.version}`,
      tienda: tiendaDe(l.referenceLink!),
      link: l.referenceLink!,
      fotoVieja: l.imageUrl!,
      fotoNueva: null,
    })),
  ].filter((f) => !f.fotoVieja.startsWith("data:") && (todas || f.tienda === "mk.cl"));

  console.log(`Con link y foto guardada: catálogo ${candidatas.filter((f) => f.tabla === "catalogo").length}, borradores ${candidatas.filter((f) => f.tabla === "cotizacion").length}`);

  // 1) ¿Qué fotos no cargan? Una prueba por foto distinta, de a 8 (es el
  //    servidor de imágenes, no la tienda).
  const distintas = [...new Set(candidatas.map((f) => f.fotoVieja))];
  const viva = new Map<string, boolean>();
  for (let i = 0; i < distintas.length; i += 8) {
    const lote = distintas.slice(i, i + 8);
    const r = await Promise.all(lote.map((u) => fotoSigueViva(u)));
    lote.forEach((u, j) => viva.set(u, r[j]));
    process.stdout.write(`  probando fotos: ${Math.min(i + 8, distintas.length)}/${distintas.length}\r`);
  }
  console.log();
  const rotas = candidatas.filter((f) => !viva.get(f.fotoVieja));
  console.log(`Con la foto rota: ${rotas.length}\n`);

  // 2) La foto de hoy, una vez por link de producto y de a uno: MK corta si
  //    se le pega muy seguido.
  const porLink = new Map<string, string | null>();
  for (const f of rotas) {
    if (!porLink.has(f.link)) {
      porLink.set(f.link, await leerFotoWeb(f.link));
      await pausa(400);
    }
    const nueva = porLink.get(f.link) ?? null;
    f.fotoNueva = nueva && nueva !== f.fotoVieja ? nueva : null;
  }

  const seRecuperan = rotas.filter((f) => f.fotoNueva);
  const sinSuerte = rotas.filter((f) => !f.fotoNueva);
  const linea = "=".repeat(100);
  console.log(`${linea}\nSE REPONEN: ${seRecuperan.length} (catálogo ${seRecuperan.filter((f) => f.tabla === "catalogo").length}, borradores ${seRecuperan.filter((f) => f.tabla === "cotizacion").length})\n${linea}`);
  for (const f of seRecuperan) {
    console.log(`  [${f.donde}] ${f.nombre}  (${f.tienda})\n      antes:   ${f.fotoVieja}\n      después: ${f.fotoNueva}`);
  }
  console.log(`\n${linea}\nLA TIENDA TAMPOCO PUBLICA FOTO (se dejan como están): ${sinSuerte.length}\n${linea}`);
  for (const f of sinSuerte) console.log(`  [${f.donde}] ${f.nombre}  ${f.link}`);

  if (htmlPath) {
    writeFileSync(htmlPath, galeria(seRecuperan, sinSuerte));
    console.log(`\nPágina antes/después: ${htmlPath}`);
  }

  if (!aplicar) {
    console.log("\nDRY-RUN: no se escribió nada. Para aplicar: --aplicar");
    return;
  }
  if (seRecuperan.length === 0) {
    console.log("\nNada que aplicar.");
    return;
  }

  // 3) Respaldo ANTES de escribir.
  mkdirSync("backups", { recursive: true });
  const respaldo = `backups/fotos-mk-antes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    respaldo,
    JSON.stringify(
      {
        base: host,
        fecha: new Date().toISOString(),
        nota: "Fotos (imageUrl) que tenían estas filas antes de fix-mk-fotos-rotas.ts. Para volver atrás: poner fotoVieja en imageUrl de cada id.",
        filas: seRecuperan.map(({ tabla, id, nombre, donde, fotoVieja, fotoNueva }) => ({ tabla, id, nombre, donde, fotoVieja, fotoNueva })),
      },
      null,
      2
    )
  );
  console.log(`\nRespaldo: ${respaldo}`);

  // 4) Escribir solo la foto, y solo si la fila sigue como se la miró.
  let hechas = 0;
  const saltadas: Fila[] = [];
  for (const f of seRecuperan) {
    const r =
      f.tabla === "catalogo"
        ? await prisma.artefactoCatalog.updateMany({
            where: { id: f.id, imageUrl: f.fotoVieja },
            data: { imageUrl: f.fotoNueva! },
          })
        : await prisma.artefactoItem.updateMany({
            where: { id: f.id, imageUrl: f.fotoVieja, budgetVersion: { status: "borrador" } },
            data: { imageUrl: f.fotoNueva! },
          });
    if (r.count === 1) hechas++;
    else saltadas.push(f);
  }
  console.log(`Escritas: ${hechas} de ${seRecuperan.length}`);
  for (const f of saltadas) console.log(`  SALTADA (cambió desde que se miró): [${f.donde}] ${f.nombre}`);
}

function galeria(ok: Fila[], sin: Fila[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const fila = (f: Fila) => `
    <tr>
      <td class="txt"><div class="n">${esc(f.nombre)}</div><div class="d">${esc(f.donde)} · ${esc(f.tienda)}</div></td>
      <td><img src="${esc(f.fotoVieja)}" alt=""><div class="roto">ya no existe en la tienda</div></td>
      <td>${f.fotoNueva ? `<img src="${esc(f.fotoNueva)}" alt="">` : `<div class="vacio">la tienda no publica foto</div>`}</td>
    </tr>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Fotos rotas de MK</title>
<style>
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#2A2722;background:#fff;margin:32px}
  h1{font-size:20px;font-weight:600;margin:0 0 4px} p{color:#6b6b6b;font-size:13px;margin:0 0 20px}
  h2{font-size:14px;font-weight:600;margin:28px 0 8px}
  table{border-collapse:collapse;width:100%;max-width:880px}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b6b6b;text-align:left;border-bottom:1px solid #e5e5e5;padding:6px 8px}
  td{border-bottom:1px solid #eee;padding:8px;vertical-align:middle}
  td.txt{width:46%} .n{font-size:13px;font-weight:500} .d{font-size:11px;color:#8a8a8a;margin-top:2px}
  img{width:120px;height:120px;object-fit:contain;display:block;background:#fafafa;border:1px solid #eee;border-radius:6px}
  .roto,.vacio{font-size:10px;color:#b45309;margin-top:4px}
  .vacio{width:120px;height:120px;display:flex;align-items:center;justify-content:center;text-align:center;background:#fafafa;border:1px dashed #ddd;border-radius:6px;color:#8a8a8a}
</style></head><body>
<h1>Fotos rotas de artefactos — antes y después</h1>
<p>Leído de la app real el ${new Date().toLocaleString("es-CL")} · solo se cambia la foto (nunca precio, descuento ni link) · catálogo y cotizaciones en borrador · las enviadas y aprobadas no se tocan</p>
<h2>Se reponen (${ok.length})</h2>
<table><tr><th>Producto</th><th>Hoy</th><th>Queda</th></tr>${ok.map(fila).join("")}</table>
${sin.length ? `<h2>La tienda tampoco publica foto — quedan como están (${sin.length})</h2>
<table><tr><th>Producto</th><th>Hoy</th><th></th></tr>${sin.map(fila).join("")}</table>` : ""}
</body></html>`;
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
