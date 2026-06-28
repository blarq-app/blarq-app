// Seed de Remuneraciones: empleados de BLARQ (MJ y JT) e indicadores de mayo.
//
// Idempotente (upsert por rut / por año-mes): se puede correr varias veces y
// sirve tanto para la base dev como para el cutover a prod. Los valores salen
// de las constantes históricas de remuneraciones.ts, ya validados al peso
// contra las liquidaciones reales de mayo 2026.
//
// Uso:
//   npx tsx scripts/seed-remuneraciones.ts          (usa .env → dev)
//   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/seed-remuneraciones.ts  (prod)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EMPLEADOS = [
  {
    nombre: "José Tomás Larraín",
    rut: "18.022.887-K",
    sueldoBase: 1924126,
    colacion: 150000,
    movilizacion: 150000,
    afpNombre: "Planvital",
    afpComisionRate: 0.0116,
    isapreNombre: "Colmena",
    isaprePlanUF: 3.864,
  },
  {
    nombre: "María José Blanco",
    rut: "18.023.983-9",
    sueldoBase: 2389125,
    colacion: 150000,
    movilizacion: 150000,
    afpNombre: "Planvital",
    afpComisionRate: 0.0116,
    isapreNombre: "Colmena",
    isaprePlanUF: 13.868,
  },
];

const INDICADORES = [
  {
    year: 2026,
    month: 5,
    uf: 40610.69,
    utm: 70588,
    gratificacionTopeMensual: 213354,
    topeImponibleSaludUF: 90,
  },
];

async function main() {
  const host =
    process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "(desconocido)";
  console.log(`Seed remuneraciones → HOST ${host}`);

  for (const e of EMPLEADOS) {
    await prisma.empleado.upsert({
      where: { rut: e.rut },
      update: e,
      create: e,
    });
    console.log(`  empleado ✓ ${e.nombre}`);
  }

  for (const i of INDICADORES) {
    await prisma.indicadorMensual.upsert({
      where: { year_month: { year: i.year, month: i.month } },
      update: i,
      create: i,
    });
    console.log(`  indicador ✓ ${i.year}-${String(i.month).padStart(2, "0")}`);
  }

  const nEmp = await prisma.empleado.count();
  const nInd = await prisma.indicadorMensual.count();
  console.log(`Listo. Empleados=${nEmp}, Indicadores=${nInd}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
