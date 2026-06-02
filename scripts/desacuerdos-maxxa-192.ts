// READ-ONLY (offline, NO toca la BD): detalla los ~192 DESACUERDOS app↔Maxxa.
//
// Contexto (ronda 42): tras enganchar los broches "limpios" (B/C), quedaron las
// asignaciones de Maxxa cuyo movimiento NO está sin_asignar en la app. Maxxa dice
// "este movimiento pagó la factura folio X", pero en la app ese movimiento ya
// está en OTRO lado (conciliado a otra factura, marcado sin_factura, o la factura
// ya está pagada por otro mov). En varios de esos casos LA APP ESTÁ MÁS CORRECTA
// que Maxxa (Maxxa pegó por coincidencia de monto). Hay que decidir caso a caso.
//
// Este script NO engancha nada: solo arma la tabla del desacuerdo —qué dice Maxxa
// vs qué dice la app— ordenada por tipo, para revisar con MJ.
//
// Lee el dump JSON (snapshot prod, read-only) + los MovimientosCartola_*.xlsx.
// Uso: npx tsx scripts/desacuerdos-maxxa-192.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";

const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir)
  .filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json"))
  .sort()
  .pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));
console.log(`Dump: ${dumpFile}\n`);

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 48, 52, 56].includes(parseInt(td, 10));
const within = (a: string, b: string, days: number) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 <= days;

// ── índices de la app ───────────────────────────────────────────────────────
const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.alias ?? p.id]));
const invById = new Map<string, any>(d.invoices.map((i: any) => [i.id, i]));

// factura recibida (no NC) por folio+rut(8)
const appInv = new Map<string, any>();
for (const inv of d.invoices) {
  if (inv.type !== "recibida" || inv.tipoDoc === 61) continue;
  const fol = String(inv.folioNumber ?? "").replace(/^0+/, "");
  const rut = rut8(inv.rutIssuer);
  if (fol && rut) appInv.set(`${fol}|${rut}`, inv);
}

// pagado por factura + movimientos enlazados a cada factura
const paidByInv = new Map<string, number>();
const movToInv = new Map<string, string[]>(); // movId → [invoiceId...]
for (const p of d.invoicePayments) {
  paidByInv.set(p.invoiceId, (paidByInv.get(p.invoiceId) ?? 0) + p.amountApplied);
  const arr = movToInv.get(p.bankMovementId) ?? [];
  arr.push(p.invoiceId);
  movToInv.set(p.bankMovementId, arr);
}

// movimientos de la Operativa, todos los estados (+ Sueldos para cruzar MOV_NO_EXISTE)
const opMovs = d.bankMovements.filter((m: any) => m.bankAccountId === "ba_op_blarq");
const sueldosMovs = d.bankMovements.filter((m: any) => m.bankAccountId === "ba_sueldos_blarq");

// ── confirmación de proveedor (port de fix-broches): ¿la glosa/rut del mov ──
// dice que es ese proveedor? RUT directo, alias de reembolsador (persona→empresa)
// o glosa de comercio (compra con tarjeta sin RUT).
const reembs = d.reembolsadores ?? [];
const normTxt = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function proveedorConfirmado(mov: { description: string; counterpartyRut: string | null }, invRut: string | null, invName: string | null): boolean {
  const ir = rut8(invRut);
  const mr = rut8(mov.counterpartyRut);
  if (ir && mr && (mr.includes(ir) || ir.includes(mr))) return true; // RUT directo
  for (const r of reembs) {
    const pr = (r.personRut ?? "").replace(/\D/g, "");
    const byRut = pr && mr && (pr.includes(mr) || mr.includes(pr));
    const byGlosa = r.glosa && normTxt(mov.description).includes(String(r.glosa).toLowerCase());
    if (byRut || byGlosa) {
      if ((r.aliases ?? []).some((a: any) => { const ad = rut8(a.rut); return ad && ir && (ad.includes(ir) || ir.includes(ad)); })) return true;
    }
  }
  if (!mr && invName) {
    const tok = normTxt(invName).split(/\s+/).filter((w: string) => w.length >= 4)[0];
    if (tok && normTxt(mov.description).includes(tok)) return true;
  }
  return false;
}

