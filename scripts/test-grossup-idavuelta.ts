// Prueba de ida-y-vuelta del gross-up (líquido → imponible → líquido) con
// empleados REALES de la base viva. SOLO LECTURA: no escribe nada.
//
// Para cada empleado toma su liquidación actual (con el sueldo estándar) y
// además un par de líquidos objetivo redondos. De cada líquido objetivo:
//   1) gross-up → imponible (base+bono a guardar);
//   2) liquidación de ese imponible → líquido resultante;
//   3) confirma que el líquido resultante == objetivo (tolerancia $1).
//
// Uso: npx tsx scripts/test-grossup-idavuelta.ts <ruta-env>   (ej. .env.prod)
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import {
  computeLiquidacion,
  grossUpFromLiquido,
  type EmpleadoParams,
  type IndicadoresMes,
} from "../src/lib/contabilidad/sueldos";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

let ok = true;

async function main() {
  console.log(`=== ENV: ${envPath} | HOST: ${host} ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name ?? "(no existe)"} (viva = "Paseo del Sena")\n`);

  const empleados = await prisma.empleado.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
  // Mes más reciente con indicadores cargados.
  const indicador = await prisma.indicadorMensual.findFirst({ orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!indicador) {
    console.error("No hay indicadores cargados.");
    process.exit(1);
  }
  const ind: IndicadoresMes = {
    uf: indicador.uf,
    utm: indicador.utm,
    gratificacionTopeMensual: indicador.gratificacionTopeMensual,
    topeImponibleSaludUF: indicador.topeImponibleSaludUF,
  };
  console.log(`Indicadores usados: ${indicador.year}-${String(indicador.month).padStart(2, "0")} (UF ${ind.uf}, UTM ${ind.utm})\n`);

  for (const e of empleados) {
    const emp: EmpleadoParams = {
      nombre: e.nombre,
      rut: e.rut,
      sueldoBase: e.sueldoBase,
      colacion: e.colacion,
      movilizacion: e.movilizacion,
      afpComisionRate: e.afpComisionRate,
      isaprePlanUF: e.isaprePlanUF,
    };
    const liqActual = computeLiquidacion(emp, ind);
    console.log(`── ${e.nombre} ──`);
    console.log(`   Hoy: imponible ${fmt(liqActual.totalImponible)} (base ${fmt(e.sueldoBase)}) → líquido ${fmt(liqActual.liquido)}`);

    // Objetivos: el líquido real de hoy + dos redondos alrededor.
    const objetivos = [
      liqActual.liquido,
      Math.round(liqActual.liquido / 100000) * 100000,
      1_500_000,
    ];
    for (const objetivo of [...new Set(objetivos)].filter((x) => x > 0)) {
      const { sueldoBase, liquidacion } = grossUpFromLiquido(emp, ind, objetivo);
      const diff = liquidacion.liquido - objetivo;
      const cuadra = Math.abs(diff) <= 1;
      if (!cuadra) ok = false;
      console.log(
        `   Líquido objetivo ${fmt(objetivo)} → imponible ${fmt(liquidacion.totalImponible)} (base ${fmt(sueldoBase)}) → líquido ${fmt(liquidacion.liquido)}  ${cuadra ? "✓" : `✗ (dif ${diff})`}`
      );
    }
    console.log("");
  }

  console.log(ok ? "IDA-Y-VUELTA CUADRA ✓" : "HAY DIFERENCIAS ✗");
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
