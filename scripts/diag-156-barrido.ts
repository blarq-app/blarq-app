/**
 * Pendiente 156 — SOLO LECTURA. Pasa a GL EN MEMORIA cada partida de obra de
 * la base (sin escribir nada) y cuenta en cuántas el total se conservaría y en
 * cuántas la conversión se negaría. Sirve de barrido de regresión con datos
 * reales: si alguna partida rara movería el total, aparece acá.
 *
 *   npx tsx scripts/diag-156-barrido.ts <ruta-env>
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { pasarAGlobal, lineasGlobalesMultiplicadas } from "../src/lib/presupuesto/partidaGlobal";

const envPath = process.argv[2];
if (!envPath) throw new Error("uso: <ruta-env>");
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) throw new Error("sin DATABASE_URL");
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("host:", url!.match(/ep-[a-z-]+/)?.[0] ?? "local");
  const items = await prisma.obraItem.findMany({
    include: {
      components: true,
      budgetVersion: { select: { status: true, version: true, project: { select: { name: true } } } },
    },
  });
  let ok = 0;
  let cero = 0;
  const malas: string[] = [];
  const conAviso: string[] = [];
  for (const it of items) {
    const r = pasarAGlobal(it, it.components);
    if (r.ok) ok++;
    else if ((it.quantity ?? 0) <= 0) cero++;
    else malas.push(`${it.budgetVersion.project.name} ${it.budgetVersion.version} · ${it.name}: ${r.error}`);
    const gl = lineasGlobalesMultiplicadas(it.quantity, it.components);
    if (gl.length > 0 && ["borrador", "enviado"].includes(it.budgetVersion.status)) {
      conAviso.push(
        `${it.budgetVersion.project.name} ${it.budgetVersion.version} (${it.budgetVersion.status}) · ${it.name} · ${it.quantity} ${it.unit} · ${gl.map((g) => `${g.description} ${g.quantity} GL × $${Math.round(g.unitCost)}`).join(", ")} · total partida $${Math.round(it.total)}`
      );
    }
  }
  console.log(`partidas: ${items.length} · se conserva el total: ${ok} · cantidad 0 (se niega): ${cero} · movería el total: ${malas.length}`);
  for (const m of malas) console.log("  ✗", m);
  console.log(`\nPartidas editables (borrador/enviado) que mostrarían el aviso de línea GL: ${conAviso.length}`);
  for (const a of conAviso) console.log("  ·", a);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
