// Diagnóstico SOLO LECTURA: ¿el F29 que la app calcula para un período calza con
// lo que efectivamente salió del banco al mes siguiente?
//
// Uso:
//   npx tsx scripts/diag-conciliacion-f29.ts <ruta-env> [YYYY-MM]
//   npx tsx scripts/diag-conciliacion-f29.ts .env 2026-06
//
// El período es el MES TRIBUTARIO (el mes de las facturas). El pago se busca en
// el mes SIGUIENTE, que es cuando se declara y se paga el F29.
//
// Por qué existe: la pantalla /contabilidad/f29 dice cuánto había que pagar, y
// /banco/movimientos dice cuánto se pagó, pero nadie los cruza. Este script los
// pone lado a lado.
//
// DOS ADVERTENCIAS QUE HAY QUE TENER EN LA CABEZA AL LEER EL RESULTADO:
//
//   1. El giro del F29 es UNO SOLO y trae adentro IVA + PPM + impuesto único de
//      los sueldos + retención de honorarios (código 547). Comparar el cargo del
//      banco contra el IVA pelado siempre va a "no calzar" — la comparación
//      buena es contra el 547.
//   2. La categoría "impuestos" del banco no es solo F29: contribuciones,
//      impuesto a la renta y multas también caen ahí. Por eso el script imprime
//      cada movimiento con su glosa, para poder descartar los que no son F29.
//
// No escribe nada. Verifica el host de la base antes de leer (ver CLAUDE.md §4.9).

import { readFileSync } from "fs";

const envPath = process.argv[2];
const periodoArg = process.argv[3];

