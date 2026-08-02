/**
 * Líneas despegadas SIN una razón de precio, en las cotizaciones que todavía se
 * pueden mover. SOLO LECTURA.
 *
 * Una línea despegada deja de recibir los precios del catálogo. Eso tiene
 * sentido si MJ fijó un precio a mano; no lo tiene si se despegó por aceptar
 * una foto, un nombre o un link (ver H0b del informe de auditoría).
 *
 * El criterio para separar unas de otras es el precio contra el catálogo:
 *   - Todo igual (lista, descuento y precio a cliente) → no hay ninguna
 *     decisión de precio detrás. Se despegó por error y conviene volver a
 *     pegarla.
 *   - Algo distinto → puede ser una decisión de MJ. Se muestra la diferencia
 *     para que ella juzgue; el script NO decide por ella.
 *
 * Mira las cotizaciones en BORRADOR: son las únicas donde estar pegada cambia
 * algo, porque las enviadas y aprobadas están congeladas por estado.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number | null) => `${Math.round((d ?? 0) * 100)}%`;

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const despegadas = await prisma.artefactoItem.findMany({
    where: {
      priceOverridden: true,
      budgetVersion: { type: "artefactos", status: "borrador" },
    },
    select: {
      id: true, name: true, room: true, listPrice: true, discountPercent: true,
      clientPrice: true, quantity: true, catalogId: true,
      budgetVersion: {
        select: {
          version: true,
          project: { select: { name: true, status: true, numeroProyecto: true } },
        },
      },
    },
  });

  const sinRazon: typeof despegadas = [];
  const conRazon: Array<{ it: (typeof despegadas)[number]; motivo: string }> = [];
  const sinCatalogo: typeof despegadas = [];

  for (const it of despegadas) {
    if (!it.catalogId) { sinCatalogo.push(it); continue; }
    const cat = await prisma.artefactoCatalog.findUnique({
      where: { id: it.catalogId },
      select: { listPrice: true, discountPercent: true },
    });
    if (!cat) { sinCatalogo.push(it); continue; }
    const catCliente = cat.listPrice * (1 - (cat.discountPercent ?? 0));
    const difLista = Math.abs(it.listPrice - cat.listPrice) > 1;
    const difDcto = Math.abs((it.discountPercent ?? 0) - (cat.discountPercent ?? 0)) > 0.005;
    const difCliente = Math.abs(it.clientPrice - catCliente) > 1;
    if (!difLista && !difDcto && !difCliente) {
      sinRazon.push(it);
    } else {
      const partes: string[] = [];
      if (difLista) partes.push(`lista ${CLP(it.listPrice)} vs ${CLP(cat.listPrice)}`);
      if (difDcto) partes.push(`dcto ${PCT(it.discountPercent)} vs ${PCT(cat.discountPercent)}`);
      if (difCliente) partes.push(`cliente ${CLP(it.clientPrice)} vs ${CLP(catCliente)}`);
      conRazon.push({ it, motivo: partes.join(" · ") });
    }
  }

  const etiqueta = (it: (typeof despegadas)[number]) => {
    const bv = it.budgetVersion;
    const num = bv?.project?.numeroProyecto ? `#${bv.project.numeroProyecto} ` : "";
    return `${num}${bv?.project?.name} ${bv?.version} [proyecto: ${bv?.project?.status}] — ${it.name} (${it.room})`;
  };

  console.log("═══ DESPEGADAS SIN RAZÓN DE PRECIO — son las del error ═══");
  console.log("(el precio es exactamente el del catálogo: nadie decidió nada acá)\n");
  if (sinRazon.length === 0) console.log("  (ninguna)");
  for (const it of sinRazon) {
    console.log(`  · ${etiqueta(it)}`);
    console.log(`      ${CLP(it.listPrice)} · ${PCT(it.discountPercent)} · ${CLP(it.clientPrice)}`);
  }

  console.log("\n\n═══ DESPEGADAS CON EL PRECIO DISTINTO AL CATÁLOGO ═══");
  console.log("(puede ser una decisión tuya; mirá cada una antes de pegarla)\n");
  if (conRazon.length === 0) console.log("  (ninguna)");
  for (const { it, motivo } of conRazon) {
    console.log(`  · ${etiqueta(it)}`);
    console.log(`      ${motivo}`);
  }

  if (sinCatalogo.length > 0) {
    console.log("\n\n═══ SIN VÍNCULO AL CATÁLOGO ═══");
    console.log("(no se pueden comparar ni pegar: no vienen de un producto del catálogo)\n");
    for (const it of sinCatalogo) console.log(`  · ${etiqueta(it)}`);
  }

  console.log(
    `\n\nRESUMEN de las cotizaciones en borrador: ${sinRazon.length} despegadas por error · ${conRazon.length} con precio propio · ${sinCatalogo.length} sin catálogo`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
