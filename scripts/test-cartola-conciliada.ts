// Test de regresión de la cartola conciliada para el contador (pendiente 196):
// src/lib/contabilidad/cartolaConciliada.ts (el armado) y el Excel que sale de
// ahí (src/lib/xlsx/CartolaConciliadaXLSX.ts). NO toca la base: los casos son
// datos armados a mano, calcados de julio 2026 en la base viva.
//
// Qué protege:
//   - la frase de cada caso que el contador no podía resolver solo (pago
//     partido en las dos direcciones, reembolso a un socio, sueldo y F29 del
//     mes anterior, traspasos, préstamos de socios),
//   - que lo dudoso se MUESTRE pendiente y no se resuelva solo (sueldo a quien
//     no está en la planilla, préstamo de socio a quien no es socio),
//   - que el signo del monto mande y no el campo `type` ("out"/"in" en la
//     Operativa),
//   - la cuadratura (saldo inicial + abonos − cargos = saldo final),
//   - que en el Excel los montos sean NÚMEROS y las fórmulas traigan su result.
//
// Uso: npx tsx scripts/test-cartola-conciliada.ts
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  armarCartola,
  formatRut,
  saldoAlCierre,
  type DatosCartola,
  type DocumentoCartola,
  type MovimientoCartolaInput,
} from "../src/lib/contabilidad/cartolaConciliada";
import { buildCartolaConciliadaXLSX } from "../src/lib/xlsx/CartolaConciliadaXLSX";

