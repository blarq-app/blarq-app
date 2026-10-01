/**
 * Copia las bisagras DPH del catálogo a la pestaña SAMET (pedido de MJ,
 * 2026-10-01).
 *
 * Por qué: Samet no tiene tienda web ni lista de productos online, pero las
 * bisagras son las mismas que vende DPH con otra marca. MJ quiere partir de
 * las de DPH (nombre, carpeta, color y foto) y ponerles ella el precio Samet.
 *
 * Qué copia y qué no:
 *   - Mismo nombre SIN "Par": Samet vende por unidad, DPH por par.
 *   - Misma carpeta, color y foto (la foto ya es una copia guardada en la app,
 *     así que no depende de dph.cl).
 *   - Marca "Samet" (como la escribió MJ en su primer herraje SAMET).
 *   - NO copia el SKU ni el link de DPH: con el link, "Revisar precios"
 *     compararía contra la web de DPH, que no es el precio de Samet.
 *   - Costo $0: lo pone MJ. clientPrice null (costo + 20%).
 *   - La "Bisagra 3D Recta Cierre Suave Par" NO se copia: MJ ya tenía
 *     "Bisagra Recta Cierre Suave" en SAMET con su precio ($3.600). A esa se
 *     le pone la foto y la carpeta de la DPH, sin tocar nombre ni precio.
 *
 * No toca nada de DPH. Si se corre dos veces, no duplica (salta las que ya
 * existen en SAMET con el mismo nombre y color).
 *
 * Escribe en la base VIVA (ep-shy-morning). Lee la conexión de .env.prod de la
 * carpeta principal a propósito: NO usa dotenv, porque .env apunta a la vieja.
 *
 * Uso:
 *   npx tsx scripts/copiar-bisagras-dph-a-samet.ts           → solo muestra
 *   npx tsx scripts/copiar-bisagras-dph-a-samet.ts --write   → guarda
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const env = fs.readFileSync(ENV_PROD, "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!url || !url.includes("ep-shy-morning")) {
  throw new Error(`${ENV_PROD} no apunta a la base viva (ep-shy-morning)`);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const WRITE = process.argv.includes("--write");

// La bisagra DPH que NO se copia y el herraje SAMET de MJ que la reemplaza.
const DPH_RECTA_3D_ID = "cmqpsm6ek0001rtw5k216uv9x";
const SAMET_RECTA_MJ_ID = "cmupsyexs0000jq04t0ed8sbb";

// "Bisagra Curva Sin Retén  Par" → "Bisagra Curva Sin Retén". Solo saca el
// "par" final como palabra suelta ("para marco" no se toca).
function sinPar(nombre: string): string {
  return nombre.replace(/\s+par\s*$/i, "").replace(/\s+/g, " ").trim();
}

function clave(name: string, finish: string | null): string {
  return `${sinPar(name).toLowerCase()}|${(finish ?? "").toLowerCase()}`;
}

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  if (p64?.name !== "Paseo del Sena") {
    throw new Error(`marcador #64 no calza (${p64?.name}): no es la base viva`);
  }
  console.log(`Base viva OK (#64 = ${p64.name}). Modo: ${WRITE ? "GUARDAR" : "solo mostrar"}\n`);

  const dph = await prisma.herrajeCatalog.findMany({
    where: { supplier: "DPH", category: "bisagra" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const samet = await prisma.herrajeCatalog.findMany({
    where: { supplier: "SAMET" },
  });
  const yaEnSamet = new Set(samet.map((s) => clave(s.name, s.finish)));

  const aCrear = dph
    .filter((d) => d.id !== DPH_RECTA_3D_ID)
    .filter((d) => !yaEnSamet.has(clave(d.name, d.finish)))
    .map((d) => ({
      name: sinPar(d.name),
      detail: d.detail,
      supplier: "SAMET",
      category: d.category,
      subgroup: d.subgroup,
      measure: d.measure,
      finish: d.finish,
      brand: "Samet",
      sku: null,
      referenceLink: null,
      imageUrl: d.imageUrl,
      costNet: 0,
      clientPrice: null,
      sortOrder: d.sortOrder,
    }));

  console.log(`Copias nuevas en SAMET: ${aCrear.length}`);
  for (const c of aCrear) {
    console.log(
      `  ${(c.subgroup ?? "").padEnd(16)} ${c.name}${c.finish ? ` · ${c.finish}` : ""}  foto:${c.imageUrl ? "sí" : "NO"}  costo:${c.costNet}`
    );
  }

  // El herraje de MJ: solo completa foto y carpeta si siguen vacías.
  const dphRecta = dph.find((d) => d.id === DPH_RECTA_3D_ID);
  const deMj = samet.find((s) => s.id === SAMET_RECTA_MJ_ID);
  // Además va en el lugar de la DPH que reemplaza dentro de la carpeta.
  const patchMj: { imageUrl?: string; subgroup?: string; sortOrder?: number } = {};
  if (deMj && dphRecta) {
    if (!deMj.imageUrl && dphRecta.imageUrl) patchMj.imageUrl = dphRecta.imageUrl;
    if (!deMj.subgroup && dphRecta.subgroup) patchMj.subgroup = dphRecta.subgroup;
    if (patchMj.imageUrl || patchMj.subgroup) patchMj.sortOrder = dphRecta.sortOrder;
  }
  const cambiosMj = [
    patchMj.imageUrl ? "foto" : null,
    patchMj.subgroup ? `carpeta "${patchMj.subgroup}"` : null,
  ].filter(Boolean);
  console.log(
    `\nHerraje de MJ "${deMj?.name.trim()}" ($${deMj?.costNet}): ` +
      (cambiosMj.length
        ? `se le pone ${cambiosMj.join(" + ")} (nombre y precio no se tocan)`
        : "nada que completar")
  );

  if (!WRITE) {
    console.log("\nSolo mostrar: no se guardó nada. Correr con --write para guardar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (aCrear.length) await tx.herrajeCatalog.createMany({ data: aCrear });
    if (deMj && cambiosMj.length) {
      await tx.herrajeCatalog.update({ where: { id: deMj.id }, data: patchMj });
    }
  });

  const total = await prisma.herrajeCatalog.count({ where: { supplier: "SAMET" } });
  console.log(`\nGuardado. SAMET ahora tiene ${total} herrajes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
