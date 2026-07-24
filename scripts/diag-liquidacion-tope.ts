// Snapshot de regresión para el cambio del TOPE IMPONIBLE en sueldos.ts.
//
// Reproduce dos liquidaciones con la función pura computeLiquidacion:
//   - MJ junio 2026: imponible ~94 UF, POR ENCIMA del tope de 90 UF → el cambio
//     debe hacerla calzar al peso con la liquidación del contador.
//   - Caso bajo el tope (sueldo chico): imponible < 90 UF → NO debe cambiar nada.
//
// Correr ANTES y DESPUÉS de tocar sueldos.ts y comparar.
//   npx tsx scripts/diag-liquidacion-tope.ts

import {
  computeLiquidacion,
  grossUpFromLiquido,
  type EmpleadoParams,
  type IndicadoresMes,
} from "../src/lib/contabilidad/sueldos";

// Indicadores reales de junio 2026 (del PDF del contador).
const indJunio: IndicadoresMes = {
  uf: 40820.31,
  utm: 71506,
  gratificacionTopeMensual: 219115, // tope gratificación del contador
  topeImponibleSaludUF: 90, // tope imponible = 90 UF
};

// MJ: plan Colmena 14,0880 UF, comisión Planvital 1,16%, líquido objetivo $3.000.000.
const mj: EmpleadoParams = {
  nombre: "María José Blanco",
  rut: "18.023.983-9",
  sueldoBase: 0, // se despeja por gross-up
  colacion: 150000,
  movilizacion: 150000,
  afpComisionRate: 0.0116,
  isaprePlanUF: 14.088,
};

// Caso bajo el tope: sueldo base $1.500.000 → imponible ~46 UF < 90 UF.
const chico: EmpleadoParams = {
  nombre: "Caso bajo el tope",
  rut: "00.000.000-0",
  sueldoBase: 1500000,
  colacion: 0,
  movilizacion: 0,
  afpComisionRate: 0.0116,
  isaprePlanUF: 3.0,
};

const money = (n: number) => "$" + n.toLocaleString("es-CL");

function dump(titulo: string, liq: ReturnType<typeof computeLiquidacion>) {
  console.log(`\n=== ${titulo} ===`);
  console.log(`  Sueldo base........... ${money(liq.sueldoBase)}`);
  console.log(`  Gratificación......... ${money(liq.gratificacion)}`);
  console.log(`  Total imponible....... ${money(liq.totalImponible)}`);
  console.log(`  Total no imponible.... ${money(liq.totalNoImponible)}`);
  console.log(`  Total haberes......... ${money(liq.totalHaberes)}`);
  console.log(`  AFP capitalización.... ${money(liq.afpCapitalizacion)}`);
  console.log(`  AFP comisión.......... ${money(liq.afpComision)}`);
  console.log(`  Total AFP............. ${money(liq.totalAfp)}`);
  console.log(`  Salud legal 7%........ ${money(liq.saludLegal)}`);
  console.log(`  Salud adicional....... ${money(liq.saludAdicional)}`);
  console.log(`  Total salud........... ${money(liq.totalSalud)}`);
  console.log(`  Cesantía.............. ${money(liq.cesantia)}`);
  console.log(`  Base impuesto......... ${money(liq.baseImpuesto)}`);
  console.log(`  Impuesto único........ ${money(liq.impuestoUnico)}`);
  console.log(`  Total descuentos...... ${money(liq.totalDescuentos)}`);
  console.log(`  LÍQUIDO............... ${money(liq.liquido)}`);
}

// MJ por gross-up (como lo hace la app real).
const mjRes = grossUpFromLiquido(mj, indJunio, 3000000);
dump("MJ junio 2026 (gross-up a $3.000.000)", mjRes.liquidacion);

// Caso chico directo.
dump("Caso bajo el tope (base $1.500.000)", computeLiquidacion(chico, indJunio));

// Referencia del contador para MJ (verificación al peso).
console.log("\n--- Referencia contador MJ (junio 2026) ---");
console.log("  Total imponible....... $3.835.275");
console.log("  Total AFP............. $409.999");
console.log("  Total salud........... $575.077");
console.log("  Cesantía.............. $23.012");
console.log("  Base impuesto......... $3.145.096");
console.log("  Impuesto único........ $127.187");
console.log("  LÍQUIDO............... $3.000.000");
