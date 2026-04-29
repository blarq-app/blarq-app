// Backfill 2026-04-28: introduce numeroCotizacion / numeroProyecto a los
// 9 proyectos existentes, limpia el prefijo NN_ del name, separa BLARQ
// como interno, renombra Lefevre, y siembra cotizaciones de prueba.
//
// Idempotente: no re-asigna números si ya existen.
//
// Uso: npx tsx scripts/backfill-correlativos.ts [--apply]

import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

// Mapa: nombre actual en DB → cómo debe quedar
const PLAN: Array<{
  matchName: string;
  newName: string;
  newClientName?: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
  isInternal: boolean;
}> = [
  { matchName: "46_Ampliacion Casa Arrau", newName: "Ampliacion Casa Arrau", numeroProyecto: 46, numeroCotizacion: 1, isInternal: false },
  { matchName: "54_Francisco de Aguirre", newName: "Francisco de Aguirre", numeroProyecto: 54, numeroCotizacion: 2, isInternal: false },
  { matchName: "57_Quincho La Llaveria", newName: "Quincho La Llaveria", numeroProyecto: 57, numeroCotizacion: 3, isInternal: false },
  { matchName: "58_Ana Maria Didyk", newName: "Ana Maria Didyk", numeroProyecto: 58, numeroCotizacion: 4, isInternal: false },
  { matchName: "59_Cocina Farellones", newName: "Cocina Farellones", numeroProyecto: 59, numeroCotizacion: 5, isInternal: false },
  { matchName: "60_Portofino", newName: "Portofino", numeroProyecto: 60, numeroCotizacion: 6, isInternal: false },
  { matchName: "62_Rosas", newName: "Rosas", numeroProyecto: 62, numeroCotizacion: 7, isInternal: false },
  { matchName: "Remodelacion Depto Cristian Lefevre", newName: "Lefevre", newClientName: "Cristian Lefevre", numeroProyecto: 63, numeroCotizacion: 8, isInternal: false },
  { matchName: "00_BLARQ", newName: "BLARQ", newClientName: "Gastos empresa", numeroProyecto: null, numeroCotizacion: null, isInternal: true },
];

// Cotizaciones de prueba para que /cotizaciones tenga data al armar la vista.
// Numeración: el siguiente correlativo después de los 9 reales.
const COTIZACIONES_PRUEBA: Array<{
  numeroCotizacion: number;
  name: string;
  clientName: string;
  status: "cotizacion" | "archivado";
  daysAgo: number;
  notes?: string;
}> = [
  { numeroCotizacion: 10, name: "Casa Vitacura", clientName: "Familia Pérez", status: "cotizacion", daysAgo: 0 },
  { numeroCotizacion: 11, name: "Cocina Las Condes", clientName: "Sra. Martínez", status: "cotizacion", daysAgo: 3 },
  { numeroCotizacion: 12, name: "Quincho Reñaca", clientName: "A. Soto", status: "cotizacion", daysAgo: 8 },
  { numeroCotizacion: 13, name: "Casa El Monte", clientName: "Hidalgo / Veloso", status: "archivado", daysAgo: 35, notes: "El cliente se decidió por otra constructora." },
  { numeroCotizacion: 14, name: "Loft Bellavista", clientName: "M. Núñez", status: "archivado", daysAgo: 60, notes: "Postergado por el cliente." },
];

async function main() {
  console.log(APPLY ? "🚀 APPLY mode\n" : "🔍 DRY RUN\n");

  // 1) Backfill proyectos existentes
  for (const p of PLAN) {
    const existing = await prisma.project.findFirst({ where: { name: p.matchName } });
    if (!existing) {
      console.log(`  ⚠ no encontrado: ${p.matchName}`);
      continue;
    }
    const data: Record<string, unknown> = {
      name: p.newName,
      numeroProyecto: p.numeroProyecto,
      numeroCotizacion: p.numeroCotizacion,
      isInternal: p.isInternal,
    };
    if (p.newClientName) data.clientName = p.newClientName;

    console.log(`  ${APPLY ? "✓" : "+"} ${p.matchName}  →  ${p.newName} ` +
      `(P=${p.numeroProyecto ?? "—"}, C=${p.numeroCotizacion ?? "—"}${p.isInternal ? ", interno" : ""})`);

    if (APPLY) {
      await prisma.project.update({ where: { id: existing.id }, data });
    }
  }

  // 2) Sembrar cotizaciones de prueba
  console.log("");
  for (const q of COTIZACIONES_PRUEBA) {
    const exists = await prisma.project.findUnique({
      where: { numeroCotizacion: q.numeroCotizacion },
    });
    if (exists) {
      console.log(`  · cotización C-${q.numeroCotizacion} ya existe, skip`);
      continue;
    }
    console.log(`  ${APPLY ? "✓" : "+"} cotización C-${q.numeroCotizacion} — ${q.name} (${q.status})`);

    if (APPLY) {
      const createdAt = new Date(Date.now() - q.daysAgo * 24 * 60 * 60 * 1000);
      await prisma.project.create({
        data: {
          name: q.name,
          clientName: q.clientName,
          status: q.status,
          numeroCotizacion: q.numeroCotizacion,
          numeroProyecto: null,
          isInternal: false,
          notes: q.notes,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }
  }

  console.log(`\n${APPLY ? "✓ Listo" : "(dry-run, nada modificado)"}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
