// Prueba de regresión del motor de etiquetas de traspasos a Sueldos.
//
// Cubre los 5 comportamientos que importan del bot (sin pasar por Telegram —
// acá se prueba la lógica, no la mensajería):
//   1. El traspaso YA está en la app → se etiqueta al toque.
//   2. El traspaso todavía NO llegó → la etiqueta queda esperando, y el import
//      la aplica sola cuando el traspaso entra.
//   3. Los DOS lados del par quedan etiquetados (no solo en el que se clickeó).
//   4. No pisa lo que ya estaba puesto a mano.
//   5. Si hay más de un traspaso con la misma fecha y monto, NO elige.
//
// Corre contra la base de DESARROLLO. Crea sus propios datos de prueba (una
// cuenta espejo, movimientos con glosa TEST-TRASPASO) y los borra al terminar.
// NO correr contra la base viva.
//
// Uso: npx tsx scripts/test-pending-transfer-tags.ts <ruta-env-dev>
import { readFileSync } from "fs";
import type { PrismaClient } from "@prisma/client";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Falta la ruta al .env (usar el de DESARROLLO)");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
process.env.DATABASE_URL = url;
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

// Red de seguridad: este script ESCRIBE. Si apunta a la base viva, se niega.
if (host.includes("shy-morning")) {
  console.error("ABORTADO: esto escribe datos de prueba y apunta a la base VIVA.");
  process.exit(1);
}

const GLOSA = "TEST-TRASPASO-BOT";
let fallos = 0;

