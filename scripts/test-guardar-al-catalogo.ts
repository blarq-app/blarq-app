/**
 * Test de regresión de "Guardar al catálogo" (crear un molde nuevo desde una
 * partida armada de cero en una cotización).
 *
 * Cubre los 4 casos que importan:
 *   1. Partida CON desglose  → el molde queda con sus líneas y el P.U. sale de
 *      la suma del desglose.
 *   2. Partida SIN desglose  → el molde conserva los 6 montos globales y el
 *      P.U. Es la trampa del feature: copiar el desglose de una partida vacía
 *      dispararía el recálculo desde componentes y dejaría el molde en $0.
 *   3. Nombre repetido       → responde 409 y NO crea un segundo molde.
 *   4. Homologación          → el capítulo "INSTALACIONES ELECTRICAS" cae en la
 *      categoría "INSTALACIONES ELECT." del catálogo, sin inventar una nueva.
 *
 * Corre contra el servidor de dev levantado (por HTTP, o sea prueba el endpoint
 * de verdad) y contra la base de DESARROLLO. Aborta si la base es la viva.
 * Siembra y borra todo lo suyo en un finally.
 *
 * Correr con:  npx tsx scripts/test-guardar-al-catalogo.ts [url]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";
import { homologarCategoria } from "../src/lib/catalog/homologarCategoria";

const BASE = process.argv[2] ?? "http://localhost:3061";
const MARCA = "__TEST_GUARDAR_AL_CATALOGO__";
const prisma = new PrismaClient();

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

let ok = 0;
let fallos = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    ok++;
    console.log("  ✓", msg);
  } else {
    fallos++;
    console.log("  ✗", msg);
  }
}

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf(
    "sha256",
    SECRET,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "test" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("test-guardar-al-catalogo")
    .encrypt(key);
}

async function limpiar() {
  await prisma.partidaCatalog.deleteMany({ where: { name: { startsWith: MARCA } } });
  const items = await prisma.obraItem.findMany({
    where: { name: { startsWith: MARCA } },
    select: { id: true },
  });
  for (const it of items) await prisma.obraItem.delete({ where: { id: it.id } });
  await prisma.obraChapter.deleteMany({ where: { name: { startsWith: MARCA } } });
  const bvs = await prisma.budgetVersion.findMany({
    where: { project: { name: MARCA } },
    select: { id: true },
  });
  for (const b of bvs) await prisma.budgetVersion.delete({ where: { id: b.id } });
  await prisma.project.deleteMany({ where: { name: MARCA } });
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:]+)/)?.[1] ?? "?";
  console.log("Base:", host);
  if (host.includes("shy-morning")) {
    throw new Error("ABORTA: el test siembra y borra datos; no corre contra la viva.");
  }

  await limpiar();
  const ck = await cookie();

  // ── Homologación (puro, sin base) ──────────────────────────────────────
  console.log("\nHOMOLOGACIÓN de capítulo → categoría del catálogo");
  check(
    homologarCategoria("INSTALACIONES ELECTRICAS").categoria === "INSTALACIONES ELECT.",
    "INSTALACIONES ELECTRICAS → INSTALACIONES ELECT."
  );
  check(
    homologarCategoria("INSTALACIONES SANITARIAS Y GASFITERIA").categoria ===
      "INSTALACIONES SANITARIAS",
    "INSTALACIONES SANITARIAS Y GASFITERIA → INSTALACIONES SANITARIAS"
  );
  check(
    homologarCategoria("LIMPIEZA Y ASEO").categoria === "ASEO Y LIMPIEZA",
    "LIMPIEZA Y ASEO → ASEO Y LIMPIEZA"
  );
  check(
    homologarCategoria("Instalaciones Eléctricas").categoria === "INSTALACIONES ELECT.",
    "aguanta minúsculas y tildes"
  );
  check(
    homologarCategoria("TERMINACIONES").esNueva === false,
    "TERMINACIONES ya es una categoría conocida"
  );
  const adicionales = homologarCategoria("ADICIONALES");
  check(
    adicionales.categoria === "ADICIONALES" && adicionales.esNueva === true,
    "un capítulo sin equivalente (ADICIONALES) se marca como categoría nueva"
  );

  // ── Armar un presupuesto de juguete ────────────────────────────────────
  const proyecto = await prisma.project.create({
    data: { name: MARCA, clientName: MARCA, status: "cotizacion" },
  });
  const bv = await prisma.budgetVersion.create({
    data: { projectId: proyecto.id, version: "V1", type: "obra", status: "borrador" },
  });
  const cap = await prisma.obraChapter.create({
    data: { budgetVersionId: bv.id, name: "INSTALACIONES ELECTRICAS", sortOrder: 0 },
  });

  async function nuevaPartida(sufijo: string, conDesglose: boolean) {
    const item = await prisma.obraItem.create({
      data: {
        budgetVersionId: bv.id,
        chapterId: cap.id,
        chapter: "electricas",
        itemNumber: "1.1",
        name: `${MARCA}${sufijo}`,
        unit: "M2",
        quantity: 10,
        unitPrice: conDesglose ? 0 : 50000,
        total: conDesglose ? 0 : 500000,
        costMaterial: conDesglose ? 0 : 30000,
        costLabor: conDesglose ? 0 : 15000,
        costMargin: conDesglose ? 0 : 5000,
      },
    });
    if (conDesglose) {
      await prisma.obraItemComponent.createMany({
        data: [
          {
            obraItemId: item.id,
            type: "material",
            description: "CABLE 2.5MM",
            unit: "ML",
            quantity: 20,
            unitCost: 800,
            totalCost: 16000,
            sortOrder: 0,
          },
          {
            obraItemId: item.id,
            type: "mano_obra",
            description: "ELECTRICISTA",
            unit: "DIA",
            quantity: 2,
            unitCost: 45000,
            totalCost: 90000,
            sortOrder: 1,
          },
        ],
      });
      await prisma.obraItem.update({
        where: { id: item.id },
        data: { costMaterial: 16000, costLabor: 90000, unitPrice: 106000 },
      });
    }
    return item;
  }

  async function guardar(itemId: string) {
    const r = await fetch(
      `${BASE}/api/presupuestos/${bv.id}/partidas/${itemId}/crear-en-catalogo`,
      { method: "POST", headers: { cookie: `authjs.session-token=${ck}` } }
    );
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  // ── CASO 1 — partida CON desglose ──────────────────────────────────────
  console.log("\nCASO 1 — partida con desglose");
  const conD = await nuevaPartida("-CON-DESGLOSE", true);
  const r1 = await guardar(conD.id);
  check(r1.status === 200, `responde 200 (fue ${r1.status})`);
  const molde1 = await prisma.partidaCatalog.findFirst({
    where: { name: `${MARCA}-CON-DESGLOSE` },
    include: { components: true },
  });
  check(!!molde1, "el molde existe en el catálogo");
  check(
    molde1?.category === "INSTALACIONES ELECT.",
    `queda en INSTALACIONES ELECT. (quedó en ${molde1?.category})`
  );
  check(molde1?.unit === "M2", "conserva la unidad de la partida");
  check(molde1?.components.length === 2, `copió las 2 líneas (copió ${molde1?.components.length})`);
  check(
    Math.round(molde1?.unitPrice ?? 0) === 106000,
    `P.U. del molde = suma del desglose $106.000 (dio $${Math.round(molde1?.unitPrice ?? 0)})`
  );
  check(
    Math.round(molde1?.costLabor ?? 0) === 90000,
    `mano de obra $90.000 (dio $${Math.round(molde1?.costLabor ?? 0)})`
  );
  const enganchada = await prisma.obraItem.findUnique({
    where: { id: conD.id },
    select: { catalogPartidaId: true },
  });
  check(
    enganchada?.catalogPartidaId === molde1?.id,
    "la partida de la cotización queda enganchada al molde nuevo"
  );

  // ── CASO 2 — partida SIN desglose (montos globales) ────────────────────
  console.log("\nCASO 2 — partida sin desglose (solo montos globales)");
  const sinD = await nuevaPartida("-SIN-DESGLOSE", false);
  const r2 = await guardar(sinD.id);
  check(r2.status === 200, `responde 200 (fue ${r2.status})`);
  const molde2 = await prisma.partidaCatalog.findFirst({
    where: { name: `${MARCA}-SIN-DESGLOSE` },
    include: { components: true },
  });
  check(molde2?.components.length === 0, "el molde queda sin líneas (la partida no tenía)");
  check(
    Math.round(molde2?.unitPrice ?? 0) === 50000,
    `el P.U. NO se borra: $50.000 (dio $${Math.round(molde2?.unitPrice ?? 0)})`
  );
  check(
    Math.round(molde2?.costMaterial ?? 0) === 30000 &&
      Math.round(molde2?.costLabor ?? 0) === 15000 &&
      Math.round(molde2?.costMargin ?? 0) === 5000,
    "los 6 rubros de costo se copian tal cual"
  );

  // ── CASO 3 — nombre repetido ───────────────────────────────────────────
  console.log("\nCASO 3 — ya existe un molde con ese nombre y categoría");
  const repe = await nuevaPartida("-CON-DESGLOSE", true); // mismo nombre que el caso 1
  const r3 = await guardar(repe.id);
  check(r3.status === 409, `responde 409 (fue ${r3.status})`);
  check(
    typeof r3.body.error === "string" && /[Yy]a existe/.test(r3.body.error),
    "el mensaje avisa que ya existe"
  );
  const cuantos = await prisma.partidaCatalog.count({
    where: { name: `${MARCA}-CON-DESGLOSE` },
  });
  check(cuantos === 1, `NO duplicó el molde (hay ${cuantos})`);
  const repeItem = await prisma.obraItem.findUnique({
    where: { id: repe.id },
    select: { catalogPartidaId: true },
  });
  check(
    repeItem?.catalogPartidaId === null,
    "la partida repetida queda SIN enganchar (no se pisa el molde ajeno)"
  );

  // ── CASO 4 — la partida ya tiene molde ─────────────────────────────────
  console.log("\nCASO 4 — la partida ya está enganchada a un molde");
  const r4 = await guardar(conD.id);
  check(r4.status === 409, `responde 409 (fue ${r4.status})`);
  check(
    typeof r4.body.error === "string" && /ya está guardada/i.test(r4.body.error),
    "el mensaje manda a usar el botón de actualizar precios"
  );
}

main()
  .then(() => {
    console.log(`\n${fallos === 0 ? "TODO OK." : "HAY FALLOS."} ${ok} ok · ${fallos} fallos`);
  })
  .catch((e) => {
    console.error(e);
    fallos++;
  })
  .finally(async () => {
    await limpiar();
    await prisma.$disconnect();
    process.exit(fallos === 0 ? 0 : 1);
  });
