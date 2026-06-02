// Diagnóstico READ-ONLY: clasifica los movimientos bancarios "sin_asignar"
// según si PROBABLEMENTE tienen una factura esperando (calza RUT/monto contra
// una factura pendiente/parcial ya cargada en la app) o si son gasto SIN
// factura (sueldo, transferencia a tercero, comisión, impuesto, etc.).
//
// NO toca la BD. Lee un dump JSON ya generado (scripts/audit-dump.ts) y
// trabaja 100% en memoria. No escribe nada.
//
// El criterio de "calza" replica EXACTAMENTE el de la app
// (src/lib/banco/invoicePayments.ts: decideMovementInvoiceMatch +
// el filtro de candidatas por monto + aliasRutsFromList), para que el conteo
// refleje lo que el auto-conciliador real haría.
//
// Uso:
//   npx tsx scripts/diagnostico-sin-asignar.ts [ruta-al-dump.json]
// Sin argumento, toma el dump audit-* más reciente de backups/.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// ── localizar el dump ────────────────────────────────────────────────────
const arg = process.argv[2];
const dumpPath =
  arg ??
  (() => {
    const dir = join(process.cwd(), "backups");
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json"))
      .sort();
    if (files.length === 0) throw new Error("No hay dump audit-* en backups/");
    return join(dir, files[files.length - 1]);
  })();

const d = JSON.parse(readFileSync(dumpPath, "utf8"));
console.log(`Dump: ${dumpPath}`);
console.log(`Snapshot: ${d.meta?.generatedAt} (env ${d.meta?.env})\n`);

// ── tipos mínimos del dump ─────────────────────────────────────────────────
type Mov = {
  id: string;
  date: string;
  description: string;
  amount: number;
  counterpartyRut: string | null;
  counterpartyName: string | null;
  status: string;
};
type Inv = {
  id: string;
  type: string;
  status: string;
  tipoDoc: number | null;
  rutIssuer: string | null;
  rutReceiver: string | null;
  businessName: string | null;
  issueDate: string;
  totalAmount: number;
};
type Reemb = { glosa: string; personRut: string | null; aliases: { rut: string }[] };

const movs: Mov[] = d.bankMovements;
const invoices: Inv[] = d.invoices;
const payments: { invoiceId: string; amountApplied: number }[] = d.invoicePayments;
const reembolsadores: Reemb[] = d.reembolsadores;

// saldo restante por factura (totalAmount - suma de pagos)
const paidByInvoice = new Map<string, number>();
for (const p of payments) {
  paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amountApplied);
}
const remainingOf = (inv: Inv) => inv.totalAmount - (paidByInvoice.get(inv.id) ?? 0);

// candidatas precargadas: pendientes/parciales, sin NC (tipoDoc 61), con saldo
const candidateInvoices = invoices.filter(
  (c) => (c.status === "pendiente" || c.status === "parcial") && c.tipoDoc !== 61
);

// ── helpers copiados de invoicePayments.ts ─────────────────────────────────
const MERCHANT_DATE_WINDOW_DAYS = 31;
const TARJETA_MERCHANTS: { id: string; glosa: RegExp; name: RegExp }[] = [
  { id: "sodimac", glosa: /sodimac|homecenter/, name: /sodimac|homecenter/ },
  { id: "easy", glosa: /\beasy\b/, name: /easy/ },
  { id: "cavem", glosa: /cavem/, name: /cavem/ },
  { id: "sherwin", glosa: /sherwin|vespucio oriente/, name: /sherwin/ },
  { id: "construmart", glosa: /construmart/, name: /construmart/ },
  { id: "imperial", glosa: /imperial/, name: /imperial/ },
  { id: "tottus", glosa: /tottus/, name: /tottus/ },
  { id: "copec", glosa: /copec/, name: /copec/ },
];
const normTxt = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const merchantFromGlosa = (desc: string | null) =>
  TARJETA_MERCHANTS.find((m) => m.glosa.test(normTxt(desc)))?.id ?? null;
const merchantFromName = (name: string | null) =>
  TARJETA_MERCHANTS.find((m) => m.name.test(normTxt(name)))?.id ?? null;