// ── Maxxa: asignaciones (folio+rut+abono) de cada movimiento, dedup id_pago ──
const maxxaFiles = [
  "/Users/mjblanco/Downloads/MovimientosCartola_20260601_1722.xlsx", // ene–mar 2025 (llena el hueco)
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
type Asig = { key: string; folio: string; rut: string; abono: number; nom: string };
type MxRow = { date: string; monto: number; desc: string; asigns: Asig[] };
const rows: MxRow[] = [];
const seenIdPago = new Set<string>();
for (const f of maxxaFiles) {
  const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (r[4] === "" || !r[27]) continue;
    let arr: any[] = [];
    try {
      arr = JSON.parse(String(r[27]).split(";")[0]);
    } catch {
      continue;
    }
    const asigns: Asig[] = [];
    for (const a of arr) {
      const idPago = String(a.id_pago ?? "");
      if (idPago && seenIdPago.has(idPago)) continue;
      if (idPago) seenIdPago.add(idPago);
      if (!isRealDte(String(a.TipoDoc))) continue;
      const folio = String(a.Folio ?? "").replace(/^0+/, "");
      const rut = rut8(a.Rut);
      asigns.push({ key: `${folio}|${rut}`, folio, rut, abono: Math.abs(Number(a.Abono) || 0), nom: a.NomAux ?? "" });
    }
    if (asigns.length) rows.push({ date: String(r[7]).slice(0, 10), monto: Math.abs(Number(r[4]) || 0), desc: String(r[3] ?? ""), asigns });
  }
}

// ── recorrer cada asignación, quedarme con los DESACUERDOS ───────────────────
// Desacuerdo = la factura existe en la app, le falta saldo, y NO hay un movimiento
// sin_asignar de la Operativa que calce monto(±2)+fecha(±5d) para engancharlo.
type Out = {
  clase: string;
  folio: string;
  proveedor: string;
  obra: string;
  totalFactura: number;
  appPagado: number;
  estadoApp: string;
  maxxaAbono: number;
  maxxaFecha: string;
  maxxaGlosaMov: string;
  appDice: string; // dónde está realmente ese movimiento en la app
  veredicto: string; // heurística: quién parece tener razón
};
const out: Out[] = [];

