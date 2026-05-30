// Crea 2 reembolsadores confirmados por MJ (2026-05-30):
//   - Alejandro Henríquez → Comercializadora Angélica Sepúlveda Narváez
//   - Carlos Patricio      → Climair (Mantención y Comercialización Climatización)
// La persona transfiere desde el banco y la factura la emite su empresa.
//
// Idempotente: si ya existe un reembolsador con ese personRut, no lo duplica.
// Dry-run por defecto. Escribe con --apply.
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" \
//     npx tsx scripts/crear-reembolsadores-alejandro-carlos.ts [--apply]

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const NUEVOS = [
  {
    nombre: "Alejandro Henriquez",
    glosa: "alejandro henr",          // substring (case-insensitive) de BankMovement.description
    personRut: "0115883569",          // formato banco (counterpartyRut)
    aliases: [{ rut: "77079209-6", businessName: "Comercializadora Angelica Sepulveda" }],
  },
  {
    nombre: "Carlos Patricio",
    glosa: "carlos patrici",
    personRut: "0101727432",
    aliases: [{ rut: "77500604-8", businessName: "Climair (Mantencion Climatizacion)" }],
  },
];

async function main() {
  console.log(`Host: ${(process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—"}`);
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  for (const r of NUEVOS) {
    const existe = await prisma.reembolsador.findFirst({ where: { personRut: r.personRut } });
    if (existe) {
      console.log(`• ${r.nombre}: ya existe (id ${existe.id}) — OMITIDO`);
      continue;
    }
    console.log(`• ${r.nombre} | personRut ${r.personRut} | glosa "${r.glosa}"`);
    console.log(`    alias: ${r.aliases.map((a) => `${a.rut} (${a.businessName})`).join(", ")}`);
    if (APPLY) {
      await prisma.reembolsador.create({
        data: {
          nombre: r.nombre,
          glosa: r.glosa,
          personRut: r.personRut,
          aliases: { create: r.aliases },
        },
      });
      console.log("    ✓ creado");
    }
  }

  const total = await prisma.reembolsador.count();
  console.log(`\n${APPLY ? "LISTO" : "DRY-RUN"}. Reembolsadores totales: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