if (!envPath) {
  console.error("Uso: npx tsx scripts/diag-conciliacion-f29.ts <ruta-env> [YYYY-MM]");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("No hay DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

// El cliente Prisma de la app (@/lib/prisma) toma DATABASE_URL al importarse, así
// que hay que dejarla puesta ANTES del import dinámico de más abajo. Eso permite
// apuntar a una base concreta por archivo, sin depender de qué .env cargó dotenv
// (los rótulos de los .env se han swapeado — CLAUDE.md §4.9).
process.env.DATABASE_URL = url;

// Período tributario: por default, el mes anterior al actual.
const hoy = new Date();
let year: number;
let month: number; // 1..12
if (periodoArg) {
  const pm = periodoArg.match(/^(\d{4})-(\d{1,2})$/);
  if (!pm) {
    console.error("Período inválido:", periodoArg, "— formato esperado YYYY-MM");
    process.exit(1);
  }
  year = Number(pm[1]);
  month = Number(pm[2]);
} else {
  const prev = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  year = prev.getUTCFullYear();
  month = prev.getUTCMonth() + 1;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Mes de pago = mes siguiente al período tributario.
const pagoDate = new Date(Date.UTC(year, month, 1)); // month (1..12) → mes siguiente en base 0
const pagoYear = pagoDate.getUTCFullYear();
const pagoMonth = pagoDate.getUTCMonth() + 1;

const clp = (n: number) => {
  const s = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));
  return (n < 0 ? "-$" : "$") + s;
};
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const fecha = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;
// Una línea del cuadro: etiqueta a ancho fijo + monto alineado a la derecha.
const linea = (label: string, monto: number, nota = "") =>
  `  ${pad(label, 32)}${padL(clp(monto), 14)}${nota ? "   " + nota : ""}`;

// Glosas que delatan un pago de impuestos aunque el movimiento no esté
// categorizado. Sirve para no concluir "no pagó" cuando en realidad el
// movimiento existe pero está sin imputar. Sin \b de cierre a propósito: son
// prefijos ("tesorer" tiene que pegarle a "TESORERIA").
const PISTAS_IMPUESTO = /\b(sii|tesorer|impuest|f29|tgr)/i;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { computeF29Year } = await import("../src/lib/contabilidad/f29");

  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  if (host !== "ep-shy-morning") {
    console.log(
      "OJO: la base VIVA es 'ep-shy-morning'. Esta es otra base — los números de abajo pueden ser viejos."
    );
  }

  // Marcadores de base viva (CLAUDE.md §4.9), para no sacar conclusiones sobre
  // datos congelados.
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  const ultima = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true },
  });
  console.log("  Marcador #64:", p64?.name ?? "(no existe)", "| última factura:", ultima ? fecha(ultima.issueDate) : "-");
  console.log();

  // ---------------------------------------------------------------- LO DECLARADO
  const meses = await computeF29Year(year);
  const f = meses[month - 1];

  console.log(`--- F29 del período ${MESES[month - 1]} ${year} (lo que la app dice que había que pagar) ---`);
  console.log(
    linea("538 Débito (IVA ventas)", f.totalDebito,
      `(${plural(f.countVentas, "factura", "facturas")}, ${f.countNotasCreditoEmitidas} NC)`)
  );
  console.log(
    linea("537 Crédito (IVA compras)", f.totalCredito,
      `(${plural(f.countCompras, "factura", "facturas")}, ${f.countNotasCreditoRecibidas} NC)`)
  );
  console.log(linea("089 IVA determinado", f.ivaDeterminado));
  console.log(linea("    Remanente mes anterior", f.remanenteAnterior));
  console.log(linea("    IVA a pagar", f.ivaAPagar));
  console.log(linea("    Remanente al mes siguiente", f.remanenteSiguiente));
  console.log(linea(`062 PPM (${(f.ppmRate * 100).toFixed(2).replace(".", ",")}% del neto)`, f.ppm));
  console.log(
    linea("048 Impuesto único sueldos", f.impuestoUnico,
      f.impuestoUnicoPendiente ? "← SIN liquidaciones cargadas ese mes: el total queda corto" : "")
  );
  console.log(linea("151 Retención honorarios", f.retencionHonorarios));
  console.log(linea("547 TOTAL A PAGAR", f.totalAPagar));
  console.log();

  // ------------------------------------------------------------------ LO PAGADO
  const desde = new Date(Date.UTC(pagoYear, pagoMonth - 1, 1));
  const hasta = new Date(Date.UTC(pagoYear, pagoMonth, 1));

  const movs = await prisma.bankMovement.findMany({
    where: { date: { gte: desde, lt: hasta } },
    select: { date: true, description: true, amount: true, category: true },
    orderBy: { date: "asc" },
  });

  const impuestos = movs.filter((mv) => mv.category === "impuestos" && mv.amount < 0);
  const sospechosos = movs.filter(
    (mv) => mv.category !== "impuestos" && mv.amount < 0 && PISTAS_IMPUESTO.test(mv.description)
  );

  console.log(`--- Banco: cargos de impuestos en ${MESES[pagoMonth - 1]} ${pagoYear} (lo que realmente se pagó) ---`);
  if (impuestos.length === 0) {
    console.log("  (ningún movimiento categorizado como 'impuestos' ese mes)");
  }
  let totalPagado = 0;
  for (const mv of impuestos) {
    totalPagado += -mv.amount;
    console.log(`  ${fecha(mv.date)}  ${padL(clp(-mv.amount), 14)}   ${mv.description}`);
  }
  if (impuestos.length > 1) {
    console.log(`  ${" ".repeat(10)}  ${padL(clp(totalPagado), 14)}   TOTAL`);
  }
  if (sospechosos.length > 0) {
    console.log();
    console.log("  Cargos que PARECEN impuestos pero NO están categorizados así (no suman arriba):");
    for (const mv of sospechosos) {
      console.log(
        `  ${fecha(mv.date)}  ${padL(clp(-mv.amount), 14)}   ${pad(mv.description, 55)} [${mv.category ?? "sin categoría"}]`
      );
    }
  }
  console.log();

  // ---------------------------------------------------------------- LA DIFERENCIA
  const difTotal = totalPagado - f.totalAPagar;
  const difIva = totalPagado - f.ivaAPagar;
  console.log("--- Conciliación ---");
  console.log(linea("Pagado en el banco", totalPagado));
  console.log(linea("F29 calculado (547)", f.totalAPagar));
  console.log(
    linea("Diferencia", difTotal,
      difTotal === 0
        ? "calza exacto"
        : difTotal > 0
          ? "se pagó DE MÁS respecto de lo calculado"
          : "se pagó DE MENOS respecto de lo calculado")
  );
  console.log(`  (referencia: contra el IVA solo la diferencia sería ${clp(difIva)})`);
  console.log();

  // Contexto: todos los cargos de impuestos del año, por si el pago del mes se
  // corrió de fecha o se pagó en dos partes.
  const añoDesde = new Date(Date.UTC(pagoYear, 0, 1));
  const añoHasta = new Date(Date.UTC(pagoYear + 1, 0, 1));
  const todos = await prisma.bankMovement.findMany({
    where: { date: { gte: añoDesde, lt: añoHasta }, category: "impuestos" },
    select: { date: true, description: true, amount: true },
    orderBy: { date: "asc" },
  });
  console.log(`--- Todos los movimientos 'impuestos' de ${pagoYear} (contexto, por si un pago se corrió de mes) ---`);
  for (const mv of todos) {
    console.log(`  ${fecha(mv.date)}  ${padL(clp(mv.amount), 14)}   ${mv.description}`);
  }
  if (todos.length === 0) console.log("  (ninguno)");
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
