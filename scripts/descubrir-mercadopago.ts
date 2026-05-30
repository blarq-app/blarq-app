// Ayudante de descubrimiento (SOLO LECTURA) para los movimientos MercadoPago /
// MercadoLibre que quedaron sin factura. Para cada uno lista las facturas
// RECIBIDAS no pagadas del mismo monto (de CUALQUIER proveedor, porque la
// factura suele venir de la tienda vendedora, no de MercadoLibre), ordenadas
// por cercanía de fecha, para que MJ elija a mano.
//
// Uso: npx tsx scripts/descubrir-mercadopago.ts <dump.json> [tolerancia=5]

import { readFileSync } from "fs";
const file = process.argv[2];
const TOL = Number(process.argv[3] ?? 5);
if (!file) { console.error("Falta dump"); process.exit(1); }
const db = JSON.parse(readFileSync(file, "utf8"));
const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d = (s: string) => s.slice(0, 10);
const proj = (id: string | null) => (db.projects.find((p: any) => p.id === id) || {}).name || "—";
const days = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

// Facturas recibidas que todavía pueden recibir pago (no pagadas).
const disponibles = db.invoices.filter((i: any) => i.type === "recibida" && i.status !== "pagada" && i.status !== "anulada");

const movs = db.bankMovements
  .filter((m: any) => m.amount < 0 && /mercado ?pago|merpago|mercado ?libre/i.test(m.description) && (m.status === "sin_factura" || m.status === "sin_asignar"))
  .sort((a: any, b: any) => a.date.localeCompare(b.date));

console.log(`Movimientos MercadoPago/MercadoLibre sin conciliar: ${movs.length}\n`);
for (const m of movs) {
  const abs = Math.abs(m.amount);
  const cands = disponibles
    .filter((i: any) => Math.abs(i.totalAmount - abs) <= TOL)
    .sort((a: any, b: any) => days(m.date, a.issueDate) - days(m.date, b.issueDate));
  console.log(`■ ${d(m.date)} ${f(m.amount)}  "${m.description}"`);
  if (!cands.length) { console.log("    sin candidatas del mismo monto en el sistema (la factura quizá no entró aún)\n"); continue; }
  for (const c of cands.slice(0, 5))
    console.log(`    → F-${c.folioNumber}  ${d(c.issueDate)}  ${(c.businessName || "").slice(0, 30).padEnd(30)} ${f(c.totalAmount).padStart(11)}  [${c.status}] [${proj(c.projectId)}]`);
  console.log("");
}
