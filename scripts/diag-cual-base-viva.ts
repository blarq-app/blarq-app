// Diagnóstico SOLO LECTURA: identificar cuál base (host Neon) coincide con la app en vivo.
// Uso: npx tsx scripts/diag-cual-base-viva.ts <ruta-env>
// Lee DATABASE_URL del archivo dado, se conecta y reporta marcadores. No escribe nada.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  const total = await prisma.project.count();
  console.log("Proyectos totales:", total);
  for (const n of [60, 63, 64]) {
    const p = await prisma.project.findFirst({
      where: { numeroProyecto: n },
      select: { name: true, clientName: true },
    });
    console.log(`  #${n}: ${p ? `${p.name} / ${p.clientName ?? "-"}` : "(no existe)"}`);
  }
  const cruz = await prisma.project.count({
    where: { name: { contains: "Cruz del Sur", mode: "insensitive" } },
  });
  console.log("  ¿'Cruz del Sur'?:", cruz);
  const last = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true },
  });
  console.log("  Última factura:", last?.issueDate?.toISOString().slice(0, 10) ?? "-");
}
main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