for (const row of rows) {
  // candidatos por monto+fecha, en CUALQUIER estado (no solo sin_asignar)
  const anyCands = opMovs.filter((m: any) => Math.abs(Math.abs(m.amount) - row.monto) <= 2 && within(m.date, row.date, 5));
  const sinAsignarCands = anyCands.filter((m: any) => m.status === "sin_asignar");

  for (const a of row.asigns) {
    const inv = appInv.get(a.key);
    if (!inv) continue; // sin factura en la app: otro grupo (61 noEnApp), fuera de este análisis
    const saldo = inv.totalAmount - (paidByInv.get(inv.id) ?? 0);

    // si HAY un mov sin_asignar que calza y la factura tiene saldo → era enganchable
    // (lo tomó B/C o quedó en "no confirma proveedor"). No es desacuerdo de este tipo.
    if (saldo > 1 && sinAsignarCands.length >= 1) continue;

    // ── clasificar el desacuerdo ──
    let clase: string;
    let appDice: string;
    let veredicto: string;

    if (saldo <= 1) {
      // la factura ya está pagada en la app por OTROS movimientos
      clase = "FACTURA_YA_PAGADA";
      const linkMovs = d.invoicePayments.filter((p: any) => p.invoiceId === inv.id);
      const descs = linkMovs
        .map((p: any) => opMovs.find((m: any) => m.id === p.bankMovementId))
        .filter(Boolean)
        .map((m: any) => `${m.date.slice(0, 10)} ${fmt(Math.abs(m.amount))} "${m.description.slice(0, 28)}"`);
      appDice = `factura pagada en la app (${fmt(paidByInv.get(inv.id) ?? 0)}) por: ${descs.join(" | ") || "—"}`;
      veredicto = "No hacer nada — la factura ya está pagada en la app.";
    } else if (anyCands.length === 0) {
      clase = "MOV_NO_EXISTE";
      const enSueldos = sueldosMovs.find((m: any) => Math.abs(Math.abs(m.amount) - row.monto) <= 2 && within(m.date, row.date, 5));
      if (enSueldos) {
        appDice = `no está en la Operativa, pero SÍ hay un mov en SUELDOS: "${enSueldos.description.slice(0, 32)}" (${enSueldos.date.slice(0, 10)}, ${enSueldos.status})`;
        veredicto = "Pago salió de la cuenta SUELDOS — enganchable cuando se trabaje esa cuenta (hoy fuera de alcance).";
      } else {
        appDice = "no hay movimiento de ese monto/fecha en ninguna cuenta de la app";
        veredicto = "Falta el movimiento en la app (¿ene-feb 2025 fuera de rango? ¿pago que nunca se importó?). Confirmar con cartola.";
      }
    } else {
      // hay mov(s) de ese monto/fecha pero NO sin_asignar: ¿dónde están?
      const estados = anyCands.map((m: any) => m.status);
      const conciliadoOtra = anyCands.find((m: any) => (m.status === "conciliado" || m.status === "parcial") && (movToInv.get(m.id) ?? []).length);
      const sinFactura = anyCands.find((m: any) => m.status === "sin_factura");
      const interno = anyCands.find((m: any) => m.status === "interno");
      // PREMISA MJ: Maxxa manda (lo hizo a mano). La app debe igualarse.
      // Excepción: si Maxxa estuviera vacío y la app llena, vale la app (eso NO
      // cae acá: estos son casos donde Maxxa SÍ asignó). El veredicto = la ACCIÓN.
      const folioMaxxa = `f${a.folio}`;
      if (conciliadoOtra) {
        clase = "APP_OTRA_FACTURA";
        const otrasInv = (movToInv.get(conciliadoOtra.id) ?? []).map((id: string) => invById.get(id)).filter(Boolean);
        const otras = otrasInv.map((o: any) => `folio ${String(o.folioNumber).replace(/^0+/, "")} ${o.businessName?.slice(0, 24)}`);
        appDice = `el mov "${conciliadoOtra.description.slice(0, 30)}" (${conciliadoOtra.date.slice(0, 10)}) la app lo concilió a: ${otras.join(" + ")}`;
        // ¿la factura de Maxxa y la de la app son del MISMO proveedor (mismo RUT)?
        const mismoProv = otrasInv.every((o: any) => rut8(o.rutIssuer) === rut8(inv.rutIssuer));
        if (mismoProv) veredicto = `MAXXA MANDA (bajo riesgo) — mover el mov a ${folioMaxxa} del MISMO proveedor (hoy en otro folio del mismo proveedor).`;
        else veredicto = `MAXXA MANDA pero REVISAR — Maxxa lo pone en ${folioMaxxa}, la app lo tiene en OTRO PROVEEDOR. Confirmar antes (posible choque de folio).`;
      } else if (sinFactura) {
        clase = "APP_SIN_FACTURA";
        appDice = `el mov "${sinFactura.description.slice(0, 36)}" (${sinFactura.date.slice(0, 10)}) está marcado SIN FACTURA en la app`;
        const tok = normTxt(inv.businessName).split(/\s+/).filter((w: string) => w.length >= 4)[0];
        const compraDirecta = !rut8(sinFactura.counterpartyRut) && tok && normTxt(sinFactura.description).includes(tok);
        const confMov = proveedorConfirmado(sinFactura, inv.rutIssuer, inv.businessName);
        if (compraDirecta || confMov) veredicto = `MAXXA MANDA — enganchar el mov a ${folioMaxxa} (la app lo tenía sin factura; el mov calza el proveedor).`;
        else veredicto = `MAXXA MANDA pero REVISAR — Maxxa lo pone en ${folioMaxxa}, pero la glosa del mov no confirma a ese proveedor (ej. transf a persona). Confirmar.`;
      } else if (interno) {
        clase = "APP_INTERNO";
        appDice = `el mov "${interno.description.slice(0, 36)}" está marcado como traspaso interno`;
        veredicto = `MAXXA MANDA pero REVISAR — Maxxa lo pone en ${folioMaxxa}; la app lo trata como traspaso interno. Confirmar (caso Iván Henríquez).`;
      } else {
        clase = "REVISAR";
        appDice = `mov(s) de ese monto en estado: ${estados.join(",")}`;
        veredicto = "Mirar a mano.";
      }
    }

    out.push({
      clase,
      folio: a.folio,
      proveedor: inv.businessName ?? a.nom,
      obra: inv.projectId ? projName.get(inv.projectId) ?? "?" : "(sin obra)",
      totalFactura: inv.totalAmount,
      appPagado: paidByInv.get(inv.id) ?? 0,
      estadoApp: inv.status,
      maxxaAbono: a.abono,
      maxxaFecha: row.date,
      maxxaGlosaMov: row.desc,
      appDice,
      veredicto,
    });
  }
}

