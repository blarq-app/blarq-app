// Regenera el archivo Previred de mayo 2026 con las correcciones (ISL, 0,1%,
// subsidio joven) y verifica los campos clave. READ-ONLY contra la base viva.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getPlanillaPreviredMes } from "../src/lib/contabilidad/remuneraciones";
import { generarArchivoPrevired } from "../src/lib/contabilidad/previredArchivo";
import { writeFileSync } from "fs";

const year = 2026, month = 5;
const MUTUAL = "00"; // ISL

async function main() {
  const planilla = await getPlanillaPreviredMes(year, month);
  if (!planilla) throw new Error("sin planilla mayo");
  const empleados = await prisma.empleado.findMany({ where: { activo: true } });

  const items = planilla.empleados.map((cot) => {
    const e = empleados.find((x) => x.rut === cot.rut)!;
    return {
      emp: {
        rut: e.rut, sexo: e.sexo, apellidoPaterno: e.apellidoPaterno,
        apellidoMaterno: e.apellidoMaterno, nombres: e.nombres, afpNombre: e.afpNombre,
        isapreCodigo: e.isapreCodigo, isapreFun: e.isapreFun, isaprePlanUF: e.isaprePlanUF,
      },
      cot,
    };
  });

  const contenido = generarArchivoPrevired(items, { year, month, mutualCodigo: MUTUAL });
  const out = "/Users/mjblanco/Desktop/previred-may-2026.txt";
  writeFileSync(out, contenido);
  console.log("Archivo regenerado:", out, "\n");

  // Verificación de campos clave por línea
  const lineas = contenido.trim().split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const c = lineas[i].split(";");
    const g = (n: number) => c[n - 1];
    const cot = items[i].cot;
    console.log(`=== Línea ${i + 1}: ${cot.nombre} (${c.length} campos) ===`);
    console.log(`  c25 Subsidio Joven:        "${g(25)}"  (esperado N)`);
    console.log(`  c27 Imponible AFP:         ${g(27)}`);
    console.log(`  c28 Cotiz oblig AFP+0,1%:  ${g(28)}  (afpTrab ${cot.afpTrabajador} + 0,1% ${cot.afpEmpleador} = ${cot.afpTrabajador + cot.afpEmpleador})`);
    console.log(`  c64 Renta imponible ISL:   ${g(64)}  (esperado = imponible)`);
    console.log(`  c71 Acc. Trabajo ISL:      ${g(71)}  (esperado mutual ${cot.mutual})`);
    console.log(`  c96 Código Mutual:         "${g(96)}"  (esperado 00)`);
    console.log(`  c97 Renta imp Mutual:      ${g(97)}  (esperado 0)`);
    console.log(`  c98 Acc. Trabajo Mutual:   ${g(98)}  (esperado 0)`);
    console.log(`  c94 Seguro Social 0,9%:    ${g(94)}`);
    console.log(`  c80/81 Salud 7%/adic:      ${g(80)} / ${g(81)}`);
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
