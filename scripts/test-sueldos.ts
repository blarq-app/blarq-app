// Regresión del motor de liquidaciones (src/lib/contabilidad/sueldos.ts).
// Valida al peso contra las liquidaciones REALES de BLARQ de mayo 2026.
// No toca base de datos — es cálculo puro.
import {
  computeLiquidacion,
  type EmpleadoParams,
  type IndicadoresMes,
} from "../src/lib/contabilidad/sueldos";

const IND_2026_05: IndicadoresMes = {
  uf: 40610.69,
  utm: 70588,
  gratificacionTopeMensual: 213354,
  topeImponibleSaludUF: 90,
};

const JT: EmpleadoParams = {
  nombre: "José Tomás Larraín",
  rut: "18.022.887-K",
  sueldoBase: 1924126,
  colacion: 150000,
  movilizacion: 150000,
  afpComisionRate: 0.0116,
  isaprePlanUF: 3.864,
};

const MJ: EmpleadoParams = {
  nombre: "María José Blanco",
  rut: "18.023.983-9",
  sueldoBase: 2389125,
  colacion: 150000,
  movilizacion: 150000,
  afpComisionRate: 0.0116,
  isaprePlanUF: 13.868,
};

// Valores reales de las liquidaciones (campo -> esperado).
const ESPERADO: Record<string, Record<string, number>> = {
  "José Tomás Larraín": {
    gratificacion: 213354,
    totalImponible: 2137480,
    totalAfp: 238543,
    saludLegal: 149624,
    totalSalud: 156920,
    cesantia: 12825,
    baseImpuesto: 1729192,
    impuestoUnico: 31050,
    liquido: 1998142,
  },
  "María José Blanco": {
    gratificacion: 213354,
    totalImponible: 2602479,
    totalAfp: 290437,
    saludLegal: 182174,
    totalSalud: 563189,
    cesantia: 15615,
    baseImpuesto: 2040580,
    impuestoUnico: 43506,
    liquido: 1989732,
  },
};

const fmt = (n: number) => n.toLocaleString("es-CL");
let fallos = 0;

for (const emp of [JT, MJ]) {
  const liq = computeLiquidacion(emp, IND_2026_05);
  const esp = ESPERADO[emp.nombre];
  console.log(`\n==== ${emp.nombre} (mayo 2026) ====`);
  for (const [campo, valEsp] of Object.entries(esp)) {
    const got = (liq as unknown as Record<string, number>)[campo];
    const ok = got === valEsp;
    if (!ok) fallos++;
    console.log(
      `  ${ok ? "OK " : "DIF"}  ${campo.padEnd(16)} motor=${fmt(got).padStart(12)}  real=${fmt(valEsp).padStart(12)}${ok ? "" : `  (dif ${fmt(got - valEsp)})`}`
    );
  }
}

const cod048 =
  computeLiquidacion(JT, IND_2026_05).impuestoUnico +
  computeLiquidacion(MJ, IND_2026_05).impuestoUnico;
console.log(`\n==== Código 048 del F29 (impuesto único del mes) ====`);
const ok048 = cod048 === 74556;
if (!ok048) fallos++;
console.log(
  `  ${ok048 ? "OK " : "DIF"}  suma impuesto único  motor=${fmt(cod048)}  real(F29 mayo)=74.556`
);

console.log(`\n${fallos === 0 ? "TODO OK — motor valida al peso" : `${fallos} DIFERENCIAS`}`);
process.exit(fallos === 0 ? 0 : 1);