function aliasRutsFromList(description: string, counterpartyRut: string | null): string[] {
  const desc = (description ?? "").toLowerCase();
  const movRut = (counterpartyRut ?? "").replace(/\D/g, "");
  if (!desc && !movRut) return [];
  const ruts = new Set<string>();
  for (const r of reembolsadores) {
    const pr = (r.personRut ?? "").replace(/\D/g, "");
    const matchByRut = pr.length > 0 && movRut && (pr.includes(movRut) || movRut.includes(pr));
    const matchByGlosa = desc.includes(r.glosa.toLowerCase());
    if (matchByRut || matchByGlosa) {
      for (const a of r.aliases) {
        const dd = a.rut.replace(/\D/g, "");
        if (dd.length > 0) ruts.add(dd.slice(-8));
      }
    }
  }
  return [...ruts];
}

type Reason =
  | "matched"
  | "no_candidates"
  | "no_rut_match"
  | "ambiguous_multi"
  | "no_rut_to_validate"
  | "no_merchant_match"
  | "merchant_out_of_window"
  | "ambiguous_merchant";

// réplica de decideMovementInvoiceMatch (devuelve solo el "reason"/matched)
function decide(mov: Mov): { reason: Reason; nCandidates: number } {
  const isCargo = mov.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";
  const abs = Math.abs(mov.amount);
  const candidates = candidateInvoices.filter((c) => {
    if (c.type !== targetType) return false;
    if (c.totalAmount < abs - 10) return false;
    const rem = remainingOf(c);
    return rem >= abs - 10 && rem <= abs + 10;
  });
  if (candidates.length === 0) return { reason: "no_candidates", nCandidates: 0 };

  const movRutDigits = (mov.counterpartyRut ?? "").replace(/\D/g, "");
  const aliasRutDigits = aliasRutsFromList(mov.description, mov.counterpartyRut);

  // CAMINO A — hay RUT (mov o alias)
  if (movRutDigits || aliasRutDigits.length > 0) {
    const filtered = candidates.filter((c) => {
      const cRut = (isCargo ? c.rutIssuer : c.rutReceiver) ?? "";
      const cd = cRut.replace(/\D/g, "");
      if (cd.length === 0) return false;
      if (movRutDigits && (movRutDigits.includes(cd) || cd.includes(movRutDigits))) return true;
      return aliasRutDigits.some((a) => a.includes(cd) || cd.includes(a));
    });
    if (filtered.length === 0) return { reason: "no_rut_match", nCandidates: candidates.length };
    if (filtered.length > 1) return { reason: "ambiguous_multi", nCandidates: filtered.length };
    return { reason: "matched", nCandidates: 1 };
  }

  // CAMINO B — sin RUT: comercio
  const merchant = merchantFromGlosa(mov.description);
  if (!merchant) return { reason: "no_rut_to_validate", nCandidates: candidates.length };
  const byMerchant = candidates.filter((c) => merchantFromName(c.businessName) === merchant);
  if (byMerchant.length === 0) return { reason: "no_merchant_match", nCandidates: candidates.length };
  const movT = new Date(mov.date).getTime();
  const within = byMerchant.filter(
    (c) => Math.abs(movT - new Date(c.issueDate).getTime()) / 86400000 <= MERCHANT_DATE_WINDOW_DAYS
  );
  if (within.length === 0) return { reason: "merchant_out_of_window", nCandidates: byMerchant.length };
  if (within.length > 1) return { reason: "ambiguous_merchant", nCandidates: within.length };
  return { reason: "matched", nCandidates: 1 };
}

// ── heurística de "gasto sin factura" por glosa (para los que no calzan) ────
// Vocabulario tomado de los movs que ya están marcados sin_factura en el dump.
function gastoSinFacturaTipo(mov: Mov): string | null {
  const t = normTxt(mov.description);
  if (/previred/.test(t)) return "previred (cotizaciones)";
  if (/com\.mant|comision|com\.|mant\.prod|redbanc|impuesto|iva |f29|tesoreria|sii /.test(t))
    return "comision/impuesto banco";
  if (/pago en linea|pago recurrente|pac |pat |servipag|cuenta |aguas|enel|cge|metrogas|vtr|movistar|entel|claro/.test(t))
    return "servicio/PAC (pago en linea)";
  if (/deposito en efectivo|deposito documento|retiro|giro /.test(t))
    return "efectivo/giro";
  // sueldo: transferencia cuyo RUT/glosa cae en un reembolsador "socio" (MJ/JT)
  // o glosa con "transf a/de <persona>" sin proveedor — se reporta aparte abajo.
  return null;
}

