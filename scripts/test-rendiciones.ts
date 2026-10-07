// Test de regresión de las rendiciones de gastos de los socios
// (src/lib/contabilidad/rendiciones.ts y su Excel) y del período compartido
// con la cartola (src/lib/contabilidad/periodo.ts). NO toca la base: los casos
// están calcados de la base viva (el reembolso de la CMR del 06-oct-2026).
//
// Qué protege:
//   - qué cuenta como reembolso: salida a un socio conciliada a documentos
//     recibidos de OTRO emisor; no la boleta de honorarios del propio socio,
//     ni una transferencia a un socio sin documentos, ni a un tercero;
//   - lo que falta de respaldo y la nota de MJ, solo cuando falta;
//   - que en el Excel Rendido + Sin respaldo = Reembolsado, con fórmulas que
//     traen su valor escrito.
//
// Uso: npx tsx scripts/test-rendiciones.ts
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  armarRendiciones,
  type DatosRendiciones,
  type DocumentoRendicion,
  type MovimientoRendicionInput,
} from "../src/lib/contabilidad/rendiciones";
import { leerPeriodo, nombrePeriodo, periodoParam, periodoPorDefecto } from "../src/lib/contabilidad/periodo";
import { buildRendicionesXLSX } from "../src/lib/xlsx/RendicionesXLSX";

