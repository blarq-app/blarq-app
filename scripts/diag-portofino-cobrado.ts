/**
 * ¿De dónde sale el "Cobrado" de la tarjeta del proyecto?
 *
 * Espejo de `src/lib/projects/metrics.ts`: son las facturas EMITIDAS del
 * proyecto, con las notas de crédito (tipoDoc 61) restando. Este script las
 * lista una por una para poder cuadrar el número contra los documentos.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

async function main() {
  console.log("HOST:", host);

  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 60 },
    include: {
      invoices: {
        where: { type: "emitida" },
        orderBy: { issueDate: "asc" },
        include: { payments: true },
      },
    },
  });
  if (!p) throw new Error("no existe #60");

  console.log(`\n=== FACTURAS EMITIDAS de #${p.numeroProyecto} ${p.name} ===`);
  console.log("fecha | tipoDoc | folio | neto | c/IVA | estado | pagos registrados");

  const signo = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  let neto = 0;
  let conIva = 0;
  let pagado = 0;

  for (const f of p.invoices) {
    const s = signo(f);
    neto += s * f.netAmount;
    conIva += s * f.totalAmount;
    const pagos = f.payments.reduce((a, x) => a + x.amountApplied, 0);
    pagado += s * pagos;
    console.log(
      [
        f.issueDate.toISOString().slice(0, 10),
        f.tipoDoc === 61 ? "61 (NC)" : String(f.tipoDoc ?? "-"),
        f.folioNumber ?? "-",
        clp(s * f.netAmount),
        clp(s * f.totalAmount),
        f.status,
        f.payments.length ? `${f.payments.length} · ${clp(pagos)}` : "sin pagos",
      ].join(" | ")
    );
  }

  console.log(`\nFacturas emitidas: ${p.invoices.length}`);
  console.log(`COBRADO neto   ${clp(neto)}   <- el número grande de la tarjeta`);
  console.log(`COBRADO c/IVA  ${clp(conIva)}   <- el de abajo`);
  console.log(`De esas facturas, con pago registrado en el banco: ${clp(pagado)}`);
  console.log(
    `Facturas emitidas SIN pago registrado: ${p.invoices.filter((f) => f.payments.length === 0).length}`
  );

  // Comparación contra lo acordado (obra V7 + muebles + artefactos vigentes).
  const versiones = await prisma.budgetVersion.findMany({
    where: { projectId: p.id },
    include: { obraItems: true, muebleItems: true, artefactoItems: true },
  });
  const vigente = <T extends { status: string; createdAt: Date }>(arr: T[]) =>
    arr
      .filter((b) => b.status === "enviado" || b.status === "aprobado")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
    [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const obra = vigente(versiones.filter((v) => v.type === "obra"));
  const muebles = vigente(versiones.filter((v) => v.type === "muebles"));
  const artefactos = vigente(versiones.filter((v) => v.type === "artefactos"));
  const cd = obra.obraItems.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0);
  const obraTotal =
    cd * (1 + (obra.ggPercentage ?? 0) / 100 + (obra.utilityPercentage ?? 0) / 100) * 1.19;
  const mueblesTotal = muebles.muebleItems.reduce((s, i) => s + i.clientPriceIva * i.quantity, 0);
  const artefactosTotal = artefactos.artefactoItems.reduce((s, i) => s + i.clientPrice * i.quantity, 0);
  const acordado = obraTotal + mueblesTotal + artefactosTotal;

  console.log(`\nACORDADO c/IVA ${clp(acordado)}  (obra ${obra.version} ${clp(obraTotal)} + muebles ${clp(mueblesTotal)} + artefactos ${clp(artefactosTotal)})`);
  console.log(`FACTURADO c/IVA ${clp(conIva)}`);
  console.log(`Diferencia (facturado - acordado): ${clp(conIva - acordado)}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
