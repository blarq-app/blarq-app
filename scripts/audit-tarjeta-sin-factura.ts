// AUDITORÍA — SOLO LECTURA. No escribe nada.
//
// Problema: muchos movimientos "compra tarjeta" quedaron en estado
// "sin_factura" al importar (la app adivinó la categoría por la glosa
// "Compra ...") y desaparecieron de la cola de pendientes, aunque en
// realidad SÍ tienen factura recibida. Las compras con tarjeta no traen
// RUT en la glosa del banco, así que el auto-match no las pudo conectar.
//
// Este script, para cada movimiento sin conciliar (sin_factura o
// sin_asignar, sin imputación), busca facturas recibidas abiertas que
// calcen por MONTO EXACTO dentro de una ventana de fecha, y evalúa si el
// nombre del comercio coincide. Clasifica cada movimiento en:
//   FUERTE  : un único candidato, monto exacto, comercio coincide
//   PROBABLE: un único candidato, monto exacto, comercio no obvio (revisar)
//   AMBIGUO : varios candidatos con el mismo monto (decidir cuál)
//   SIN     : ningún candidato por monto (probablemente sí es sin factura)
//
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/audit-tarjeta-sin-factura.ts
//   --window=N   ventana de días (default 31)
//   --csv        además escribe audit-tarjeta-sin-factura.csv

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const WINDOW = Number((process.argv.find((a) => a.startsWith("--window=")) ?? "").split("=")[1] || 31);
const CSV = process.argv.includes("--csv");
const DAY = 86400000;

// Normaliza texto: minúsculas, sin tildes, sin signos.
const norm = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Saca tokens significativos de la glosa del banco (quita ruido de tarjeta).
const STOP = new Set(["compra", "nacional", "np", "webpay", "cl", "mp", "dp", "spa", "ltda", "limitada", "las", "el", "la", "de", "del", "y", "com", "www"]);
function tokens(s: string | null): string[] {
  return norm(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));
}
// ¿El comercio de la glosa aparece en el nombre de la factura? Heurística:
// algún token de la glosa (>=4 letras) está contenido en el nombre normalizado.
function merchantLikelyMatches(glosa: string, businessName: string | null): boolean {
  const name = norm(businessName);
  if (!name) return false;
  const gt = tokens(glosa).filter((t) => t.length >= 4);
  return gt.some((t) => name.includes(t));
}