let ok = 0;
let fail = 0;
function check(nombre: string, actual: unknown, esperado: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(esperado);
  if (a === e) ok++;
  else {
    fail++;
    console.log(`  FALLA ${nombre}\n        esperado: ${e}\n        actual:   ${a}`);
  }
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const doc = (p: Partial<DocumentoRendicion> & { id: string }): DocumentoRendicion => ({
  type: "recibida",
  tipoDoc: 33,
  folioNumber: null,
  rutIssuer: "96792430-K",
  businessName: "SODIMAC S.A.",
  totalAmount: 0,
  origin: "sii_automatica",
  issueDate: d("2026-10-01"),
  obra: null,
  categoria: "Materiales",
  ...p,
});
const mov = (p: Partial<MovimientoRendicionInput> & { id: string; amount: number }): MovimientoRendicionInput => ({
  date: d("2026-10-06"),
  cuenta: "Operativa",
  description: "0180239839 Transf a Maria Jose Bla",
  counterpartyRut: "0180239839",
  counterpartyName: "Maria Jose Bla",
  notes: null,
  netZeroAmount: null,
  pagos: [],
  ...p,
});

const nota = "Falta factura · Comercial K SpA (77137860-9) · falta $1.123.208";
const datos: DatosRendiciones = {
  year: 2026,
  month: 10,
  documentos: [
    doc({ id: "s1", folioNumber: "150022586", totalAmount: 69990, issueDate: d("2026-10-05") }),
    doc({ id: "s2", folioNumber: "149639007", totalAmount: 42028, issueDate: d("2026-09-15"), categoria: "Herramientas" }),
    doc({ id: "casa", folioNumber: "8501", rutIssuer: "77253079-K", businessName: "COMERCIAL KITCHEN-IT SPA", totalAmount: 72329, obra: "CASA", categoria: null }),
    // La boleta de honorarios de la propia MJ: no es una compra que rinde.
    doc({ id: "bheMJ", tipoDoc: 1039, folioNumber: "20", rutIssuer: "18023983-9", businessName: "MARIA JOSE BLANCO ROGAT", totalAmount: 2339181 }),
    doc({ id: "jt1", folioNumber: "138584982", totalAmount: 173760, obra: "Eduardo Montes" }),
    doc({ id: "venta", type: "emitida", folioNumber: "183", rutIssuer: "77270733-9", businessName: "BLARQ", totalAmount: 1000 }),
  ],
  movimientos: [
    // Reembolso parcial de la CMR, con la nota de lo que falta.
    mov({ id: "cmr", amount: -1307555, notes: nota, pagos: [
      { invoiceId: "s1", amountApplied: 69990 },
      { invoiceId: "s2", amountApplied: 42028 },
      { invoiceId: "casa", amountApplied: 72329 },
    ] }),
    // Su propia boleta: fuera.
    mov({ id: "honorarios", amount: -2000000, date: d("2026-10-02"), pagos: [{ invoiceId: "bheMJ", amountApplied: 2000000 }] }),
    // Reembolso a JT, completo; el RUT viene solo en la glosa.
    mov({ id: "jt", amount: -173760, date: d("2026-10-03"), description: "018022887K Transf a Jose Tomas Lar", counterpartyRut: null, counterpartyName: null, notes: "nota que no se muestra", pagos: [{ invoiceId: "jt1", amountApplied: 173760 }] }),
    // A un tercero (no socio) pagando Sodimac: no es rendición de socio.
    mov({ id: "tercero", amount: -69990, description: "0137279045 Transf a DANIEL IGNACIO", counterpartyRut: "0137279045", counterpartyName: "DANIEL IGNACIO", pagos: [{ invoiceId: "s1", amountApplied: 1 }] }),
    // Entrada (un pago de cliente): no.
    mov({ id: "entrada", amount: 1000, pagos: [{ invoiceId: "venta", amountApplied: 1000 }] }),
  ],
  empleados: [
    { rut: "18.022.887-K", nombre: "José Tomás Larraín" },
    { rut: "18.023.983-9", nombre: "María José Blanco" },
  ],
};

const r = armarRendiciones(datos);
const mj = r.socios.find((s) => s.socio === "María José Blanco")!;
const jt = r.socios.find((s) => s.socio === "José Tomás Larraín")!;

console.log("Qué es un reembolso");
check("período", [r.periodo, r.esAño], ["octubre 2026", false]);
check("MJ: solo el de la CMR (no su boleta)", mj.reembolsos.map((x) => x.movimientoId), ["cmr"]);
check("JT: el suyo, con RUT sacado de la glosa", jt.reembolsos.map((x) => x.movimientoId), ["jt"]);
check("RUT de cada socio", [mj.rut, jt.rut], ["18.023.983-9", "18.022.887-K"]);
check("quien más rindió va primero", r.socios.map((s) => s.socio), ["María José Blanco", "José Tomás Larraín"]);

console.log("Documentos y lo que falta");
const cmr = mj.reembolsos[0];
check("documentos por fecha", cmr.lineas.map((l) => l.folio), ["149639007", "8501", "150022586"]);
check("obra CASA va como cualquier otra", cmr.lineas.find((l) => l.folio === "8501")!.obra, "CASA");
check("respaldado y sin respaldo", [cmr.respaldado, cmr.sinRespaldo], [184347, 1123208]);
check("con faltante, va la nota", cmr.nota, nota);
check("sin faltante, la nota NO va", jt.reembolsos[0].nota, null);
check("totales del socio", [mj.total, mj.respaldado, mj.sinRespaldo, mj.documentos], [1307555, 184347, 1123208, 3]);

console.log("Período compartido con la cartola");
check("un mes", leerPeriodo("2026-07"), { year: 2026, month: 7 });
check("el año", leerPeriodo("2026"), { year: 2026, month: null });
check("mes inválido", leerPeriodo("2026-13"), null);
check("basura", leerPeriodo("julio"), null);
check("por defecto, el mes anterior", periodoPorDefecto(new Date(2026, 0, 15)), { year: 2025, month: 12 });
check("param y nombre", [periodoParam({ year: 2026, month: 7 }), nombrePeriodo({ year: 2026, month: null })], ["2026-07", "año 2026"]);

async function excel() {
  console.log("Excel");
  const buf = await buildRendicionesXLSX(r);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  check("una hoja por socio", wb.worksheets.map((w) => w.name), ["María José Blanco", "José Tomás Larraín"]);
  const ws = wb.getWorksheet("María José Blanco")!;
  const enc = (ws.getRow(5).values as unknown[]).slice(1);
  const col = (t: string) => enc.indexOf(t) + 1;
  let rendido = 0;
  let reembolsado = 0;
  let sin = 0;
  for (let i = 6; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (!(row.getCell(1).value instanceof Date)) continue;
    rendido += Number(row.getCell(col("Rendido")).value ?? 0);
    reembolsado += Number(row.getCell(col("Reembolsado")).value ?? 0);
    sin += Number(row.getCell(col("Sin respaldo")).value ?? 0);
  }
  check("Rendido + Sin respaldo = Reembolsado", [rendido, sin, reembolsado], [184347, 1123208, 1307555]);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const formulas = xml.match(/<f>[^<]*<\/f>/g) ?? [];
  const conValor = xml.match(/<f>[^<]*<\/f><v>[^<]+<\/v>/g) ?? [];
  check("tres totales con fórmula y su valor escrito", [formulas.length, conValor.length], [3, 3]);
}

excel().then(() => {
  console.log(`\n${ok} ok, ${fail} fallas`);
  if (fail) process.exit(1);
});
