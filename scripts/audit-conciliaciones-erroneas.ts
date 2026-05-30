// Auditoría OFFLINE de conciliaciones mal asignadas (cruce de proveedor / fecha
// imposible). Lee el JSON del dump (cero acceso a BD).
//
// Uso: npx tsx scripts/audit-conciliaciones-erroneas.ts <dump.json>
//
// Detecta, sobre TODAS las imputaciones de facturas RECIBIDAS:
//   GRUPO 1 — pago ANTERIOR a la emisión de la factura (imposible pagar algo
//             que aún no se emitió). Señal casi infalible.
//   GRUPO 2 — el comercio que nombra la glosa del banco ≠ el comercio de la
//             factura (ej: glosa "SODIMAC" pero factura de "COMERCIAL HABITAT").
//   GRUPO 3 — RUT de la contraparte ≠ RUT del emisor, sin calzar por reembolsador.

import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) { console.error("Falta path al dump"); process.exit(1); }
const db = JSON.parse(readFileSync(file, "utf8"));

type Inv = any; type Mov = any; type Reemb = any;
const invById = new Map<string, Inv>(db.invoices.map((i: Inv) => [i.id, i]));
const movById = new Map<string, Mov>(db.bankMovements.map((m: Mov) => [m.id, m]));
const projById = new Map<string, any>(db.projects.map((p: any) => [p.id, p]));
const reembs: Reemb[] = db.reembolsadores ?? [];

const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d10 = (s: string) => s.slice(0, 10);
const days = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400000;
const tail8 = (s: string | null) => { const x = (s ?? "").replace(/\D/g, ""); return x.length >= 8 ? x.slice(-8) : x; };
const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const proj = (id: string | null) => projById.get(id ?? "")?.name ?? "—";

// ── Detección de comercio. canonical -> patrones que pueden aparecer en la
// glosa del banco O en la razón social de la factura. Solo comercios que
// reconocemos con certeza; lo desconocido no se marca.
const MERCHANTS: { id: string; re: RegExp }[] = [
  { id: "sodimac", re: /sodimac|homecenter/ }, // Homecenter es marca de Sodimac (misma empresa)
  { id: "easy", re: /\beasy\b/ },
  { id: "cavem", re: /cavem/ },
  { id: "sherwin", re: /sherwin|vespucio oriente/ }, // el local Sherwin factura como "Vespucio Oriente"
  { id: "habitat", re: /habitat/ },
  { id: "mercadolibre", re: /mercado ?libre|mercadopago/ },
  { id: "cabify", re: /cabify|maxi mobility/ },
  { id: "garach", re: /garach/ },
  { id: "construmart", re: /construmart/ },
  { id: "tottus", re: /tottus/ },
  { id: "imperial", re: /imperial/ },
];
// Compra con tarjeta / cargo automático: la boleta se emite el MISMO día.
// Una transferencia a un proveedor/maestro NO (te facturan después).
const isCardPurchase = (desc: string | null) => /^\s*(compra|pac )/i.test(desc ?? "");
function merchantOf(s: string | null): string | null {
  const t = norm(s);
  for (const m of MERCHANTS) if (m.re.test(t)) return m.id;
  return null;
}

// ¿calza por reembolsador? (persona transfiere, factura es de su empresa-alias)
function viaReembolsador(mov: Mov, invRutTail: string): boolean {
  if (!invRutTail) return false;
  const movRutTail = tail8(mov.counterpartyRut);
  const txt = norm(`${mov.counterpartyName ?? ""} ${mov.description ?? ""}`);
  return reembs.some((r) =>
    r.aliases.some((a: any) => tail8(a.rut) === invRutTail) &&
    ((r.personRut && tail8(r.personRut) === movRutTail) ||
      (r.glosa && txt.includes(norm(r.glosa))) ||
      (r.nombre && txt.includes(norm(r.nombre))))
  );
}

type Hit = { kind: string; gap: number; mov: Mov; inv: Inv; extra?: string };
const g1: Hit[] = [], g2: Hit[] = [], g3: Hit[] = [];

for (const p of db.invoicePayments) {
  const mov = movById.get(p.bankMovementId);
  const inv = invById.get(p.invoiceId);
  if (!mov || !inv) continue;
  if (inv.type !== "recibida") continue; // emitidas: el cobro puede anticipar la emisión, no aplica

  const gap = days(mov.date, inv.issueDate); // + = pago después de emitir (normal)

  // GRUPO 1 — SOLO compras con tarjeta pagadas antes de emitir la boleta
  // (en una compra con tarjeta la boleta es del mismo día; si el pago es
  // anterior a la emisión, el match es imposible). Las transferencias a
  // maestros/proveedores se excluyen: pagar antes de que facturen es normal.
  if (gap < -7 && isCardPurchase(mov.description)) g1.push({ kind: "pago-antes-de-emision", gap, mov, inv });

  // GRUPO 2 — comercio glosa ≠ comercio factura
  const mGlosa = merchantOf(`${mov.description ?? ""} ${mov.counterpartyName ?? ""}`);
  const mInv = merchantOf(inv.businessName);
  if (mGlosa && mInv && mGlosa !== mInv) g2.push({ kind: "comercio-distinto", gap, mov, inv, extra: `glosa=${mGlosa} ≠ factura=${mInv}` });

  // GRUPO 3 — RUT no calza ni por reembolsador
  const movRut = tail8(mov.counterpartyRut), invRut = tail8(inv.rutIssuer);
  if (movRut && invRut && movRut !== invRut && !viaReembolsador(mov, invRut))
    g3.push({ kind: "rut-no-calza", gap, mov, inv, extra: `mov ${mov.counterpartyRut} ≠ fact ${inv.rutIssuer}` });
}

function show(title: string, hits: Hit[]) {
  console.log(`\n${"═".repeat(70)}\n${title} — ${hits.length} caso(s)\n${"═".repeat(70)}`);
  hits.sort((a, b) => a.gap - b.gap);
  for (const h of hits) {
    const cp = (h.mov.counterpartyName || h.mov.description || "").slice(0, 28);
    console.log(
      `  pago ${d10(h.mov.date)} ${f(h.mov.amount).padStart(12)} "${cp.padEnd(28)}" ` +
      `→ F-${h.inv.folioNumber} emit ${d10(h.inv.issueDate)} ${(h.inv.businessName || "").slice(0, 22).padEnd(22)} [${proj(h.inv.projectId)}]`
    );
    if (h.kind === "pago-antes-de-emision") console.log(`        ⚠️  pago ${Math.abs(Math.round(h.gap))} días ANTES de emitir la factura`);
    if (h.extra) console.log(`        ⚠️  ${h.extra}`);
  }
}

show("GRUPO 1 · PAGO ANTERIOR A LA EMISIÓN (imposible)", g1);
show("GRUPO 2 · COMERCIO DE LA GLOSA ≠ COMERCIO DE LA FACTURA", g2);
show("GRUPO 3 · RUT NO CALZA (ni por reembolsador)", g3);

// Unión de movs únicos a revisar
const all = new Set([...g1, ...g2, ...g3].map((h) => h.mov.id));
console.log(`\n${"─".repeat(70)}\nTotal imputaciones recibidas: ${db.invoicePayments.length}`);
console.log(`Movimientos únicos a revisar: ${all.size}  (G1=${g1.length} G2=${g2.length} G3=${g3.length}, con solapamiento)`);