function chequear(nombre: string, ok: boolean, detalle = "") {
  console.log(`  ${ok ? "OK  " : "FALLA"} · ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  console.log("=== HOST:", host, "===\n");
  const { prisma } = await import("@/lib/prisma");
  const {
    createPendingTransferTag,
    resolverEtiqueta,
    applyPendingTransferTagsForMovement,
    completarConcepto,
  } = await import("@/lib/banco/pendingTransferTags");

  // ── Preparación: dos cuentas (una operativa, una de sueldos) y una obra ──
  const operativa = await prisma.bankAccount.findFirst({ where: { role: "operating" } });
  const sueldos = await prisma.bankAccount.findFirst({ where: { role: "salary_fund" } });
  const obra = await prisma.project.findFirst({
    where: { status: { not: "archivado" } },
    select: { id: true, name: true },
  });
  if (!operativa || !sueldos || !obra) {
    console.error("Falta cuenta operativa, cuenta sueldos u obra en esta base.");
    process.exit(1);
  }
  console.log(`Obra de prueba: ${obra.name}`);
  console.log(`Cuentas: ${operativa.alias} → ${sueldos.alias}\n`);

  // Limpieza previa por si quedó basura de una corrida anterior.
  await limpiar(prisma);

  /** Crea un par de traspaso interno linkeado (los dos lados). */
  async function crearTraspaso(fecha: Date, monto: number) {
    const sale = await prisma.bankMovement.create({
      data: {
        bankAccountId: operativa!.id,
        date: fecha,
        description: `${GLOSA} salida`,
        amount: -monto,
        type: "cargo",
        category: "transfer_interno",
        status: "interno",
      },
    });
    const entra = await prisma.bankMovement.create({
      data: {
        bankAccountId: sueldos!.id,
        date: fecha,
        description: `${GLOSA} entrada`,
        amount: monto,
        type: "abono",
        category: "transfer_interno",
        status: "interno",
        internalTransferToId: sale.id,
      },
    });
    await prisma.bankMovement.update({
      where: { id: sale.id },
      data: { internalTransferToId: entra.id },
    });
    return { sale, entra };
  }

  // ══ CASO 1: el traspaso YA existe cuando llega el comprobante ══
  console.log("CASO 1 — el traspaso ya está en la app:");
  const f1 = new Date("2031-03-10T00:00:00.000Z"); // fecha futura: no choca con datos reales
  const par1 = await crearTraspaso(f1, 1_234_567);
  const tag1 = await createPendingTransferTag({
    transferDate: f1,
    amount: 1_234_567,
    bankName: "Santander",
    destination: "Cuenta Sueldos",
    projectId: obra.id,
    concepto: "obra",
    requestedBy: "1", requestedByName: "test",
  });
  const r1 = await resolverEtiqueta(tag1);
  chequear("se etiqueta al toque", r1?.tipo === "aplicada", `tipo=${r1?.tipo}`);

  // CASO 3 (va junto): los DOS lados quedan etiquetados.
  const lado1 = await prisma.bankMovement.findUnique({ where: { id: par1.sale.id } });
  const lado2 = await prisma.bankMovement.findUnique({ where: { id: par1.entra.id } });
  chequear(
    "los dos lados del par quedan con obra y concepto",
    lado1?.projectId === obra.id && lado2?.projectId === obra.id &&
      lado1?.internalConcepto === "obra" && lado2?.internalConcepto === "obra",
    `salida=${lado1?.internalConcepto ?? "—"}/${lado1?.projectId ? "obra ok" : "sin obra"}, entrada=${lado2?.internalConcepto ?? "—"}`
  );
  const tagAplicada = await prisma.pendingTransferTag.findUnique({ where: { id: tag1 } });
  chequear("la etiqueta queda 'aplicada'", tagAplicada?.status === "aplicada", `status=${tagAplicada?.status}`);

  // ══ CASO 2: el traspaso todavía NO llegó ══
  console.log("\nCASO 2 — el comprobante llega ANTES que la cartola:");
  const f2 = new Date("2031-03-11T00:00:00.000Z");
  const tag2 = await createPendingTransferTag({
    transferDate: f2,
    amount: 2_500_000,
    bankName: "Santander", destination: "Cuenta Sueldos",
    projectId: obra.id, concepto: "muebles",
    requestedBy: "1", requestedByName: "test",
  });
  const r2 = await resolverEtiqueta(tag2);
  chequear("queda esperando (no inventa un movimiento)", r2?.tipo === "en_espera", `tipo=${r2?.tipo}`);

  // Ahora "se importa la cartola": aparece el traspaso.
  const par2 = await crearTraspaso(f2, 2_500_000);
  const aplicadas = await applyPendingTransferTagsForMovement(par2.entra.id);
  chequear("el import aplica la etiqueta sola", aplicadas === 1, `aplicadas=${aplicadas}`);
  const mov2 = await prisma.bankMovement.findUnique({ where: { id: par2.sale.id } });
  chequear(
    "el traspaso importado queda con obra y concepto",
    mov2?.projectId === obra.id && mov2?.internalConcepto === "muebles",
    `obra=${mov2?.projectId === obra.id ? "sí" : "no"}, concepto=${mov2?.internalConcepto}`
  );

  // ══ CASO 4: no pisar lo ya puesto a mano ══
  console.log("\nCASO 4 — el traspaso ya tenía obra puesta a mano:");
  const f4 = new Date("2031-03-12T00:00:00.000Z");
  const otraObra = await prisma.project.findFirst({
    where: { status: { not: "archivado" }, id: { not: obra.id } },
    select: { id: true, name: true },
  });
  const par4 = await crearTraspaso(f4, 999_111);
  await prisma.bankMovement.updateMany({
    where: { id: { in: [par4.sale.id, par4.entra.id] } },
    data: { projectId: otraObra?.id ?? obra.id, internalConcepto: "obra" },
  });
  const tag4 = await createPendingTransferTag({
    transferDate: f4, amount: 999_111,
    bankName: null, destination: null,
    projectId: obra.id, concepto: "muebles",
    requestedBy: "1", requestedByName: "test",
  });
  const r4 = await resolverEtiqueta(tag4);
  const mov4 = await prisma.bankMovement.findUnique({ where: { id: par4.entra.id } });
  chequear(
    "no pisa la obra ni el concepto que ya estaban",
    r4?.tipo === "aplicada" &&
      r4.resultado.setProject === false &&
      r4.resultado.setConcepto === false &&
      mov4?.projectId === (otraObra?.id ?? obra.id) &&
      mov4?.internalConcepto === "obra",
    `quedó obra=${mov4?.projectId === otraObra?.id ? otraObra?.name : "(la del bot)"}, concepto=${mov4?.internalConcepto}`
  );

  // ══ CASO 5: dos traspasos iguales el mismo día → NO elegir ══
  console.log("\nCASO 5 — dos traspasos con la misma fecha y monto:");
  const f5 = new Date("2031-03-13T00:00:00.000Z");
  await crearTraspaso(f5, 777_000);
  await crearTraspaso(f5, 777_000);
  const tag5 = await createPendingTransferTag({
    transferDate: f5, amount: 777_000,
    bankName: null, destination: null,
    projectId: obra.id, concepto: "obra",
    requestedBy: "1", requestedByName: "test",
  });
  const r5 = await resolverEtiqueta(tag5);
  chequear(
    "no elige: devuelve los candidatos para preguntar",
    r5?.tipo === "ambiguo" && r5.candidatos.length === 2,
    `tipo=${r5?.tipo}, candidatos=${r5?.tipo === "ambiguo" ? r5.candidatos.length : "—"}`
  );

  // ══ CASO 6: falta el concepto → no se aplica sola ══
  console.log("\nCASO 6 — comprobante sin decir obra/muebles:");
  const f6 = new Date("2031-03-14T00:00:00.000Z");
  const par6 = await crearTraspaso(f6, 555_000);
  const tag6 = await createPendingTransferTag({
    transferDate: f6, amount: 555_000,
    bankName: null, destination: null,
    projectId: obra.id, concepto: null,
    requestedBy: "1", requestedByName: "test",
  });
  const t6 = await prisma.pendingTransferTag.findUnique({ where: { id: tag6 } });
  chequear("queda 'por_confirmar'", t6?.status === "por_confirmar", `status=${t6?.status}`);
  const sinAplicar = await applyPendingTransferTagsForMovement(par6.entra.id);
  chequear("el import NO la aplica mientras falte el concepto", sinAplicar === 0, `aplicadas=${sinAplicar}`);
  await completarConcepto(tag6, "obra");
  const r6 = await resolverEtiqueta(tag6);
  const mov6 = await prisma.bankMovement.findUnique({ where: { id: par6.entra.id } });
  chequear(
    "al tocar el botón del concepto, se etiqueta",
    r6?.tipo === "aplicada" && mov6?.internalConcepto === "obra",
    `concepto=${mov6?.internalConcepto}`
  );

  await limpiar(prisma);
  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLA(S)`}`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

/** Borra los datos de prueba (movimientos con la glosa + sus etiquetas). */
async function limpiar(prisma: PrismaClient) {
  const movs = await prisma.bankMovement.findMany({
    where: { description: { startsWith: GLOSA } },
    select: { id: true },
  });
  const ids = movs.map((m) => m.id);
  if (ids.length > 0) {
    // Soltar los links del par antes de borrar (la FK apunta entre ellos).
    await prisma.bankMovement.updateMany({
      where: { id: { in: ids } },
      data: { internalTransferToId: null },
    });
    await prisma.bankMovement.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.pendingTransferTag.deleteMany({
    where: { requestedByName: "test" },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
