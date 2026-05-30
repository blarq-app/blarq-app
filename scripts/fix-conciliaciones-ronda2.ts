// Segunda tanda de arreglos de conciliación (2026-05-30), tras auditoría
// completa (scripts/audit-conciliaciones-erroneas.ts).
//
// (1) 2 PARES CRUZADOS (swap de facturas): Easy↔Sodimac y Tottus↔Sodimac.
// (2) 10 DESASIGNACIONES: compras con tarjeta enganchadas a una factura que no
//     corresponde (otro proveedor / emitida meses después del pago). No existe
//     factura correcta → se suelta el pago (mov → sin_asignar; la factura mal
//     marcada como pagada vuelve a 'pendiente').
//
// Dry-run por defecto. Escribe con --apply.
// Uso (PROD):
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" \
//     npx tsx scripts/fix-conciliaciones-ronda2.ts [--apply]

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function recompute(id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { totalAmount: true, status: true } });
  if (!inv || inv.status === "anulada") return;
  const ps = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, select: { amountApplied: true, bankMovement: { select: { date: true } } } });
  const sum = ps.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;
  if (sum >= inv.totalAmount - 1) { status = "pagada"; paidAt = ps.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null); }
  else if (sum > 0) status = "parcial";
  await prisma.invoice.update({ where: { id }, data: { status, paidAt } });
}

// payA→invForB y payB→invForA hoy (cruzados); se reapuntan correctamente.
const SWAPS = [
  { label: "Easy↔Sodimac ~$31.980 (abr)",
    payA: "cmop1vyt70085rtv91uu8e04a", invCurrA: "cmoj21dlp001drt1gcpdd0b39", // mov Easy → hoy Sodimac F-146772633
    payB: "cmop1vytx009vrtv9l1qasxg5", invCurrB: "cmoj21dr4002yrt1g2ff1w2eo" }, // mov Sodimac → hoy Easy F-37831634
  { label: "Tottus↔Sodimac ~$17.810 (ene)",
    payA: "cmou29i7j002drtabcat96bg6", invCurrA: "cmok24i6v007yrtsirn7r22hd", // mov Tottus → hoy Sodimac F-144867249
    payB: "cmou29lu40045rtabq2pnmbby", invCurrB: "cmok24i87008prtsitm077ki4" }, // mov Sodimac → hoy Tottus F-11021061
];

// payId → invId esperado (factura mal pegada). Se borra el pago.
const UNLINKS: { fol: string; payId: string; invId: string; movId: string }[] = [
  { fol: "55963242", payId: "cmppshcn70007kw0590y3a6dv", invId: "cmppqgqrr0001k0048xm0llx2", movId: "cmp8i56ye002hl1047ioy7msi" },
  { fol: "149642", payId: "cmp8i5chd00g5l104oos6io4g", invId: "cmoj21drh0034rt1girbkjsfb", movId: "cmp8i5bmh00cdl104aagnscl5" },
  { fol: "12098945", payId: "cmp8i58lz006fl104f4t84tku", invId: "cmok24i5p0079rtsipcrstg4y", movId: "cmp8i577a0053l1042g8ytuy0" },
  { fol: "37752041", payId: "cmp8i5gt000pxl10470km3o6j", invId: "cmoj21dqx002wrt1glwfcf9e3", movId: "cmp8i5ep900oll104wbulqu6d" },
  { fol: "19365104", payId: "cmp8i5gbk00pvl1049o3o8reb", invId: "cmok24i410069rtsin6ejmjhg", movId: "cmp8i5eh600m9l1042tyrdwq1" },
  { fol: "55524830", payId: "cmp8i5nwv015bl104w0i0i5vu", invId: "cmok24hps0002rtsi43mxhxi2", movId: "cmp8i5n5w0133l104i7gak5j7" },
  { fol: "147256929", payId: "cmppshcoq000bkw051gt7el71", invId: "cmpgxtseg0007ju04v0q5oqqn", movId: "cmpa2hxb5006nrtikx1iudrzz" }, // Cavem $9.900
  { fol: "147233059", payId: "cmp7n0yzl0001l204ukkjndus", invId: "cmp69dd0q000bjp047h92wsgz", movId: "cmokui0d700d7rt9aw1tn4349" },
  { fol: "2988549", payId: "cmou29f1p000trtabu83ewx0g", invId: "cmok24i3j005yrtsi142528sl", movId: "cmothiqgp001trtkvsr0m1qqa" },
  { fol: "19150678", payId: "cmppshcpk000dkw05e7pkhblp", invId: "cmok24i8v0094rtsipldwmpnp", movId: "cmpa2hs960045rtikkswbbtmi" },
];

async function main() {
  console.log(`Host: ${(process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—"}`);
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const recompIds = new Set<string>();

  console.log("── SWAPS ──");
  for (const s of SWAPS) {
    const a = await prisma.invoicePayment.findUnique({ where: { id: s.payA }, select: { invoiceId: true } });
    const b = await prisma.invoicePayment.findUnique({ where: { id: s.payB }, select: { invoiceId: true } });
    if (!a || !b || a.invoiceId !== s.invCurrA || b.invoiceId !== s.invCurrB) {
      console.log(`  ⚠️  ${s.label}: estado no esperado (¿ya arreglado?) — OMITIDO`); continue;
    }
    console.log(`  ${s.label}: swap`);
    if (APPLY) await prisma.$transaction([
      prisma.invoicePayment.update({ where: { id: s.payA }, data: { invoiceId: s.invCurrB } }),
      prisma.invoicePayment.update({ where: { id: s.payB }, data: { invoiceId: s.invCurrA } }),
    ]);
    [s.invCurrA, s.invCurrB].forEach((i) => recompIds.add(i));
  }

  console.log("\n── DESASIGNACIONES ──");
  for (const u of UNLINKS) {
    const p = await prisma.invoicePayment.findUnique({
      where: { id: u.payId },
      select: { amountApplied: true, invoiceId: true, bankMovement: { select: { date: true, description: true } } },
    });
    if (!p) { console.log(`  ⚠️  F-${u.fol}: pago no existe (¿ya soltado?) — OMITIDO`); continue; }
    if (p.invoiceId !== u.invId) { console.log(`  ⚠️  F-${u.fol}: el pago ya no apunta a esa factura — OMITIDO`); continue; }
    console.log(`  F-${u.fol}: soltar ${f(p.amountApplied)} (${p.bankMovement.date.toISOString().slice(0,10)} "${p.bankMovement.description.slice(0,24)}") → factura vuelve a pendiente`);
    if (APPLY) await prisma.$transaction([
      prisma.invoicePayment.delete({ where: { id: u.payId } }),
      prisma.bankMovement.update({ where: { id: u.movId }, data: { status: "sin_asignar" } }),
    ]);
    recompIds.add(u.invId);
  }

  if (APPLY) {
    for (const id of recompIds) await recompute(id);
    console.log(`\nRecalculadas ${recompIds.size} facturas. LISTO.`);
  } else {
    console.log("\nDRY-RUN. Para aplicar: --apply");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
