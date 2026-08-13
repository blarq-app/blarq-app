/**
 * Backfill del pendiente 155: darle a cada versión de presupuesto YA EXISTENTE
 * su propia lista de condiciones.
 *
 * Se rellena con la plantilla del tipo, que es exactamente el texto fijo que
 * esa cotización venía imprimiendo — o sea, el PDF de una cotización vieja
 * sale idéntico a antes. Lo único que cambia es que ahora el texto se puede
 * ver y editar.
 *
 * Efecto colateral buscado: las notas internas que vivían en `observations`
 * ("Importado desde Excel V7…") DEJAN de imprimirse en muebles y artefactos,
 * donde se estaban colando al PDF del cliente. Y las cotizaciones donde
 * alguien tipeó las condiciones a mano dejan de salir duplicadas.
 *
 *   npx tsx scripts/backfill-condiciones.ts            → dry-run (base de .env)
 *   npx tsx scripts/backfill-condiciones.ts --apply
 *   npx tsx scripts/backfill-condiciones.ts --apply --env .env.prod
 */
import { config } from "dotenv";

const args = process.argv.slice(2);
const APLICAR = args.includes("--apply");
const envIdx = args.indexOf("--env");
const envPath = envIdx >= 0 ? args[envIdx + 1] : ".env";
config({ path: envPath, override: true });

import { PrismaClient, type Prisma } from "@prisma/client";
import {
  CONDICIONES_SEMILLA,
  esTipoCondiciones,
  parseCondiciones,
  type Condicion,
} from "../src/lib/presupuesto/condiciones";

const prisma = new PrismaClient();

async function plantilla(type: "obra" | "muebles" | "artefactos"): Promise<Condicion[]> {
  const fila = await prisma.conditionTemplate.findUnique({ where: { type } });
  const guardadas = fila ? parseCondiciones(fila.items) : null;
  if (guardadas?.length) return guardadas;
  const semilla = CONDICIONES_SEMILLA[type];
  if (APLICAR) {
    await prisma.conditionTemplate.upsert({
      where: { type },
      create: { type, items: semilla as unknown as Prisma.InputJsonValue },
      update: { items: semilla as unknown as Prisma.InputJsonValue },
    });
  }
  return semilla;
}

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`env: ${envPath}`);
  console.log(`host: ${host}`);
  console.log(APLICAR ? "modo: APLICAR\n" : "modo: dry-run (no escribe)\n");

  const versiones = await prisma.budgetVersion.findMany({
    select: {
      id: true,
      type: true,
      version: true,
      status: true,
      conditions: true,
      observations: true,
      project: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let rellenadas = 0;
  let yaTenian = 0;
  let sinTipo = 0;
  const conNotaVieja: string[] = [];

  for (const v of versiones) {
    const rotulo = `${v.project?.name} · ${v.type} ${v.version} (${v.status})`;
    if (parseCondiciones(v.conditions)) {
      yaTenian++;
      continue;
    }
    if (!esTipoCondiciones(v.type)) {
      sinTipo++;
      console.log(`! tipo desconocido: ${rotulo}`);
      continue;
    }
    const items = await plantilla(v.type);
    if (v.observations?.trim()) conNotaVieja.push(rotulo);
    if (APLICAR) {
      await prisma.budgetVersion.update({
        where: { id: v.id },
        data: { conditions: items as unknown as Prisma.InputJsonValue },
      });
    }
    rellenadas++;
    console.log(`+ ${rotulo} → ${items.length} condiciones`);
  }

  console.log("\n─────────────");
  console.log(`versiones: ${versiones.length}`);
  console.log(`rellenadas: ${rellenadas}`);
  console.log(`ya tenían: ${yaTenian}`);
  if (sinTipo) console.log(`tipo desconocido: ${sinTipo}`);
  console.log(
    `\nde las rellenadas, ${conNotaVieja.length} tenían texto viejo en observations` +
      " (queda guardado en la base pero ya no se imprime):"
  );
  for (const r of conNotaVieja) console.log(`  · ${r}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