// ── resumen ───────────────────────────────────────────────────────────────
const orden = ["APP_OTRA_FACTURA", "APP_SIN_FACTURA", "FACTURA_YA_PAGADA", "MOV_NO_EXISTE", "APP_INTERNO", "REVISAR"];
const explica: Record<string, string> = {
  APP_OTRA_FACTURA: "PREMISA MJ (Maxxa manda): el mov va a la factura de Maxxa. Acción: mover el mov a esa factura. Bajo riesgo si es el mismo proveedor; revisar si la app lo tiene en otro proveedor.",
  APP_SIN_FACTURA: "PREMISA MJ (Maxxa manda): el mov va a la factura de Maxxa. La app lo tenía sin factura. Acción: engancharlo a la factura de Maxxa (salvo que la glosa claramente no sea ese proveedor → confirmar).",
  FACTURA_YA_PAGADA: "La factura YA está pagada en la app. Nada que hacer.",
  MOV_NO_EXISTE: "No hay ese movimiento en la app (otra cuenta, o pago que nunca se importó). No accionable hasta tener el movimiento.",
  APP_INTERNO: "Maxxa lo asigna a una factura; la app lo marca traspaso interno. Confirmar (como el caso Iván Henríquez) antes de mover.",
  REVISAR: "No encaja en las categorías anteriores — mirar a mano.",
};

const accionables = out.filter((o) => o.clase !== "FACTURA_YA_PAGADA");
const yaPagada = out.filter((o) => o.clase === "FACTURA_YA_PAGADA");

console.log(`${"#".repeat(78)}`);
console.log(`DESACUERDOS app↔Maxxa (asignaciones de Maxxa que la app NO confirma)`);
console.log(`${"#".repeat(78)}\n`);
console.log(`Asignaciones revisadas: ${out.length}`);
console.log(`  - ${yaPagada.length} NO son problema: la factura YA está pagada en la app (abono Maxxa redundante).`);
console.log(`  - ${accionables.length} desacuerdos reales para decidir caso a caso:\n`);
for (const c of orden) {
  const g = accionables.filter((o) => o.clase === c);
  if (!g.length) continue;
  console.log(`■ ${c} — ${g.length} casos · Maxxa dice pagado ${fmt(g.reduce((s, o) => s + o.maxxaAbono, 0))}`);
  console.log(`  ${explica[c]}`);
  // desglose por veredicto
  const porVer = new Map<string, number>();
  for (const o of g) porVer.set(o.veredicto, (porVer.get(o.veredicto) ?? 0) + 1);
  for (const [v, n] of [...porVer.entries()].sort((a, b) => b[1] - a[1])) console.log(`    · ${n}×  ${v.slice(0, 92)}`);
  for (const o of g.slice(0, 5)) {
    console.log(
      `   folio ${o.folio.padEnd(10)} ${o.proveedor.slice(0, 22).padEnd(22)} ${fmt(o.maxxaAbono).padStart(11)}  ${o.maxxaFecha}  [app: ${o.estadoApp}]`
    );
    console.log(`      ↳ ${o.appDice}`);
  }
  if (g.length > 5) console.log(`   … y ${g.length - 5} más (ver Excel)`);
  console.log("");
}

// ── Excel: hoja 1 = accionables (193), hoja 2 = ya pagadas (no acción) ──────
const toRow = (o: Out) => ({
  "Tipo de desacuerdo": o.clase,
  "Veredicto probable": o.veredicto,
  Folio: o.folio,
  Proveedor: o.proveedor,
  Obra: o.obra,
  "Total factura": o.totalFactura,
  "App pagado": o.appPagado,
  "Estado en app": o.estadoApp,
  "Maxxa dice pagó": o.maxxaAbono,
  "Fecha Maxxa": o.maxxaFecha,
  "Glosa mov Maxxa": o.maxxaGlosaMov,
  "Qué dice la app (dónde está ese mov)": o.appDice,
});
const cols = [{ wch: 18 }, { wch: 64 }, { wch: 11 }, { wch: 26 }, { wch: 20 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 34 }, { wch: 60 }];
const sortedAcc = [...accionables].sort((a, b) => orden.indexOf(a.clase) - orden.indexOf(b.clase) || b.maxxaAbono - a.maxxaAbono);

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.json_to_sheet(sortedAcc.map(toRow));
ws1["!cols"] = cols;
XLSX.utils.book_append_sheet(wb, ws1, "Desacuerdos a decidir");
const ws2 = XLSX.utils.json_to_sheet([...yaPagada].sort((a, b) => b.maxxaAbono - a.maxxaAbono).map(toRow));
ws2["!cols"] = cols;
XLSX.utils.book_append_sheet(wb, ws2, "Ya pagadas (no accion)");
const outPath = join(homedir(), "Downloads", "Desacuerdos_Maxxa_app.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`\nExcel (hoja 1: ${accionables.length} a decidir · hoja 2: ${yaPagada.length} ya pagadas): ${outPath}`);