async function main() {
  console.log(`Ventana de fecha: ±${WINDOW} días\n`);

  // Movimientos a auditar: SOLO compras con tarjeta sin conciliar, sin
  // imputación. Excluye transferencias, pagos SII/Previred, comisiones, etc.
  // (esos legítimamente no tienen factura). category="compra_tarjeta" es la
  // misma etiqueta que muestra la columna "Compra tarjeta" en la UI.
  const movs = await prisma.bankMovement.findMany({
    where: {
      amount: { lt: 0 },
      status: { in: ["sin_factura", "sin_asignar"] },
      category: "compra_tarjeta",
      payments: { none: {} },
    },
    select: { id: true, date: true, amount: true, description: true, status: true, category: true,
      bankAccount: { select: { alias: true } } },
    orderBy: { date: "desc" },
  });

  // Facturas recibidas en CUALQUIER estado (menos NC) — para distinguir si la
  // factura existe pero está pagada/anulada vs no existe en el sistema.
  const facs = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, businessName: true, rutIssuer: true,
      issueDate: true, totalAmount: true, status: true,
      payments: { select: { amountApplied: true, bankMovement: { select: { date: true, description: true } } } } },
  });
  const facsRem = facs.map((f) => ({
    ...f, remaining: f.totalAmount - f.payments.reduce((s, p) => s + p.amountApplied, 0),
  }));
  // Índice por monto TOTAL redondeado (no por saldo): así encontramos la
  // factura aunque ya esté pagada, para distinguir "existe pero pagada".
  const byAmount = new Map<number, typeof facsRem>();
  for (const f of facsRem) {
    const k = Math.round(f.totalAmount);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(f);
  }

  // Grupos:
  //   CONCILIABLE : existe factura ABIERTA (pendiente/parcial) con monto
  //                 exacto en ventana → se puede conciliar ahora.
  //   YA_PAGADA   : existe factura con ese monto pero está PAGADA (ya
  //                 conciliada a otro movimiento, o marcada pagada) → revisar
  //                 si el pago está en el movimiento correcto.
  //   SIN         : no hay factura en el sistema con ese monto → falta
  //                 sincronizar del SII, o es de verdad sin factura.
  const buckets = { CONCILIABLE: [] as string[], YA_PAGADA: [] as string[], SIN: [] as string[] };
  const csvRows: string[] = ["grupo;movId;fecha;glosa;monto;facFolio;facProveedor;facFecha;facTotal;facStatus;diasGap;comercioCoincide;pagadaPor"];

  for (const m of movs) {
    const abs = Math.round(Math.abs(m.amount));
    const cands = [abs - 1, abs, abs + 1]
      .flatMap((k) => byAmount.get(k) ?? [])
      .filter((f) => Math.abs(new Date(m.date).getTime() - new Date(f.issueDate).getTime()) / DAY <= WINDOW)
      .filter((f) => f.status !== "anulada");

    const fecha = m.date.toISOString().slice(0, 10);
    const linea = `${fecha}  ${String(m.amount).padStart(11)}  ${m.description}`;

    if (cands.length === 0) { buckets.SIN.push(linea); continue; }

    const withMatch = cands.map((f) => ({
      f, merchant: merchantLikelyMatches(m.description, f.businessName),
      gap: Math.round(Math.abs(new Date(m.date).getTime() - new Date(f.issueDate).getTime()) / DAY),
      pagadaPor: f.payments.map((p) => `${p.bankMovement.date.toISOString().slice(0,10)} ${p.bankMovement.description}`).join(" | "),
    }));

    const hayAbierta = withMatch.some((w) => w.f.status === "pendiente" || w.f.status === "parcial");
    const clase: keyof typeof buckets = hayAbierta ? "CONCILIABLE" : "YA_PAGADA";

    const detalle = withMatch
      .map((w) => `        -> folio ${w.f.folioNumber ?? "?"}  ${w.f.businessName}  ${w.f.issueDate.toISOString().slice(0,10)}  $${Math.round(w.f.totalAmount)}  [${w.f.status}]  (${w.gap}d, comercio ${w.merchant ? "OK" : "?"})${w.f.status === "pagada" ? `  pagada por: ${w.pagadaPor}` : ""}`)
      .join("\n");
    buckets[clase].push(`${linea}\n${detalle}`);

    for (const w of withMatch) {
      csvRows.push([clase, m.id, fecha, `"${m.description}"`, m.amount, w.f.folioNumber ?? "", `"${w.f.businessName ?? ""}"`,
        w.f.issueDate.toISOString().slice(0,10), Math.round(w.f.totalAmount), w.f.status, w.gap, w.merchant ? "OK" : "?", `"${w.pagadaPor}"`].join(";"));
    }
  }

  const tot = movs.length;
  console.log(`Total compras tarjeta sin conciliar auditadas: ${tot}`);
  console.log(`  CONCILIABLE (factura abierta, monto exacto, en ventana): ${buckets.CONCILIABLE.length}`);
  console.log(`  YA_PAGADA   (factura existe pero ya pagada → revisar):    ${buckets.YA_PAGADA.length}`);
  console.log(`  SIN         (no hay factura con ese monto en sistema):    ${buckets.SIN.length}\n`);

  for (const clase of ["CONCILIABLE", "YA_PAGADA"] as const) {
    console.log(`\n========== ${clase} (${buckets[clase].length}) ==========`);
    for (const l of buckets[clase]) console.log(l);
  }
  console.log(`\n========== SIN factura en sistema (${buckets.SIN.length}) ==========`);
  for (const l of buckets.SIN) console.log("  " + l);

  if (CSV) {
    writeFileSync("audit-tarjeta-sin-factura.csv", csvRows.join("\n"), "utf8");
    console.log("\nCSV escrito: audit-tarjeta-sin-factura.csv");
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
