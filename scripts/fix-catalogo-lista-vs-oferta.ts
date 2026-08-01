/**
 * Limpieza de los productos del catálogo que quedaron con el precio de OFERTA
 * guardado como si fuera el precio de LISTA, con 0% de descuento.
 *
 * Origen (auditoría 2026-07-31): hasta el arreglo de hoy, el autocompletar por
 * link leía UN solo precio de la página — el de venta del día. Si el producto
 * estaba en oferta, entraba como lista con 0%. Quedaron así entradas como el
 * horno de $247.990 cuya lista real es $519.990 con 52% de descuento.
 *
 * Qué corrige: separa lista y descuento reales SIN mover lo que paga el
 * cliente. El criterio de seguridad es el mismo que usó
 * `fix-catalogo-dcto-seguro.ts` en junio:
 *
 *   SEGURO   → el total guardado hoy coincide con el precio de venta de la web:
 *              se guarda lista = web.listPrice y dcto = web.discount, y el
 *              total queda idéntico. Solo se separa bien la información.
 *   REVISAR  → el total guardado NO coincide con el de la web (el precio se
 *              movió desde que se cargó). Corregirlo cambiaría lo que paga el
 *              cliente, así que NO se toca: se lista para que MJ decida.
 *
 * Por defecto corre en DRY-RUN (no escribe nada). Para aplicar hace falta
 * pasar --aplicar Y confirmar contra qué base:
 *
 *   npx tsx scripts/fix-catalogo-lista-vs-oferta.ts                  # dry-run viva
 *   npx tsx scripts/fix-catalogo-lista-vs-oferta.ts --aplicar --si-la-viva
 *
 * Dos flags más, para el pedido de MJ del 2026-08-01 ("cambiá todo"):
 *
 *   --todos      incluye también el grupo REVISAR, o sea los productos donde
 *                el precio al cliente SÍ baja porque la tienda lo cambió desde
 *                que se cargaron. Sin este flag, esos no se tocan.
 *   --propagar   después de tocar el catálogo, baja los precios nuevos a las
 *                cotizaciones en BORRADOR cuyas líneas no estén despegadas —
 *                exactamente lo que hace la app sola cuando MJ edita un
 *                producto desde la pantalla del catálogo (misma función,
 *                propagateCatalogToBorradores). Sin este flag el cambio queda
 *                solo en el catálogo y las cotizaciones no se enteran.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");
const TODOS = process.argv.includes("--todos");
const PROPAGAR = process.argv.includes("--propagar");

// Se lee el DATABASE_URL directo del archivo (NO con dotenv, que carga el .env
// de desarrollo) y se imprime el host, como manda el §4.9 del CLAUDE.md.
const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number) => (d * 100).toFixed(1) + "%";

async function main() {
  console.log("HOST:", HOST);
  console.log("MODO:", APLICAR ? "APLICAR (escribe)" : "DRY-RUN (no escribe nada)");
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error(
      "Es la base VIVA y no se pasó --si-la-viva. Abortado a propósito."
    );
  }

  // Marcador de la base viva (§4.9).
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)");

  // Candidatos: 0% de descuento y link a una tienda que SÍ publica el descuento.
  const cats = await prisma.artefactoCatalog.findMany({
    where: {
      referenceLink: { not: null },
      OR: [{ discountPercent: null }, { discountPercent: 0 }],
    },
    select: {
      id: true,
      name: true,
      subcategory: true,
      listPrice: true,
      discountPercent: true,
      referenceLink: true,
    },
  });
  const candidatos = cats.filter((c) =>
    /mk\.cl|ledstudio\.cl|kitchenhouse\.cl/.test(c.referenceLink!)
  );
  console.log(`\nCandidatos a revisar: ${candidatos.length}\n`);

  const seguros: Array<{
    id: string;
    name: string;
    antes: string;
    despues: string;
    listPrice: number;
    discount: number;
  }> = [];
  const revisar: Array<{
    id: string;
    name: string;
    antes: string;
    despues: string;
    listPrice: number;
    discount: number;
    deltaCliente: number;
  }> = [];
  const sinCambio: string[] = [];
  const ilegibles: string[] = [];

  for (const c of candidatos) {
    const web = await leerPrecioWeb(c.referenceLink!);
    if (!web) {
      ilegibles.push(`${c.name} — ${c.referenceLink}`);
      continue;
    }
    if (!web.discountKnown || web.discount <= 0.005) {
      sinCambio.push(`${c.name} (la web no tiene descuento hoy)`);
      continue;
    }
    // Lo que hoy paga el cliente por este producto (lista guardada, dcto 0).
    const totalHoy = Math.round(c.listPrice * (1 - (c.discountPercent ?? 0)));
    const totalNuevo = Math.round(web.listPrice * (1 - web.discount));
    if (Math.abs(totalHoy - web.salePrice) <= 2 && Math.abs(totalNuevo - totalHoy) <= 2) {
      seguros.push({
        id: c.id,
        name: c.name,
        antes: `lista ${CLP(c.listPrice)} · 0% · cliente ${CLP(totalHoy)}`,
        despues: `lista ${CLP(web.listPrice)} · ${PCT(web.discount)} · cliente ${CLP(totalNuevo)}`,
        listPrice: web.listPrice,
        discount: web.discount,
      });
    } else {
      revisar.push({
        id: c.id,
        name: c.name,
        antes: `lista ${CLP(c.listPrice)} · ${PCT(c.discountPercent ?? 0)} · cliente ${CLP(totalHoy)}`,
        despues: `lista ${CLP(web.listPrice)} · ${PCT(web.discount)} · cliente ${CLP(totalNuevo)}`,
        listPrice: web.listPrice,
        discount: web.discount,
        deltaCliente: totalNuevo - totalHoy,
      });
    }
  }

  console.log("═══ SEGUROS: se separa lista y descuento, el cliente paga LO MISMO ═══");
  if (seguros.length === 0) console.log("  (ninguno)");
  for (const s of seguros) {
    console.log(`\n  ${s.name}`);
    console.log(`      antes:   ${s.antes}`);
    console.log(`      después: ${s.despues}`);
  }

  console.log(
    TODOS
      ? "\n\n═══ TAMBIÉN SE APLICAN (--todos): acá el precio al cliente SÍ cambia ═══"
      : "\n\n═══ A REVISAR: acá el precio al cliente SÍ cambiaría — NO se tocan ═══"
  );
  if (revisar.length === 0) console.log("  (ninguno)");
  for (const r of revisar) {
    console.log(`\n  ${r.name}`);
    console.log(`      antes:   ${r.antes}`);
    console.log(`      después: ${r.despues}`);
    console.log(`      el cliente paga ${CLP(r.deltaCliente)}`);
  }

  console.log(`\n\n═══ Sin cambios (${sinCambio.length}) — la web no tiene descuento hoy ═══`);
  for (const s of sinCambio) console.log(`  ${s}`);

  if (ilegibles.length > 0) {
    console.log(`\n═══ No se pudieron leer (${ilegibles.length}) — link roto o descontinuado ═══`);
    for (const i of ilegibles) console.log(`  ${i}`);
  }

  // Efecto colateral a mirar: líneas de cotización que apuntan a estos
  // productos. Como el total no se mueve, no cambia plata, pero conviene saber
  // cuántas son.
  if (seguros.length > 0) {
    const afectadas = await prisma.artefactoItem.count({
      where: {
        catalogId: { in: seguros.map((s) => s.id) },
        priceOverridden: false,
        budgetVersion: { status: "borrador" },
      },
    });
    console.log(
      `\nLíneas de cotizaciones en BORRADOR que usan estos productos: ${afectadas}`
    );
    console.log(
      "  (este script escribe solo en el catálogo; no propaga a las cotizaciones)"
    );
  }

  console.log(
    `\nRESUMEN: ${seguros.length} seguros · ${revisar.length} a revisar · ${sinCambio.length} sin cambio · ${ilegibles.length} ilegibles`
  );

  if (!APLICAR) {
    console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  const aAplicar = TODOS ? [...seguros, ...revisar] : seguros;

  // Foto de los totales de las cotizaciones que podrían moverse, ANTES.
  const idsCat = aAplicar.map((x) => x.id);
  const versionesAfectadas = await prisma.artefactoItem.findMany({
    where: {
      catalogId: { in: idsCat },
      priceOverridden: false,
      budgetVersion: { status: "borrador" },
    },
    select: { budgetVersionId: true },
    distinct: ["budgetVersionId"],
  });
  const totalDe = async (bvId: string) => {
    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId: bvId },
      select: { clientPrice: true, quantity: true },
    });
    return items.reduce((acc, i) => acc + i.clientPrice * i.quantity, 0);
  };
  const antesTotales = new Map<string, number>();
  for (const v of versionesAfectadas) {
    antesTotales.set(v.budgetVersionId, await totalDe(v.budgetVersionId));
  }

  for (const s of aAplicar) {
    const actualizado = await prisma.artefactoCatalog.update({
      where: { id: s.id },
      data: {
        listPrice: s.listPrice,
        discountPercent: s.discount,
        lastPriceCheck: new Date(),
      },
      select: {
        name: true, detail: true, brand: true, listPrice: true,
        discountPercent: true, referenceLink: true, imageUrl: true,
      },
    });
    let lineas = 0;
    if (PROPAGAR) {
      lineas = await propagarABorradores(s.id, actualizado);
    }
    console.log(
      `  aplicado: ${s.name}${PROPAGAR ? ` (bajó a ${lineas} línea${lineas === 1 ? "" : "s"} de cotización)` : ""}`
    );
  }
  console.log(`\nAPLICADO a ${aAplicar.length} productos del catálogo.`);

  if (PROPAGAR && versionesAfectadas.length > 0) {
    console.log("\n═══ TOTAL DE ARTEFACTOS DE LAS COTIZACIONES TOCADAS ═══");
    for (const v of versionesAfectadas) {
      const bv = await prisma.budgetVersion.findUnique({
        where: { id: v.budgetVersionId },
        select: { version: true, project: { select: { name: true } } },
      });
      const antes = antesTotales.get(v.budgetVersionId)!;
      const ahora = await totalDe(v.budgetVersionId);
      console.log(
        `  ${bv?.project?.name} ${bv?.version}: ${CLP(antes)} → ${CLP(ahora)}` +
          (Math.abs(ahora - antes) < 1 ? "  (sin cambio)" : `  (${CLP(ahora - antes)})`)
      );
    }
  }
}

/**
 * Baja los datos del producto a las líneas de cotización que lo siguen: solo
 * BORRADORES y solo líneas NO despegadas. Es la misma regla y los mismos campos
 * que `propagateCatalogToBorradores` (src/lib/catalog/syncArtefactos.ts), que es
 * lo que la app corre sola al editar un producto desde la pantalla del catálogo.
 *
 * GOTCHA por el que está duplicada acá en vez de importarse: ese módulo importa
 * el `prisma` global de `src/lib/prisma.ts`, que se construye SIN datasource
 * explícito y por lo tanto lee el DATABASE_URL del `.env` — la base de
 * DESARROLLO. Importarla desde un script que apunta a la viva hace que el
 * catálogo se actualice en la viva y la propagación se ejecute contra dev, sin
 * ningún error visible: devuelve 0 líneas y parece que no había nada que
 * actualizar. Pasó en la primera corrida de este script (2026-08-01).
 */
async function propagarABorradores(
  catalogId: string,
  cat: {
    name: string;
    detail: string | null;
    brand: string | null;
    listPrice: number;
    discountPercent: number | null;
    referenceLink: string | null;
    imageUrl: string | null;
  }
): Promise<number> {
  const descuento = cat.discountPercent ?? null;
  const clientPrice = cat.listPrice * (1 - (descuento ?? 0));
  const res = await prisma.artefactoItem.updateMany({
    where: {
      catalogId,
      priceOverridden: false,
      budgetVersion: { status: "borrador" },
    },
    data: {
      name: cat.name,
      detail: cat.detail,
      brand: cat.brand,
      listPrice: cat.listPrice,
      discountPercent: descuento,
      clientPrice,
      referenceLink: cat.referenceLink,
      imageUrl: cat.imageUrl,
    },
  });
  return res.count;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
