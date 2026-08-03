/**
 * Desmarca las líneas que quedaron con "descuento propio" sin que MJ decidiera
 * nada: son las que tomaron el precio de la tienda desde "Comparar con la
 * tienda web" mientras el guardado marcaba cualquier cambio de porcentaje como
 * decisión suya (arreglado el 2026-08-03).
 *
 * Cómo se reconocen: el descuento guardado coincide con el que la TIENDA tiene
 * hoy. Si MJ hubiera decidido ese número, sería casualidad que dé exacto contra
 * la web. Las que difieren no se tocan.
 *
 * NO mueve ni un peso: el precio se queda igual, solo cambia de quién dice la
 * app que es ese descuento. Lo que se gana es que esas líneas vuelvan a recibir
 * los descuentos nuevos del catálogo en vez de quedarse congeladas.
 *
 *   npx tsx scripts/fix-descuento-marcado-por-error.ts                  # dry-run
 *   npx tsx scripts/fix-descuento-marcado-por-error.ts --aplicar --si-la-viva
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
console.log("HOST:", HOST);
console.log("MODO:", APLICAR ? "APLICAR" : "DRY-RUN");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number | null) => `${Math.round((d ?? 0) * 100)}%`;

async function main() {
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error("Es la base VIVA y no se pasó --si-la-viva. Abortado.");
  }
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const marcadas = await prisma.artefactoItem.findMany({
    where: { discountOverridden: true },
    select: {
      id: true, name: true, room: true, listPrice: true, discountPercent: true,
      clientPrice: true, referenceLink: true, catalogId: true,
      budgetVersion: { select: { version: true, project: { select: { name: true } } } },
    },
  });
  console.log(`Líneas marcadas como "descuento propio": ${marcadas.length}\n`);

  const desmarcar: typeof marcadas = [];
  const conservar: Array<{ it: (typeof marcadas)[number]; motivo: string }> = [];

  for (const it of marcadas) {
    const cat = it.catalogId
      ? await prisma.artefactoCatalog.findUnique({
          where: { id: it.catalogId },
          select: { referenceLink: true },
        })
      : null;
    const link = it.referenceLink ?? cat?.referenceLink ?? null;
    const web = link ? await leerPrecioWeb(link) : null;
    if (!web || !web.discountKnown) {
      conservar.push({ it, motivo: "no se pudo leer la tienda: se deja como está" });
      continue;
    }
    if (Math.abs((it.discountPercent ?? 0) - web.discount) <= 0.005) {
      desmarcar.push(it);
    } else {
      conservar.push({
        it,
        motivo: `su ${PCT(it.discountPercent)} no es el de la tienda (${PCT(web.discount)}): parece decisión de MJ`,
      });
    }
  }

  console.log("═══ A DESMARCAR: el descuento es el de la tienda, no una decisión ═══\n");
  if (desmarcar.length === 0) console.log("  (ninguna)");
  for (const it of desmarcar) {
    console.log(
      `  · ${it.budgetVersion?.project?.name} ${it.budgetVersion?.version} — ${it.name} (${it.room})`
    );
    console.log(`      ${CLP(it.listPrice)} · ${PCT(it.discountPercent)} · ${CLP(it.clientPrice)}`);
  }

  console.log("\n\n═══ SE CONSERVAN ═══\n");
  if (conservar.length === 0) console.log("  (ninguna)");
  for (const { it, motivo } of conservar) {
    console.log(`  · ${it.budgetVersion?.project?.name} — ${it.name}`);
    console.log(`      ${motivo}`);
  }

  if (!APLICAR || desmarcar.length === 0) {
    if (!APLICAR) console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  const versiones = [
    ...new Set(
      (
        await prisma.artefactoItem.findMany({
          where: { id: { in: desmarcar.map((i) => i.id) } },
          select: { budgetVersionId: true },
        })
      ).map((x) => x.budgetVersionId)
    ),
  ];
  const totalDe = async (bvId: string) => {
    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: bvId },
      select: { clientPrice: true, quantity: true },
    });
    return items.reduce((a, i) => a + i.clientPrice * i.quantity, 0);
  };
  const antes = new Map<string, number>();
  for (const v of versiones) antes.set(v, await totalDe(v));

  const res = await prisma.artefactoItem.updateMany({
    where: { id: { in: desmarcar.map((i) => i.id) } },
    data: { discountOverridden: false },
  });
  console.log(`\nDesmarcadas: ${res.count} líneas.`);

  console.log("\n═══ TOTALES ═══");
  for (const v of versiones) {
    const bv = await prisma.budgetVersion.findUnique({
      where: { id: v },
      select: { version: true, project: { select: { name: true } } },
    });
    const ahora = await totalDe(v);
    const ant = antes.get(v)!;
    console.log(
      `  ${bv?.project?.name} ${bv?.version}: ${CLP(ant)} → ${CLP(ahora)}${Math.abs(ahora - ant) <= 1 ? "  (sin cambio)" : "  OJO"}`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
