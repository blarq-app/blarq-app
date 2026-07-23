// SOLO LECTURA sobre la base VIVA: trae todos los cargos del banco que parecen
// servicios digitales internacionales (Anthropic/Claude, Neon, CapCut, Google),
// para emparejarlos a mano con los comprobantes de ~/Desktop/BLARQ-Contador.
// No escribe nada. Lee el DATABASE_URL del archivo directo (§4.9) e imprime el host.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/))
  .find(Boolean)![1];
console.log("HOST:", url.match(/@([^/]+)\//)?.[1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const PROVEEDORES = ["anthropic", "claude", "neon", "capcut", "bytedance", "pipopay", "google"];

async function main() {
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log("MARCADOR #64:", p64?.name, p64?.name === "Paseo del Sena" ? "(VIVA ✓)\n" : "(¿VIEJA?)\n");

  const movs = await prisma.bankMovement.findMany({
    where: {
      amount: { lt: 0 },
      OR: PROVEEDORES.flatMap((p) => [
        { description: { contains: p, mode: "insensitive" as const } },
        { counterpartyName: { contains: p, mode: "insensitive" as const } },
      ]),
    },
    select: {
      id: true,
      date: true,
      description: true,
      counterpartyName: true,
      amount: true,
      category: true,
      status: true,
      payments: { select: { invoice: { select: { origin: true, attachmentUrl: true } } } },
    },
    orderBy: { date: "asc" },
  });

  console.log(`${movs.length} cargos candidatos:\n`);
  for (const m of movs) {
    const nombre = (m.counterpartyName ?? m.description).slice(0, 34).padEnd(36);
    const yaGasto = m.payments.some((p) => p.invoice?.origin?.startsWith("gasto"));
    const conFoto = m.payments.some((p) => p.invoice?.attachmentUrl);
    console.log(
      `${m.date.toISOString().slice(0, 10)}  $${Math.abs(m.amount).toLocaleString("es-CL").padStart(9)}  ${nombre} ${m.status.padEnd(12)} ${yaGasto ? "YA-REGISTRADO" : ""}${conFoto ? " con-foto" : ""}`
    );
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