// ── clasificar ─────────────────────────────────────────────────────────────
const sinAsignar = movs.filter((m) => m.status === "sin_asignar");
const cargos = sinAsignar.filter((m) => m.amount < 0);
const abonos = sinAsignar.filter((m) => m.amount > 0);

type Row = { mov: Mov; reason: Reason; nCandidates: number };
const classify = (arr: Mov[]): Row[] => arr.map((mov) => ({ mov, ...decide(mov) }));
const cargoRows = classify(cargos);
const abonoRows = classify(abonos);

const sum = (rows: Row[]) => rows.reduce((s, r) => s + Math.abs(r.mov.amount), 0);
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const grp = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred);

function report(title: string, rows: Row[]) {
  console.log(`\n${"=".repeat(70)}\n${title}  (${rows.length} movs, ${fmt(sum(rows))})\n${"=".repeat(70)}`);

  const tieneFactura = grp(rows, (r) => r.reason === "matched" || r.reason === "ambiguous_merchant");
  const ambiguoRut = grp(rows, (r) => r.reason === "ambiguous_multi");
  const fueraVentana = grp(rows, (r) => r.reason === "merchant_out_of_window");
  // "rut conocido pero ninguna factura pendiente del monto calza"
  const rutSinFactura = grp(rows, (r) => r.reason === "no_rut_match");
  const sinMonto = grp(rows, (r) => r.reason === "no_candidates");
  const comercioNoConocido = grp(rows, (r) => r.reason === "no_rut_to_validate" || r.reason === "no_merchant_match");

  console.log(`\n  A) TIENE FACTURA ESPERANDO (calza RUT/comercio + monto, conciliable directo)`);
  console.log(`     ${tieneFactura.length} movs · ${fmt(sum(tieneFactura))}`);
  console.log(`  A') AMBIGUO: calza RUT/comercio + monto pero hay >1 factura candidata (elegir a mano)`);
  console.log(`     ${ambiguoRut.length + fueraVentana.length} movs · ${fmt(sum([...ambiguoRut, ...fueraVentana]))}`);
  console.log(`     (${ambiguoRut.length} por RUT con varias del mismo monto, ${fueraVentana.length} comercio fuera de ventana de fecha)`);

  // De los que NO calzan ninguna factura: separar gasto sin factura vs revisar
  const noFactura = [...rutSinFactura, ...sinMonto, ...comercioNoConocido];
  const sinFacturaClasif: Record<string, Row[]> = {};
  const aRevisar: Row[] = [];
  for (const r of noFactura) {
    const tipo = gastoSinFacturaTipo(r.mov);
    if (tipo) (sinFacturaClasif[tipo] = sinFacturaClasif[tipo] || []).push(r);
    else aRevisar.push(r);
  }
  console.log(`\n  B) GASTO SIN FACTURA (sueldo/servicio/comision/impuesto — heuristica por glosa)`);
  let bTot = 0, bN = 0;
  for (const [tipo, rs] of Object.entries(sinFacturaClasif).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`       ${rs.length}x  ${tipo}  ·  ${fmt(sum(rs))}`);
    bTot += sum(rs); bN += rs.length;
  }
  console.log(`     subtotal: ${bN} movs · ${fmt(bTot)}`);

  console.log(`\n  C) A REVISAR (no calza factura del monto y la glosa no es claramente "sin factura")`);
  console.log(`     ${aRevisar.length} movs · ${fmt(sum(aRevisar))}`);
  // Abrir el bucket: por tipo de RUT (empresa vs persona) y si existe ALGUNA
  // factura de ese RUT en el sistema (cualquier estado).
  const isCargoSide = title.startsWith("CARGOS");
  const empresaConFactura: Row[] = [], empresaSinFactura: Row[] = [],
    personaConFactura: Row[] = [], personaSinFactura: Row[] = [], sinRut: Row[] = [];
  for (const r of aRevisar) {
    const rd = (r.mov.counterpartyRut ?? "").replace(/\D/g, "");
    if (rd.length < 7) { sinRut.push(r); continue; }
    // cuerpo del RUT (sin DV): ≥50.000.000 = persona jurídica (empresa) en Chile
    const body = parseInt(rd.slice(0, -1), 10);
    const esEmpresa = body >= 50000000;
    // ¿existe alguna factura de ese RUT? (rutIssuer para cargos, rutReceiver para abonos)
    const existe = invoices.some((inv) => {
      const f = (isCargoSide ? inv.rutIssuer : inv.rutReceiver) ?? "";
      const fd = f.replace(/\D/g, "");
      return fd.length >= 7 && (fd.includes(rd.slice(-8)) || rd.slice(-8).includes(fd.slice(-8)));
    });
    if (esEmpresa) (existe ? empresaConFactura : empresaSinFactura).push(r);
    else (existe ? personaConFactura : personaSinFactura).push(r);
  }
  console.log(`       — RUT de EMPRESA, con factura(s) del mismo proveedor en el sistema (¿ya pagada / monto distinto / parcial?):`);
  console.log(`           ${empresaConFactura.length} movs · ${fmt(sum(empresaConFactura))}`);
  console.log(`       — RUT de EMPRESA, SIN ninguna factura de ese RUT (falta la factura, o no la emitieron):`);
  console.log(`           ${empresaSinFactura.length} movs · ${fmt(sum(empresaSinFactura))}`);
  console.log(`       — RUT de PERSONA (mano de obra / sueldo / pago sin factura): con factura ${personaConFactura.length}, sin factura ${personaSinFactura.length}`);
  console.log(`           ${personaConFactura.length + personaSinFactura.length} movs · ${fmt(sum([...personaConFactura, ...personaSinFactura]))}`);
  console.log(`       — sin RUT (compra/comercio no reconocido): ${sinRut.length} movs · ${fmt(sum(sinRut))}`);

  // muestras
  const sample = (rs: Row[], n = 5) =>
    rs.slice(0, n).map((r) => `        ${fmt(Math.abs(r.mov.amount)).padStart(12)}  ${r.mov.date.slice(0, 10)}  ${normTxt(r.mov.description).slice(0, 50)}`).join("\n");
  if (tieneFactura.length) console.log(`\n     ej. (A) tiene factura:\n${sample(tieneFactura)}`);
  if (ambiguoRut.length) console.log(`\n     ej. (A') ambiguo RUT:\n${sample(ambiguoRut)}`);
  if (aRevisar.length) console.log(`\n     ej. (C) a revisar:\n${sample(aRevisar)}`);
}

report("CARGOS sin_asignar  (egresos → buscan factura RECIBIDA)", cargoRows);
report("ABONOS sin_asignar  (ingresos → buscan factura EMITIDA / cobro)", abonoRows);

// resumen global
console.log(`\n${"#".repeat(70)}\nRESUMEN: ${sinAsignar.length} movs sin_asignar (${cargos.length} cargos, ${abonos.length} abonos)\n${"#".repeat(70)}`);
const allRows = [...cargoRows, ...abonoRows];
const A = grp(allRows, (r) => r.reason === "matched" || r.reason === "ambiguous_merchant");
const Ap = grp(allRows, (r) => r.reason === "ambiguous_multi" || r.reason === "merchant_out_of_window");
console.log(`  TIENE FACTURA esperando (conciliable directo): ${A.length} movs · ${fmt(sum(A))}`);
console.log(`  TIENE FACTURA pero ambigua (elegir a mano):     ${Ap.length} movs · ${fmt(sum(Ap))}`);
const resto = grp(allRows, (r) => !["matched", "ambiguous_merchant", "ambiguous_multi", "merchant_out_of_window"].includes(r.reason));
console.log(`  NO calza factura (gasto sin factura / a revisar): ${resto.length} movs · ${fmt(sum(resto))}`);
