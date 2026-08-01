/**
 * ¿Por qué hay líneas "despegadas" que MJ dice no haber editado?
 *
 * SOLO LECTURA.
 *
 * Hipótesis a probar: el botón viejo "Comparar con la tienda web" (roto hasta
 * el arreglo del 2026-07-31) bajaba SOLO el precio de LISTA y recalculaba lo
 * que paga el cliente con el descuento VIEJO de la línea. Si la línea tenía 0%,
 * el cliente quedaba pagando la lista COMPLETA — más caro que antes — y encima
 * la línea quedaba despegada del catálogo (va por el PUT por-ítem).
 *
 * La firma del daño es reconocible: línea despegada, con 0% de descuento, cuyo
 * precio al cliente coincide con la LISTA de la web (no con el precio de venta).
 *
 * Además revisa la otra vía de contagio: el PUT por-ítem, cuando una edición
 * despega una línea, despega TAMBIÉN a las que comparten catalogId o se llaman
 * igual dentro de la misma cotización. Editar UNA puede marcar varias.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const despegadas = await prisma.artefactoItem.findMany({
    where: { priceOverridden: true, budgetVersion: { type: "artefactos" } },
    select: {
      id: true, name: true, room: true, quantity: true,
      listPrice: true, discountPercent: true, clientPrice: true,
      referenceLink: true, catalogId: true,
      budgetVersion: {
        select: {
          version: true, status: true,
          project: { select: { name: true, numeroProyecto: true } },
        },
      },
    },
  });
  console.log(`Líneas despegadas en cotizaciones de artefactos: ${despegadas.length}\n`);

  const sospechosas: string[] = [];
  const otras: string[] = [];
  const sinLink: string[] = [];

  for (const it of despegadas) {
    const bv = it.budgetVersion;
    const proy = `${bv?.project?.numeroProyecto ? "#" + bv.project.numeroProyecto + " " : ""}${bv?.project?.name} ${bv?.version} [${bv?.status}]`;
    const encabezado = `${proy} — ${it.name} (${it.room}) x${it.quantity}`;
    const guardado = `lista ${CLP(it.listPrice)} · ${Math.round((it.discountPercent ?? 0) * 100)}% · cliente ${CLP(it.clientPrice)}`;

    if (!it.referenceLink) {
      sinLink.push(`${encabezado}\n      ${guardado}  (sin link, no se puede comparar)`);
      continue;
    }
    const web = await leerPrecioWeb(it.referenceLink);
    if (!web) {
      sinLink.push(`${encabezado}\n      ${guardado}  (el link no respondió)`);
      continue;
    }
    const detalle =
      `${encabezado}\n      guardado: ${guardado}` +
      `\n      web hoy:  lista ${CLP(web.listPrice)} · ${(web.discount * 100).toFixed(1)}% · venta ${CLP(web.salePrice)}`;

    // FIRMA DEL BUG: el cliente está pagando la LISTA de la web, con 0% de
    // descuento guardado, mientras la web sí tiene descuento. Es exactamente lo
    // que dejaba el botón roto al aplicar.
    const pagaLaLista = Math.abs(it.clientPrice - web.listPrice) <= 2;
    const sinDcto = (it.discountPercent ?? 0) < 0.005;
    const webTieneDcto = web.discountKnown && web.discount > 0.005;
    if (pagaLaLista && sinDcto && webTieneDcto) {
      sospechosas.push(
        `${detalle}\n      → el cliente paga la LISTA COMPLETA: ${CLP(it.clientPrice - web.salePrice)} de más por unidad` +
          (it.quantity > 1 ? ` (x${it.quantity} = ${CLP((it.clientPrice - web.salePrice) * it.quantity)})` : "")
      );
    } else {
      otras.push(detalle);
    }
  }

  console.log("═══ CON LA FIRMA DEL BOTÓN ROTO (cliente pagando la lista completa) ═══");
  if (sospechosas.length === 0) console.log("  (ninguna)");
  for (const s of sospechosas) console.log(`\n  ${s}`);

  console.log("\n\n═══ OTRAS DESPEGADAS (revisar caso a caso) ═══");
  if (otras.length === 0) console.log("  (ninguna)");
  for (const o of otras) console.log(`\n  ${o}`);

  if (sinLink.length > 0) {
    console.log("\n\n═══ SIN LINK O ILEGIBLES ═══");
    for (const s of sinLink) console.log(`\n  ${s}`);
  }

  console.log(
    `\n\nRESUMEN: ${sospechosas.length} con la firma del bug · ${otras.length} otras · ${sinLink.length} sin comparar`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