let ok = 0;
let fail = 0;
function check(nombre: string, actual: unknown, esperado: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(esperado);
  if (a === e) {
    ok++;
  } else {
    fail++;
    console.log(`  FALLA ${nombre}\n        esperado: ${e}\n        actual:   ${a}`);
  }
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function doc(p: Partial<DocumentoCartola> & { id: string }): DocumentoCartola {
  return {
    type: "recibida",
    tipoDoc: 33,
    folioNumber: null,
    rutIssuer: null,
    rutReceiver: "77270733-9",
    businessName: null,
    totalAmount: 0,
    origin: "sii_automatica",
    status: "pagada",
    issueDate: d("2026-07-01"),
    ...p,
  };
}

function mov(p: Partial<MovimientoCartolaInput> & { id: string; date: Date; amount: number }): MovimientoCartolaInput {
  return {
    cuentaId: "op",
    description: "",
    balanceAfter: null,
    status: "conciliado",
    category: null,
    counterpartyName: null,
    counterpartyRut: null,
    salaryPeriod: null,
    netZeroGroupId: null,
    netZeroAmount: null,
    parInternoId: null,
    projectName: null,
    internalConcepto: null,
    pagos: [],
    ncDevueltas: [],
    ...p,
  };
}

const documentos: DocumentoCartola[] = [
  doc({ id: "f179", type: "emitida", folioNumber: "179", rutIssuer: "77270733-9", rutReceiver: "76937740-9", businessName: "SERVICIOS MEDICOS TRAUMAPED LTDA", totalAmount: 10798309 }),
  doc({ id: "f178", type: "emitida", folioNumber: "178", rutIssuer: "77270733-9", rutReceiver: "76937740-9", businessName: "SERVICIOS MEDICOS TRAUMAPED LTDA", totalAmount: 6179707 }),
  doc({ id: "f177", type: "emitida", folioNumber: "177", rutIssuer: "77270733-9", rutReceiver: "76937740-9", businessName: "SERVICIOS MEDICOS TRAUMAPED LTDA", totalAmount: 9316389 }),
  doc({ id: "f183", type: "emitida", folioNumber: "183", rutIssuer: "77270733-9", rutReceiver: "76337771-7", businessName: "AGRICOLA OVALLE TIL TIL LIMITADA", totalAmount: 5704910 }),
  doc({ id: "k979", folioNumber: "1522979", rutIssuer: "77137860-9", businessName: "Comercial K SpA", totalAmount: 2400000 }),
  doc({ id: "k838", folioNumber: "1523838", rutIssuer: "77137860-9", businessName: "Comercial K SpA", totalAmount: 1636905 }),
  doc({ id: "sr1", tipoDoc: 1043, origin: "sin_respaldo", folioNumber: "SR-abc", rutIssuer: "0137279045", businessName: "DANIEL IGNACIO", totalAmount: 340000 }),
];

const movimientos: MovimientoCartolaInput[] = [
  // Una transferencia que paga tres facturas.
  mov({ id: "m7m", date: d("2026-07-07"), amount: 7000000, description: "0769377409 Transf." }),
  // La F183 pagada en tres: una de otro mes (referido) y dos de este.
  mov({ id: "m183a", date: d("2026-07-17"), amount: 3000000, description: "0105112904 Transf. Maria Ovalle Al", pagos: [{ invoiceId: "f183", amountApplied: 3000000 }] }),
  mov({ id: "m183b", date: d("2026-07-31"), amount: 704910, description: "0105112904 Transf. Maria Ovalle Al", pagos: [{ invoiceId: "f183", amountApplied: 704910 }] }),
  // Reembolso a MJ de una factura de Comercial K.
  mov({ id: "mreem", date: d("2026-07-15"), amount: -2400000, description: "0180239839 Transf a Maria Jose Bla", counterpartyRut: "0180239839", counterpartyName: "Maria Jose Bla", pagos: [{ invoiceId: "k979", amountApplied: 2400000 }] }),
  // Pago directo al proveedor, parcial.
  mov({ id: "mparc", date: d("2026-07-15"), amount: -1887454, status: "parcial", description: "0771378609 Transf a Comercial K", counterpartyRut: "0771378609", pagos: [{ invoiceId: "k838", amountApplied: 1636905 }] }),
  // Pago sin respaldo a un maestro.
  mov({ id: "msr", date: d("2026-07-13"), amount: -340000, description: "0137279045 Transf a DANIEL IGNACIO", counterpartyRut: "0137279045", counterpartyName: "DANIEL IGNACIO", pagos: [{ invoiceId: "sr1", amountApplied: 340000 }] }),
  // Previred e impuestos: del mes anterior.
  mov({ id: "mprev", date: d("2026-07-10"), amount: -2263620, status: "sin_factura", category: "previred", description: "PAGO EN LINEA PREVIRED" }),
  mov({ id: "mf29", date: d("2026-07-17"), amount: -1395785, status: "sin_factura", category: "impuestos", description: "PAGO EN LINEA S.I.I." }),
  // Préstamo de socio que ENTRA, sin RUT guardado (solo en la glosa).
  mov({ id: "mprest", date: d("2026-07-08"), amount: 4750000, status: "sin_factura", category: "prestamo_socio", description: "0180239839 Transf. Maria Blanco Ro" }),
  // Préstamo de socio a quien NO es socio → por aclarar.
  mov({ id: "mrojas", date: d("2026-07-09"), amount: -500000, status: "sin_factura", category: "prestamo_socio", description: "0162740946 Transf a ROJAS MELLA AL", counterpartyRut: "0162740946", counterpartyName: "ROJAS MELLA AL" }),
  // Sin explicar.
  mov({ id: "mpend", date: d("2026-07-02"), amount: -13934, status: "sin_asignar", description: "Compra MERCADOPAGO *MERC" }),
  // Traspaso Operativa → Sueldos (con su par en la otra cuenta).
  mov({ id: "mtrasp", date: d("2026-07-01"), amount: -6500000, status: "interno", category: "transfer_interno", description: "0772707339 Transf a BLARQ SPA", parInternoId: "strasp", projectName: "Rosas", internalConcepto: "obra" }),
  // ── Cuenta Sueldos ──
  mov({ id: "strasp", cuentaId: "su", date: d("2026-07-01"), amount: 6500000, status: "interno", category: "transfer_interno", description: "0772707339 Transf de BLARQ SPA", parInternoId: "mtrasp", projectName: "Rosas", internalConcepto: "obra" }),
  mov({ id: "ssueldo1", cuentaId: "su", date: d("2026-07-01"), amount: -3000000, status: "sin_factura", category: "sueldo", description: "018022887K Transf a Jose Tomas Lar", counterpartyRut: "018022887K", counterpartyName: "Jose Tomas Lar" }),
  mov({ id: "sjp", cuentaId: "su", date: d("2026-07-01"), amount: -1000000, status: "sin_factura", category: "sueldo", description: "0204457522 Transf a Juan Pablo Cos", counterpartyRut: "0204457522", counterpartyName: "Juan Pablo Cos" }),
  mov({ id: "ssueldo31", cuentaId: "su", date: d("2026-07-31"), amount: -2750000, status: "sin_factura", category: "sueldo", salaryPeriod: "2026-07", description: "0180239839 Transf a Maria Jose Bla", counterpartyRut: "0180239839", counterpartyName: "Maria Jose Bla" }),
];
// El 7M: tres pagos.
movimientos[0].pagos = [
  { invoiceId: "f178", amountApplied: 2689913 },
  { invoiceId: "f179", amountApplied: 3798309 },
  { invoiceId: "f177", amountApplied: 511778 },
];
// Un movimiento de la Operativa con type "out" en la base: el armado ni mira
// `type`, manda el signo del monto.
movimientos.push(
  mov({ id: "mout", date: d("2026-07-20"), amount: -10000, status: "sin_factura", category: "comision_bancaria", description: "COM.MANTENCION PLAN" })
);

const saldoInicialOp = 31626047;
const sumaOp = movimientos.filter((m) => m.cuentaId === "op").reduce((s, m) => s + m.amount, 0);
const saldoInicialSu = 8869686;
const sumaSu = movimientos.filter((m) => m.cuentaId === "su").reduce((s, m) => s + m.amount, 0);
// El balanceAfter del último movimiento en orden canónico = saldo de cierre.
const ultimoOp = movimientos.filter((m) => m.cuentaId === "op").sort((a, b) => a.date.getTime() - b.date.getTime() || a.amount - b.amount).at(-1)!;
ultimoOp.balanceAfter = saldoInicialOp + sumaOp;
const ultimoSu = movimientos.filter((m) => m.cuentaId === "su").sort((a, b) => a.date.getTime() - b.date.getTime() || a.amount - b.amount).at(-1)!;
ultimoSu.balanceAfter = saldoInicialSu + sumaSu - 1; // a propósito: no cuadra por $1

const datos: DatosCartola = {
  year: 2026,
  month: 7,
  cuentas: [
    { id: "op", alias: "Operativa", accountNumber: "0-000-8913459-5", saldoInicialBanco: saldoInicialOp },
    { id: "su", alias: "Sueldos", accountNumber: "0-000-9987891-6", saldoInicialBanco: saldoInicialSu },
  ],
  movimientos,
  referidos: [
    { id: "m183mayo", cuentaId: "op", date: d("2026-05-11"), amount: 2000000, description: "0105112904 Transf. Maria Carolina", netZeroGroupId: null, netZeroAmount: null },
  ],
  documentos,
  pagosDeDocumentos: [
    { invoiceId: "f183", bankMovementId: "m183mayo", amountApplied: 2000000 },
    { invoiceId: "f183", bankMovementId: "m183a", amountApplied: 3000000 },
    { invoiceId: "f183", bankMovementId: "m183b", amountApplied: 704910 },
    { invoiceId: "k979", bankMovementId: "mreem", amountApplied: 2400000 },
    { invoiceId: "k838", bankMovementId: "mparc", amountApplied: 1636905 },
    { invoiceId: "sr1", bankMovementId: "msr", amountApplied: 340000 },
    { invoiceId: "f179", bankMovementId: "m7m", amountApplied: 3798309 },
    { invoiceId: "f178", bankMovementId: "m7m", amountApplied: 2689913 },
    { invoiceId: "f177", bankMovementId: "m7m", amountApplied: 511778 },
  ],
  ncAplicadas: [],
  empleados: [
    { rut: "18.022.887-K", nombre: "José Tomás Larraín" },
    { rut: "18.023.983-9", nombre: "María José Blanco" },
  ],
};

const c = armarCartola(datos);
const fila = (id: string) => c.filas.find((f) => f.movimientoId === id)!;
const resumen = (id: string) => {
  const f = fila(id);
  return { estado: f.estado, queEs: f.queEs, detalle: f.detalle };
};

console.log("Formato de RUT");
check("RUT del banco con cero adelante", formatRut("0180239839"), "18.023.983-9");
check("RUT con K", formatRut("018022887K"), "18.022.887-K");
check("RUT de factura", formatRut("76937740-9"), "76.937.740-9");

console.log("Pago partido: una transferencia, tres facturas");
check("7M es pago de cliente", resumen("m7m"), { estado: "Conciliado", queEs: "Pago de cliente", detalle: null });
check(
  "las tres facturas, de mayor a menor, con lo aplicado",
  fila("m7m").aplicaciones.map((a) => [a.folio, a.aplicado, a.rut]),
  [["179", 3798309, "76.937.740-9"], ["178", 2689913, "76.937.740-9"], ["177", 511778, "76.937.740-9"]]
);
check(
  "quien transfiere no es el cliente: se dice",
  fila("m183a").detalle,
  "Transfirió Maria Ovalle Al, a nombre del cliente"
);

console.log("Pago partido: una factura, varias transferencias");
const f183 = c.facturasPartidas.find((f) => f.folio === "183")!;
check(
  "F183: las tres transferencias en orden, con lo que le queda",
  f183.pagos.map((p) => [p.fecha.toISOString().slice(0, 10), p.aplicado, p.leQueda, p.n != null]),
  [["2026-05-11", 2000000, 3704910, false], ["2026-07-17", 3000000, 704910, true], ["2026-07-31", 704910, 0, true]]
);
check("F183 queda en cero", f183.leQueda, 0);
check("F183 es venta", f183.lado, "venta");
check("una compra pagada 1 a 1 no entra a la hoja por factura", c.facturasPartidas.some((f) => f.folio === "1522979"), false);
check("una factura con saldo SÍ entra (Comercial K 1523838 queda en cero, no entra)", c.facturasPartidas.some((f) => f.folio === "1523838"), false);

console.log("Reembolso a un socio");
check("dice reembolso y a quién", resumen("mreem"), {
  estado: "Conciliado",
  queEs: "Reembolso a María José Blanco",
  detalle: "Pagó estas compras con su plata; BLARQ se la devuelve",
});
check("lista la factura del proveedor", fila("mreem").aplicaciones.map((a) => [a.folio, a.razonSocial, a.aplicado]), [["1522979", "Comercial K SpA", 2400000]]);

console.log("Parcial y pendiente");
check("parcial dice cuánto falta", resumen("mparc"), { estado: "Parcial", queEs: "Pago a proveedor", detalle: "Falta explicar $250.549" });
check("parcial: sinExplicar", fila("mparc").sinExplicar, 250549);
check("sin asignar se muestra", resumen("mpend"), { estado: "Pendiente", queEs: "Sin explicar todavía", detalle: null });

console.log("Pago sin respaldo");
check("frase", resumen("msr"), { estado: "Conciliado", queEs: "Pago sin respaldo", detalle: "Pago a DANIEL IGNACIO sin boleta ni factura" });
check("el folio SR- no sale", fila("msr").aplicaciones[0].folio, null);

console.log("Sin factura: de qué mes es");
check("Previred del 10-jul es de junio", fila("mprev").queEs, "Previred de junio");
check("SII del 17-jul es el F29 de junio", fila("mf29").queEs, "Impuestos SII · F29 de junio");
check("sueldo pagado el 1 es del mes anterior", resumen("ssueldo1"), { estado: "Conciliado", queEs: "Sueldo de junio", detalle: "José Tomás Larraín" });
check("sueldo marcado a mano manda", resumen("ssueldo31"), { estado: "Conciliado", queEs: "Sueldo de julio", detalle: "María José Blanco" });

console.log("Socios y traspasos");
check("préstamo que entra, RUT sacado de la glosa", resumen("mprest"), {
  estado: "Conciliado",
  queEs: "Préstamo de socio",
  detalle: "Entra de María José Blanco (cuenta corriente con los socios)",
});
check("traspaso con su par y la obra", resumen("mtrasp"), {
  estado: "Conciliado",
  queEs: "Traspaso entre cuentas BLARQ",
  detalle: "A la cuenta Sueldos · utilidad de obra Rosas",
});
check("el otro lado del traspaso", fila("strasp").detalle, "Desde la cuenta Operativa · utilidad de obra Rosas");

console.log("Lo dudoso queda PENDIENTE (no se resuelve solo)");
check("sueldo a quien no está en la planilla", resumen("sjp"), {
  estado: "Pendiente",
  queEs: "Por aclarar",
  detalle: "Marcado como sueldo de junio, pero Juan Pablo Cos no está en la planilla de remuneraciones",
});
check("préstamo de socio a quien no es socio", resumen("mrojas"), {
  estado: "Pendiente",
  queEs: "Por aclarar",
  detalle: "Marcado como préstamo de socio, pero ROJAS MELLA AL no es socio",
});

console.log("Signo, orden y saldos");
check("el signo manda: cargo", [fila("mout").cargo, fila("mout").abono], [10000, null]);
const su = c.filas.filter((f) => f.cuenta === "Sueldos");
check("Sueldos 01-jul: primero entra el traspaso", su[0].movimientoId, "strasp");
check("ningún saldo negativo inventado", c.filas.every((f) => f.saldo >= 0), true);
check("N° correlativo", c.filas.map((f) => f.n), c.filas.map((_, i) => i + 1));
const cop = c.cuadratura.find((q) => q.cuenta === "Operativa")!;
check("Operativa cuadra", [cop.saldoInicial + cop.entradas - cop.salidas === cop.saldoFinalBanco, cop.diferencia], [true, 0]);
const csu = c.cuadratura.find((q) => q.cuenta === "Sueldos")!;
check("Sueldos NO cuadra y se dice cuánto", csu.diferencia, -1);
check("resumen", c.resumen, { movimientos: 17, conciliados: 13, parciales: 1, pendientes: 3 });

console.log("Saldo al cierre del día con montos repetidos");
{
  // 30-dic-2025, cuenta Sueldos, tal como está en la base: los dos −$750.000
  // quedaron con los saldos cruzados respecto del desempate por descripción.
  const dia = [
    { amount: -2000000, balanceAfter: 3608762, description: "0180239839 Transf a Maria Jose Bla" },
    { amount: -1000000, balanceAfter: 2608762, description: "018022887K Transf a Jose Tomas Lar" },
    { amount: -750000, balanceAfter: 1108762, description: "018022887K Transf a Jose Tomas Lar" },
    { amount: -750000, balanceAfter: 1858762, description: "0180239839 Transf a Maria Jose Bla" },
  ].map((m) => ({ ...m, date: d("2025-12-30") }));
  check("cierra en el saldo que encadena, no en el último por descripción", saldoAlCierre(dia), 1108762);
  check("un solo movimiento: su saldo", saldoAlCierre([dia[0]]), 3608762);
  // Sin el −$1.000.000 del medio los saldos guardados ya no encadenan: no se
  // inventa un cierre, se usa el último canónico y la cuadratura lo muestra.
  check("si no encadena (falta uno), vuelve al último canónico", saldoAlCierre([dia[0], dia[2], dia[3]]), 1858762);
}

console.log("Boleta de honorarios: la retención no es saldo pendiente");
{
  const bhe = doc({ id: "bhe14", tipoDoc: 1039, folioNumber: "14", rutIssuer: "20445752-2", businessName: "JUAN PABLO COSTA AGUIRRE", totalAmount: 353982, issueDate: d("2026-03-31") });
  const pago = mov({ id: "mbhe", date: d("2026-04-06"), amount: -300000, description: "0204457522 Transf a Juan Pablo Cos", counterpartyRut: "0204457522", pagos: [{ invoiceId: "bhe14", amountApplied: 300000 }] });
  const pagoMitad1 = mov({ id: "mbhe2a", date: d("2026-04-10"), amount: -150000, description: "0204457522 Transf a Juan Pablo Cos", counterpartyRut: "0204457522", pagos: [{ invoiceId: "bhe15", amountApplied: 150000 }] });
  const pagoMitad2 = mov({ id: "mbhe2b", date: d("2026-04-20"), amount: -150000, description: "0204457522 Transf a Juan Pablo Cos", counterpartyRut: "0204457522", pagos: [{ invoiceId: "bhe15", amountApplied: 150000 }] });
  const bhe15 = { ...bhe, id: "bhe15", folioNumber: "15", issueDate: d("2026-04-01") };
  const cb = armarCartola({
    ...datos,
    month: 4,
    movimientos: [pago, pagoMitad1, pagoMitad2],
    referidos: [],
    documentos: [bhe, bhe15],
    pagosDeDocumentos: [
      { invoiceId: "bhe14", bankMovementId: "mbhe", amountApplied: 300000 },
      { invoiceId: "bhe15", bankMovementId: "mbhe2a", amountApplied: 150000 },
      { invoiceId: "bhe15", bankMovementId: "mbhe2b", amountApplied: 150000 },
    ],
  });
  const f = cb.filas.find((x) => x.movimientoId === "mbhe")!;
  check("frase de honorarios", [f.queEs, f.aplicaciones[0].documento, f.aplicaciones[0].folio], ["Pago de honorarios", "Boleta de honorarios", "14"]);
  check("pagada en una transferencia + retención: no va a la hoja por factura", cb.facturasPartidas.some((x) => x.folio === "14"), false);
  const b15 = cb.facturasPartidas.find((x) => x.folio === "15")!;
  check("pagada en dos: retención 15,25% y queda en cero", [b15.retencion, b15.retencionTasa, b15.leQueda], [53982, 0.1525, 0]);
  check("le queda después de cada pago, sin contar la retención", b15.pagos.map((p) => p.leQueda), [150000, 0]);
}

console.log("Año completo");
{
  const mayo = mov({ id: "may1", date: d("2026-05-20"), amount: -100000, status: "sin_factura", category: "comision_bancaria", description: "COM.MANTENCION PLAN" });
  mayo.balanceAfter = saldoInicialOp - 100000;
  // Julio arranca donde terminó mayo, pero el cierre de julio del fixture no
  // descuenta la comisión de mayo: la cartola dice $100.000 más de lo que da la
  // suma, y el mes a mes tiene que decir que es en JULIO.
  const ca = armarCartola({ ...datos, month: null, movimientos: [mayo, ...movimientos] });
  check("período", [ca.periodo, ca.esAño], ["año 2026", true]);
  check("desde / hasta", [ca.desde?.toISOString().slice(0, 10), ca.hasta?.toISOString().slice(0, 10)], ["2026-05-20", "2026-07-31"]);
  check(
    "cuadratura mes a mes: mayo y julio de la Operativa, julio de Sueldos",
    ca.cuadraturaPorMes.map((q) => [q.month, q.cuenta, q.diferencia]),
    [[5, "Operativa", 0], [7, "Operativa", 100000], [7, "Sueldos", -1]]
  );
  check("el N° corre por todo el año", ca.filas.map((x) => x.n), ca.filas.map((_, i) => i + 1));
  check("mayo va primero en la Operativa", ca.filas[0].movimientoId, "may1");
}

async function excel() {
  console.log("Excel");
  const buf = await buildCartolaConciliadaXLSX(c);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Cartola")!;
  check("hojas", wb.worksheets.map((w) => w.name), ["Cartola", "Pagadas en partes"]);
  // Encabezado en la fila 5; datos desde la 6.
  const enc = (ws.getRow(5).values as unknown[]).slice(1);
  const col = (t: string) => enc.indexOf(t) + 1;
  check("columnas clave", ["Cargo", "Abono", "Saldo", "Qué es", "Folio", "Aplicado"].every((t) => col(t) > 0), true);

  let sumaCargo = 0;
  let sumaAbono = 0;
  let sumaAplicado = 0;
  let todosNumeros = true;
  let r = 6;
  for (; r <= ws.rowCount; r++) {
    const n = ws.getRow(r).getCell(1).value;
    if (typeof n !== "number") break;
    for (const t of ["Cargo", "Abono", "Saldo", "Aplicado"]) {
      const v = ws.getRow(r).getCell(col(t)).value;
      if (v != null && typeof v !== "number") todosNumeros = false;
    }
    sumaCargo += Number(ws.getRow(r).getCell(col("Cargo")).value ?? 0);
    sumaAbono += Number(ws.getRow(r).getCell(col("Abono")).value ?? 0);
    sumaAplicado += Number(ws.getRow(r).getCell(col("Aplicado")).value ?? 0);
  }
  check("montos como números", todosNumeros, true);
  check("sumar Cargo da lo que salió del banco", sumaCargo, c.cuadratura.reduce((s, q) => s + q.salidas, 0));
  check("sumar Abono da lo que entró", sumaAbono, c.cuadratura.reduce((s, q) => s + q.entradas, 0));
  check(
    "sumar Aplicado da lo conciliado a documentos",
    sumaAplicado,
    c.filas.reduce((s, f) => s + f.aplicaciones.reduce((x, a) => x + a.aplicado, 0), 0)
  );
  // El 7M ocupa tres filas con el mismo N°, y el cargo/abono solo en la primera.
  const n7 = fila("m7m").n;
  const filas7: number[] = [];
  for (let i = 6; i < r; i++) if (ws.getRow(i).getCell(1).value === n7) filas7.push(i);
  check("el 7M ocupa 3 filas", filas7.length, 3);
  check("el abono solo en la primera", filas7.map((i) => ws.getRow(i).getCell(col("Abono")).value ?? null), [7000000, null, null]);

  // Fórmulas de la cuadratura: todas con su valor ya calculado ESCRITO en el
  // archivo (<v>), que es lo que muestran los visores que no recalculan. Se
  // mira el XML y no lo que devuelve ExcelJS al leer: su lector descarta un
  // resultado 0 (la "Diferencia" cuando cuadra) aunque esté escrito.
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const formulas = xml.match(/<f>[^<]*<\/f>/g) ?? [];
  const conValor = xml.match(/<f>[^<]*<\/f><v>[^<]+<\/v>/g) ?? [];
  check("hay fórmulas en la cuadratura", formulas.length, 2 * 4);
  check("todas con su valor escrito", conValor.length, formulas.length);

  const ws2 = wb.getWorksheet("Pagadas en partes")!;
  const folios: unknown[] = [];
  // Las filas de documento son las que dicen Venta/Compra en la primera columna.
  ws2.eachRow((row, i) => {
    if (i > 5 && row.getCell(1).value) folios.push(row.getCell(3).value);
  });
  check("hoja por factura: las ventas partidas", folios, [177, 178, 179, 183]);
}

excel().then(() => {
  console.log(`\n${ok} ok, ${fail} fallas`);
  if (fail) process.exit(1);
});
