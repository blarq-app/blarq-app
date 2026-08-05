/**
 * Pendiente 132 — recupera las fotos rotas del catálogo de artefactos.
 *
 * El catálogo guarda el LINK a la foto que vive en el servidor del proveedor.
 * Cuando la tienda reemplaza la imagen, ese link queda en 404 y la pantalla
 * muestra el recuadro vacío aunque el campo tenga dato. Este script, para cada
 * entrada CON link de producto:
 *   1. prueba la foto guardada (HEAD; tiene que responder como imagen),
 *   2. si está rota o vacía, pide la que la tienda publica hoy,
 *   3. verifica que la nueva cargue, y recién ahí la propone.
 *
 * Toca UN SOLO campo: `imageUrl`. No mira ni escribe precio, descuento ni link.
 * Si el proveedor tampoco publica foto hoy, la fila se deja como está y sale
 * listada aparte (esas hay que subirlas a mano).
 *
 * Uso:
 *   npx tsx scripts/fix-132-recuperar-fotos-catalogo.ts .env.prod            (dry-run)
 *   npx tsx scripts/fix-132-recuperar-fotos-catalogo.ts .env.prod --aplicar  (escribe)
 *   ... --html <ruta.html>   deja una página antes/después para mirar las fotos
 *
 * OJO: NO usa `import "dotenv/config"` — lee el DATABASE_URL del archivo que se
 * le pasa. Con dotenv leería la base VIEJA (CLAUDE.md §4.9).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";
import { leerFotoWeb, fotoSigueViva } from "../src/lib/catalog/leerFotoWeb";

const envPath = process.argv[2] ?? ".env.prod";
const aplicar = process.argv.includes("--aplicar");
const htmlPath = process.argv[process.argv.indexOf("--html") + 1];
const quiereHtml = process.argv.includes("--html") && !!htmlPath;

const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) {
  console.error(`No encontré DATABASE_URL en ${envPath}`);
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const corto = (s: string | null, n = 62) =>
  !s ? "—" : s.length <= n ? s : s.slice(0, n) + "…";

async function main() {
  console.log(`=== BASE: ${url!.match(/@([^/.]+)/)?.[1]} · ${aplicar ? "APLICAR (escribe)" : "DRY-RUN (no escribe)"} ===\n`);

  const cat = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { not: null } },
    select: { id: true, name: true, brand: true, imageUrl: true, referenceLink: true },
    orderBy: { name: "asc" },
  });
  console.log(`Entradas del catálogo con link: ${cat.length}`);

  // 1) ¿Cuáles tienen la foto rota o vacía? De a 8 para no golpear el CDN.
  const rotas: typeof cat = [];
  for (let i = 0; i < cat.length; i += 8) {
    const lote = cat.slice(i, i + 8);
    const vivas = await Promise.all(lote.map((a) => fotoSigueViva(a.imageUrl)));
    vivas.forEach((viva, j) => {
      if (!viva) rotas.push(lote[j]);
    });
    process.stdout.write(`  probando fotos: ${Math.min(i + 8, cat.length)}/${cat.length}\r`);
  }
  console.log(`\nCon foto rota o vacía: ${rotas.length}\n`);

  // 2) Para cada una, la foto que publica la tienda hoy.
  const recuperadas: { nombre: string; id: string; vieja: string | null; nueva: string }[] = [];
  const sinSuerte: { nombre: string; link: string }[] = [];
  for (const a of rotas) {
    const nueva = await leerFotoWeb(a.referenceLink!);
    if (nueva && nueva !== a.imageUrl)
      recuperadas.push({ nombre: a.name, id: a.id, vieja: a.imageUrl, nueva });
    else sinSuerte.push({ nombre: a.name, link: a.referenceLink! });
  }

  console.log("=".repeat(100));
  console.log(`SE RECUPERAN: ${recuperadas.length}`);
  console.log("=".repeat(100));
  for (const r of recuperadas) {
    console.log(`\n  ${r.nombre}`);
    console.log(`    antes : ${corto(r.vieja)}`);
    console.log(`    ahora : ${corto(r.nueva)}   (verificada: carga como imagen)`);
  }

  if (sinSuerte.length) {
    console.log(`\n\n${"=".repeat(100)}`);
    console.log(`QUEDAN SIN FOTO — el proveedor no publica ninguna hoy (hay que subirla a mano): ${sinSuerte.length}`);
    console.log("=".repeat(100));
    for (const s of sinSuerte) console.log(`  ${s.nombre}\n    ${s.link}`);
  }

  // Página de comparación: MJ no lee código, mira las fotos (CLAUDE.md §4.10).
  if (quiereHtml) {
    const celda = (u: string | null) =>
      u
        ? `<img src="${u}" alt="" loading="lazy">`
        : `<div class="vacio">sin foto</div>`;
    const filas = recuperadas
      .map(
        (r) => `<tr>
        <td class="nombre">${r.nombre}</td>
        <td>${celda(r.vieja)}<div class="pie">como se ve hoy</div></td>
        <td>${celda(r.nueva)}<div class="pie">como quedaría</div></td>
      </tr>`
      )
      .join("\n");
    const pendientes = sinSuerte
      .map((s) => `<li>${s.nombre} — la tienda no publica foto hoy</li>`)
      .join("\n");
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>Fotos del catálogo — antes y después</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #2A2722; margin: 32px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.sub { color: #6b7280; margin: 0 0 24px; }
  table { border-collapse: collapse; width: 100%; max-width: 760px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
       color: #6b7280; font-weight: 500; padding: 8px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 12px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.nombre { width: 46%; font-weight: 500; }
  img { width: 110px; height: 110px; object-fit: contain; border: 1px solid #e5e7eb;
        border-radius: 8px; background: #fff; display: block; }
  .vacio { width: 110px; height: 110px; border: 1px solid #e5e7eb; border-radius: 8px;
           display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 11px; }
  .pie { font-size: 11px; color: #6b7280; margin-top: 4px; }
  ul { color: #6b7280; }
</style>
<h1>Fotos del catálogo de artefactos — antes y después</h1>
<p class="sub">${recuperadas.length} fotos que hoy salen vacías y se pueden recuperar del proveedor. Izquierda: lo que muestra la app ahora. Derecha: lo que mostraría.</p>
<table>
  <tr><th>Artefacto</th><th>Ahora</th><th>Quedaría</th></tr>
  ${filas}
</table>
${sinSuerte.length ? `<h1 style="margin-top:32px">Quedan sin foto (${sinSuerte.length})</h1><ul>${pendientes}</ul>` : ""}
`,
      "utf8"
    );
    console.log(`\nPágina de comparación: ${htmlPath}`);
  }

  if (!aplicar) {
    console.log(`\n\nDRY-RUN: no se escribió nada. Para aplicar:`);
    console.log(`  npx tsx scripts/fix-132-recuperar-fotos-catalogo.ts ${envPath} --aplicar`);
    return;
  }

  let ok = 0;
  for (const r of recuperadas) {
    await prisma.artefactoCatalog.update({
      where: { id: r.id },
      data: { imageUrl: r.nueva },
    });
    ok++;
  }
  console.log(`\n\nAPLICADO: ${ok} fotos actualizadas (solo el campo imageUrl).`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
