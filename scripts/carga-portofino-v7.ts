/**
 * Carga el presupuesto de OBRA V7 de Portofino (proyecto #60) a la base VIVA.
 *
 * Fuente: `V7_ OBRA_PORTOFINO_17.06.26.xlsx`, hoja PRESUPUESTO, parseada por
 * `scripts/parse-portofino-v7.py`. Decisiones tomadas con MJ el 2026-07-30:
 *
 *   1. Cada partida entra con el COSTO TOTAL de la columna P.U y la MANO DE
 *      OBRA de la hoja RESUMENES (columna L). Todo lo que no es mano de obra
 *      entra como MATERIAL, sin desglose fino: el Excel tiene el desglose en
 *      BASE DATOS, pero su mano de obra NO es la que se le paga al maestro
 *      (la V6 cargada quedó con 5 partidas con la MO equivocada por eso).
 *      No se crean ObraItemComponent: la app los siembra sola desde los montos
 *      globales el día que MJ empiece a detallar una partida.
 *
 *   2. CALEFONT (4.1) va con el precio del PDF que firmó la clienta
 *      ($343.393), NO con el del Excel ($468.393). Esa celda del Excel es una
 *      fórmula viva contra la hoja BASE DATOS y se movió sola después de
 *      emitir el PDF del 17.06.26. El PDF es lo acordado.
 *
 *   3. Las 13 partidas "rojas" (filas 95-107 del Excel) van con noCobrado:
 *      se le pagan al maestro y salen en su alcance y sus estados de pago,
 *      pero quedan fuera del total del cliente y del PDF de la cotización.
 *      Su valor ES la mano de obra — no tienen costo al cliente.
 *
 *   4. Los 4 descuentos del PDF ($642.440 en total) SÍ son al cliente. El PDF
 *      los resta al final, después del IVA, pero la app no sabe descontar
 *      pesos en un presupuesto de obra (`discountPercentage` solo se lee en
 *      muebles). Se representan como una partida negativa en ADICIONALES cuyo
 *      valor está DIVIDIDO por 1,27 × 1,19: al pasar por GG, utilidad e IVA
 *      vuelve a valer los $642.440 y el total al cliente cae exacto en
 *      $61.396.984. Sus montos de material y mano de obra quedan en 0 a
 *      propósito: un descuento no es un costo y no debe ensuciar el
 *      presupuesto por categoría de metrics.ts.
 *
 *   5. COCINA y BAÑOS son sub-capítulos (campo `subChapter`), no partidas en
 *      cero como quedaron en la V6.
 *
 *   6. La V7 nace APROBADA: pasa a ser la versión vigente del proyecto
 *      (selectVigente toma la más reciente aprobada), así que reemplaza a la
 *      V6 en el Resumen, la utilidad y las alertas. La V6 queda intacta.
 *
 *   7. Sin formas de pago (decisión de MJ: igual que la V6).
 *
 * El `lineageId` se hereda de la partida equivalente de la V6 (mismo nombre y
 * unidad) para no romper la identidad de la partida entre versiones. Las 2
 * partidas nuevas, las 13 no cobradas y el descuento estrenan lineage.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9).
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const JSON_V7 =
  "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad/portofino-v7-partidas.json";

const APPLY = process.argv.includes("--apply");

// ── Ajustes acordados con MJ ───────────────────────────────────────────────
const CALEFONT_PDF = 343393; // el Excel dice 468.392,86; manda el PDF
const DESCUENTO_CLIENTE = 642440; // calefont 329.990 + gabinete 76.990 + materiales 55.460 + MO 180.000
const GG = 20;
const UTILIDAD = 7;
const FACTOR = 1.27 * 1.19; // GG + utilidad + IVA sobre el costo directo
const FECHA_V7 = new Date("2026-06-17T12:00:00Z"); // fecha del PDF de entrega

const url = readFileSync(ENV_PROD, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");

type Fila = {
  tipo: string;
  capitulo: number;
  subCapitulo: string | null;
  item: string;
  nombre: string;
  descripcion: string | null;
  unidad: string;
  cantidad: number;
  puCosto: number;
  totalCosto: number;
  puMO: number;
  totalMO: number;
  puMaterial: number;
  noCobrado: boolean;
};

async function main() {
  console.log("HOST:", host);
  if (!host.includes("ep-shy-morning")) throw new Error("No es la base viva — PARAR");
  console.log("MODO:", APPLY ? "APLICAR (escribe)" : "DRY-RUN (no escribe nada)");

  const marcador = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("MARCADOR #64:", marcador?.name);
  if (marcador?.name !== "Paseo del Sena") throw new Error("Marcador no calza — PARAR");

  const proyecto = await prisma.project.findFirst({
    where: { numeroProyecto: 60 },
    select: { id: true, name: true, currentVersion: true },
  });
  if (!proyecto) throw new Error("no existe el proyecto #60");

  const yaExiste = await prisma.budgetVersion.findFirst({
    where: { projectId: proyecto.id, type: "obra", version: "V7" },
  });
  if (yaExiste) throw new Error(`Ya existe una obra V7 (${yaExiste.id}) — PARAR`);

  const v6 = await prisma.budgetVersion.findFirst({
    where: { projectId: proyecto.id, type: "obra", version: "V6" },
    include: { obraItems: true },
  });
  if (!v6) throw new Error("no existe la obra V6 (la necesito para heredar el lineage)");

  // ── Preparar las filas ───────────────────────────────────────────────────
  const d = JSON.parse(readFileSync(JSON_V7, "utf8"));
  const caps: Record<number, string> = Object.fromEntries(
    d.capitulos.map((c: any) => [c.numero, c.nombre])
  );
  const filas: Fila[] = d.partidas.filter((p: Fila) => p.tipo !== "subcapitulo");

  // Ajuste 2: el calefont manda del PDF.
  const calefont = filas.find((f) => f.nombre === "INSTALACION CALEFONT O CALDERA");
  if (!calefont) throw new Error("no encontré el calefont");
  const calefontExcel = calefont.puCosto;
  calefont.puCosto = CALEFONT_PDF;
  calefont.totalCosto = CALEFONT_PDF * calefont.cantidad;
  calefont.puMaterial = CALEFONT_PDF - calefont.puMO;

  // Ajuste 4: la partida de descuento, al final de ADICIONALES.
  const capAdicionales = Math.max(...filas.map((f) => f.capitulo));
  const descuentoCD = -(DESCUENTO_CLIENTE / FACTOR);
  filas.push({
    tipo: "descuento",
    capitulo: capAdicionales,
    subCapitulo: null,
    item: "",
    nombre: "DESCUENTO SEGÚN ACUERDO",
    descripcion:
      "CALEFONT 14LT, GABINETE, MATERIALES Y MANO DE OBRA — según entrega del 17.06.26",
    unidad: "GL",
    cantidad: 1,
    puCosto: descuentoCD,
    totalCosto: descuentoCD,
    puMO: 0,
    totalMO: 0,
    puMaterial: 0,
    noCobrado: false,
  });

  // Numeración: los rojos y el descuento siguen la última de ADICIONALES.
  const ultimoNum = Math.max(
    ...filas
      .filter((f) => f.capitulo === capAdicionales && /^\d+\.\d+$/.test(f.item))
      .map((f) => Number(f.item.split(".")[1]))
  );
  let siguiente = ultimoNum;
  for (const f of filas) {
    if (!f.item) f.item = `${capAdicionales}.${++siguiente}`;
  }

  // Lineage heredado de la V6 por nombre + unidad.
  const key = (n: string, u: string) => `${n.trim().toUpperCase()}|${u.trim().toUpperCase()}`;
  const porClave = new Map<string, string[]>();
  for (const i of v6.obraItems) {
    if (i.quantity === 0 && i.total === 0) continue; // los COCINA/BAÑOS viejos
    const k = key(i.name, i.unit);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k)!.push(i.lineageId);
  }
  let heredados = 0;
  const lineage = filas.map((f) => {
    const cola = porClave.get(key(f.nombre, f.unidad));
    const id = cola?.shift();
    if (id) heredados++;
    return id ?? null;
  });

  // ── Controles ────────────────────────────────────────────────────────────
  const cobrables = filas.filter((f) => !f.noCobrado);
  const cd = cobrables.reduce((s, f) => s + f.totalCosto, 0);
  const cdSinDescuento = cd - descuentoCD;
  const totalCliente = cd * FACTOR;
  const mo = filas.reduce((s, f) => s + f.totalMO, 0);

  console.log(`\nProyecto: #60 ${proyecto.name} (${proyecto.id})`);
  console.log(`V6 origen: ${v6.id} — ${v6.obraItems.length} partidas`);
  console.log(`Calefont: Excel ${clp(calefontExcel)} → PDF ${clp(CALEFONT_PDF)}`);
  console.log(`Descuento: ${clp(DESCUENTO_CLIENTE)} al cliente → partida de ${clp(descuentoCD)} de costo directo`);
  console.log(`Lineage heredado de la V6: ${heredados} de ${filas.length} partidas`);

  console.log("\n=== CAPÍTULOS ===");
  for (const [n, nombre] of Object.entries(caps)) console.log(`  ${n}. ${nombre}`);

  console.log("\n=== PARTIDAS ===");
  console.log("item | cap | sub | nombre | un | cant | P.U | total | MO/un | material/un | marca");
  for (const [idx, f] of filas.entries()) {
    console.log(
      [
        f.item,
        f.capitulo,
        f.subCapitulo ?? "",
        f.nombre,
        f.unidad,
        f.cantidad,
        Math.round(f.puCosto),
        Math.round(f.totalCosto),
        Math.round(f.puMO),
        Math.round(f.puMaterial),
        f.noCobrado ? "NO COBRAR" : f.tipo === "descuento" ? "DESCUENTO" : "",
        lineage[idx] ? "" : "lineage nuevo",
      ].join(" | ")
    );
  }

  console.log("\n=== TOTALES DE LA V7 QUE SE VA A CREAR ===");
  console.log(`  Costo directo (antes del descuento) ${clp(cdSinDescuento)}   [PDF: $41.050.370]`);
  console.log(`  Partida de descuento                ${clp(descuentoCD)}`);
  console.log(`  Costo directo cargado               ${clp(cd)}`);
  console.log(`  + GG ${GG}%                            ${clp(cd * (GG / 100))}`);
  console.log(`  + Utilidad ${UTILIDAD}%                      ${clp(cd * (UTILIDAD / 100))}`);
  console.log(`  = Costo neto                        ${clp(cd * 1.27)}`);
  console.log(`  + IVA 19%                           ${clp(cd * 1.27 * 0.19)}`);
  console.log(`  = TOTAL AL CLIENTE                  ${clp(totalCliente)}   [PDF: $61.396.984]`);
  console.log(`  Mano de obra total                  ${clp(mo)}   [Excel: $19.964.630]`);
  console.log(`  Partidas: ${cobrables.length} cobrables (incluye el descuento) + ${filas.length - cobrables.length} no cobradas`);

  const objetivo = 61396984;
  const dif = Math.round(totalCliente) - objetivo;
  console.log(`\n  Diferencia contra el total del PDF: ${clp(dif)} ${Math.abs(dif) <= 2 ? "— OK" : "— REVISAR"}`);
  if (Math.abs(dif) > 2) throw new Error("El total no calza con el PDF — PARAR");

  // Deja las filas FINALES (ya con el calefont del PDF y la partida de
  // descuento) para que la página de revisión que mira MJ se arme de acá y no
  // de una copia paralela del cálculo.
  writeFileSync(
    JSON_V7.replace("partidas.json", "partidas-final.json"),
    JSON.stringify(
      {
        capitulos: d.capitulos,
        filas,
        control: {
          costoDirectoSinDescuento: cdSinDescuento,
          descuentoCD,
          descuentoCliente: DESCUENTO_CLIENTE,
          costoDirecto: cd,
          gg: cd * (GG / 100),
          utilidad: cd * (UTILIDAD / 100),
          neto: cd * 1.27,
          iva: cd * 1.27 * 0.19,
          totalCliente,
          moTotal: mo,
          moRojos: filas.filter((f) => f.noCobrado).reduce((s, f) => s + f.totalMO, 0),
          nCobrables: cobrables.length,
          nRojos: filas.length - cobrables.length,
          calefontExcel,
          calefontPdf: CALEFONT_PDF,
        },
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada. Correr con --apply para cargar.");
    return;
  }

  // ── Escritura ────────────────────────────────────────────────────────────
  const creada = await prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.create({
      data: {
        projectId: proyecto.id,
        version: "V7",
        parentVersionId: v6.id,
        date: FECHA_V7,
        status: "aprobado",
        type: "obra",
        ggPercentage: GG,
        utilityPercentage: UTILIDAD,
        discountPercentage: 0,
        observations:
          "Cargada del Excel V7_OBRA_PORTOFINO_17.06.26 + PDF de entrega E11. " +
          "El calefont va con el precio del PDF ($343.393). El descuento acordado de " +
          "$642.440 c/IVA está representado como partida negativa en ADICIONALES.",
      },
    });

    const capIds = new Map<number, string>();
    for (const [n, nombre] of Object.entries(caps)) {
      const c = await tx.obraChapter.create({
        data: {
          budgetVersionId: version.id,
          name: nombre as string,
          sortOrder: Number(n) - 1,
        },
      });
      capIds.set(Number(n), c.id);
    }

    for (const [idx, f] of filas.entries()) {
      await tx.obraItem.create({
        data: {
          budgetVersionId: version.id,
          ...(lineage[idx] ? { lineageId: lineage[idx]! } : {}),
          chapterId: capIds.get(f.capitulo)!,
          chapter: slug(caps[f.capitulo]),
          subChapter: f.subCapitulo,
          itemNumber: f.item,
          name: f.nombre,
          descriptionCliente: f.descripcion,
          descriptionMaestro: f.descripcion,
          unit: f.unidad,
          quantity: f.cantidad,
          unitPrice: f.puCosto,
          total: f.totalCosto,
          costMaterial: f.puMaterial,
          costLabor: f.puMO,
          sortOrder: idx,
          isCustomized: true,
          noCobrado: f.noCobrado,
        },
      });
    }

    await tx.project.update({
      where: { id: proyecto.id },
      data: { currentVersion: "V7" },
    });

    return version;
  },
  // Son ~90 inserciones de a una contra Neon (pooler, con latencia). El
  // default de 5s de Prisma no alcanza y la transacción se cae a la mitad —
  // pasó en el primer intento. Revierte entera, así que no queda nada a
  // medias, pero conviene darle aire para no repetir el viaje.
  { timeout: 120_000, maxWait: 20_000 });

  console.log(`\nCREADA la obra V7: ${creada.id}`);
  console.log("currentVersion del proyecto → V7");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
