// SOLO LECTURA — comprueba los dos casos de los pendientes 166 y 167.
// No escribe nada.
//
//   npx tsx scripts/diag-166-167.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const url = readFileSync(process.argv[2], "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1]
  .trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);

async function main() {
  console.log("host:", url.match(/@([^/]+)/)?.[1]);

  // ── 167: los pares de devolución ────────────────────────────────────────
  console.log("\n167 — PARES DE DEVOLUCIÓN (netZeroGroupId)\n");
  const conGrupo = await prisma.bankMovement.findMany({
    where: { netZeroGroupId: { not: null } },
    select: {
      id: true,
      date: true,
      amount: true,
      counterpartyName: true,
      description: true,
      status: true,
      netZeroGroupId: true,
      netZeroAmount: true,
    },
    orderBy: { date: "asc" },
  });
  const porGrupo = new Map<string, typeof conGrupo>();
  for (const m of conGrupo) {
    const g = m.netZeroGroupId!;
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), m]);
  }
  for (const [g, movs] of porGrupo) {
    console.log(`  grupo ${g.slice(0, 8)} — ${movs.length} movimientos`);
    for (const m of movs)
      console.log(
        `     ${d(m.date)} ${clp(m.amount).padStart(14)} [${m.status.padEnd(11)}] ` +
          `neteado ${clp(m.netZeroAmount ?? 0).padStart(10)} · ${(m.counterpartyName ?? m.description).slice(0, 30)}`
      );
  }
  const sueltos = [...porGrupo.values()].filter((v) => v.length < 2);
  console.log(
    `\n  >> ${porGrupo.size} grupos · ${sueltos.length} incompletos (deberían ser 0)`
  );

  // ── 166: la NC de SODIMAC y su factura referenciada ─────────────────────
  console.log("\n166 — NC DE SODIMAC Y SU FACTURA REFERENCIADA\n");
  const nc = await prisma.invoice.findFirst({
    where: { folioNumber: "61496059", tipoDoc: 61 },
    select: {
      id: true,
      folioNumber: true,
      type: true,
      rutIssuer: true,
      totalAmount: true,
      referenceFolioNumber: true,
      businessName: true,
    },
  });
  if (!nc) {
    console.log("  la NC 61496059 no está en la base");
    return;
  }
  console.log(
    `  NC F-${nc.folioNumber} ${clp(nc.totalAmount)} · ${nc.businessName} · referencia F-${nc.referenceFolioNumber}`
  );

  const referida = await prisma.invoice.findFirst({
    where: {
      type: nc.type,
      tipoDoc: { in: [33, 34] },
      folioNumber: nc.referenceFolioNumber ?? "",
      rutIssuer: nc.rutIssuer ?? undefined,
    },
    select: {
      folioNumber: true,
      issueDate: true,
      totalAmount: true,
      status: true,
      project: { select: { name: true } },
    },
  });
  console.log(
    referida
      ? `  la factura SÍ ESTÁ: F-${referida.folioNumber} ${d(referida.issueDate)} ${clp(referida.totalAmount)} [${referida.status}] ${referida.project?.name ?? "sin obra"}`
      : `  la factura NO está en la base`
  );

  // ¿Entra en las 50 más recientes del mismo proveedor? Ese es el corte que
  // hacía que el cartel dijera "no sincronizada".
  const top50 = await prisma.invoice.findMany({
    where: {
      type: nc.type,
      tipoDoc: { in: [33, 34] },
      rutIssuer: nc.rutIssuer ?? undefined,
      NOT: { id: nc.id },
    },
    orderBy: { issueDate: "desc" },
    select: { folioNumber: true },
    take: 50,
  });
  const totalProveedor = await prisma.invoice.count({
    where: {
      type: nc.type,
      tipoDoc: { in: [33, 34] },
      rutIssuer: nc.rutIssuer ?? undefined,
    },
  });
  const entra = top50.some((c) => c.folioNumber === nc.referenceFolioNumber);
  console.log(
    `  el proveedor tiene ${totalProveedor} facturas · ¿la referenciada entra en las 50 últimas? ${entra ? "SÍ" : "NO ← por eso el cartel mentía"}`
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
