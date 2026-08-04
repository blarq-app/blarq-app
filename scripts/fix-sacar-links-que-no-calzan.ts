/**
 * Saca el link de los productos donde MK declara otro acabado que el del
 * catálogo. Decisión de MJ (2026-08-04): "dejalos sin link en la app ya que no
 * dicen lo mismo".
 *
 * Son los 6 que salieron en la verificación de descripciones: cuatro Atlas que
 * MK pasó de "gun grey" a "Latón Grey Mate", y dos Home que pasó de "brushed" a
 * "Cromado" (en uno además la medida cambió de 45 a 40 cm).
 *
 * ANTES de borrar, los links se guardan en backups/. Ayer se perdieron dos
 * links al sobrescribirlos sin respaldo y no hubo forma de recuperarlos: es
 * barato guardarlos y caro no tenerlos.
 *
 * NO se toca el precio: el que tienen es el que MJ usa en sus cotizaciones. Lo
 * único que se pierde es la posibilidad de revisarlos contra la web hasta que
 * se les cargue el link correcto.
 *
 *   npx tsx scripts/fix-sacar-links-que-no-calzan.ts                  # dry-run
 *   npx tsx scripts/fix-sacar-links-que-no-calzan.ts --aplicar --si-la-viva
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
console.log("HOST:", HOST, "· MODO:", APLICAR ? "APLICAR" : "DRY-RUN");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const RESPALDO =
  "/Users/mjblanco/Desktop/blarq-app/backups/backup-links-quitados-2026-08-04.json";

const NOMBRES = [
  "PERCHA ATLAS GUN GREY",
  "PORTARROLLO SIN TAPA ATLAS GUN GREY",
  "TOALLERO ATLAS 60 GUN GREY",
  "TOALLERO BARRA ATLAS 30 GUN GREY",
  "PERCHA HOME SIMPLE BRUSHED",
  "TOALLERO HOME BARRA 45 BRUSHED",
];

async function main() {
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error("Es la base VIVA y no se pasó --si-la-viva. Abortado.");
  }
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const aQuitar: Array<{
    id: string; name: string; detail: string | null; referenceLink: string;
    listPrice: number; discountPercent: number | null;
    webListPrice: number | null; webSalePrice: number | null;
    webCheckedAt: Date | null; usos: number;
  }> = [];

  for (const n of NOMBRES) {
    const c = await prisma.artefactoCatalog.findFirst({
      where: { name: n },
      select: {
        id: true, name: true, detail: true, referenceLink: true,
        listPrice: true, discountPercent: true,
        webListPrice: true, webSalePrice: true, webCheckedAt: true,
      },
    });
    if (!c) { console.log(`OJO  ${n} — no está en el catálogo\n`); continue; }
    if (!c.referenceLink) { console.log(`     ${n} — ya estaba sin link\n`); continue; }
    const usos = await prisma.artefactoItem.count({ where: { catalogId: c.id } });
    aQuitar.push({ ...c, referenceLink: c.referenceLink, usos });
    console.log(`── ${c.name}`);
    console.log(`   detalle: ${c.detail ?? "(vacío)"}`);
    console.log(`   link que se guarda y se saca: ${c.referenceLink}`);
    console.log(`   precio (NO se toca): ${CLP(c.listPrice)} · ${Math.round((c.discountPercent ?? 0) * 100)}%`);
    console.log(`   se usa en ${usos} línea(s) de cotización — tampoco se les toca nada\n`);
  }

  console.log(`A quitar: ${aQuitar.length} links`);
  if (!APLICAR || aQuitar.length === 0) {
    if (!APLICAR) console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  writeFileSync(
    RESPALDO,
    JSON.stringify(
      {
        generado: "2026-08-04",
        motivo:
          "Links quitados por decisión de MJ: MK declara otro acabado que el del catálogo. Guardados por si hay que volver atrás o para retomar la búsqueda del producto correcto.",
        host: HOST,
        productos: aQuitar.map((a) => ({
          id: a.id, name: a.name, detail: a.detail,
          referenceLink: a.referenceLink,
          listPrice: a.listPrice, discountPercent: a.discountPercent,
          ultimaLecturaWeb: a.webCheckedAt
            ? { listPrice: a.webListPrice, salePrice: a.webSalePrice, cuando: a.webCheckedAt }
            : null,
          usosEnCotizaciones: a.usos,
        })),
      },
      null,
      2
    )
  );
  console.log(`\nRespaldo escrito en ${RESPALDO}`);

  for (const a of aQuitar) {
    await prisma.artefactoCatalog.update({
      where: { id: a.id },
      data: {
        referenceLink: null,
        // La referencia de internet correspondía al producto que MJ dice que no
        // es el suyo: se limpia para no dejar un precio de otra cosa colgado.
        webListPrice: null, webSalePrice: null, webCheckedAt: null,
        webUnreadableSince: null,
      },
    });
    console.log(`  sin link: ${a.name}`);
  }

  console.log("\n═══ VERIFICACIÓN ═══");
  for (const a of aQuitar) {
    const c = await prisma.artefactoCatalog.findUnique({
      where: { id: a.id },
      select: { referenceLink: true, listPrice: true, discountPercent: true },
    });
    const precioIntacto = c?.listPrice === a.listPrice &&
      Math.abs((c?.discountPercent ?? 0) - (a.discountPercent ?? 0)) < 0.0001;
    console.log(
      `  ${!c?.referenceLink && precioIntacto ? "OK  " : "OJO "} ${a.name}: sin link · ${CLP(c?.listPrice ?? 0)} · ${Math.round((c?.discountPercent ?? 0) * 100)}%`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
