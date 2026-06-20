import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Diagnóstico SOLO LECTURA: ¿cuántos movimientos están imputados "sueldo"
// y cuántos de esos van hacia un socio (MJ / JT)? No modifica nada.
// Uso: DATABASE_URL=... npx tsx scripts/diag-sueldo-socios.ts

const prisma = new PrismaClient();

const SOCIO_RUTS = ["18022887", "18023983"]; // JT y MJ
const SOCIO_NOMBRES = ["jose tomas lar", "maria jose blanco", "maria jose bla", "jose tomas"];

function esSocio(rut: string | null, nombre: string | null, desc: string | null): boolean {
  const r = (rut ?? "").replace(/\D/g, "");
  if (SOCIO_RUTS.some((s) => r.includes(s))) return true;
  const t = `${nombre ?? ""} ${desc ?? ""}`.toLowerCase();
  return SOCIO_NOMBRES.some((n) => t.includes(n));
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^.]+)/)?.[1] ?? "?";
  console.log(`DB host: ${host}\n`);

  const sueldo = await prisma.bankMovement.findMany({
    where: { category: "sueldo" },
    select: {
      id: true, date: true, amount: true, status: true,
      counterpartyName: true, counterpartyRut: true, description: true,
    },
    orderBy: { date: "desc" },
  });

  const socio = sueldo.filter((m) => esSocio(m.counterpartyRut, m.counterpartyName, m.description));
  const noSocio = sueldo.filter((m) => !esSocio(m.counterpartyRut, m.counterpartyName, m.description));

  const sum = (arr: typeof sueldo) => arr.reduce((s, m) => s + Math.abs(m.amount), 0);
  const byStatus = (arr: typeof sueldo) => {
    const o: Record<string, number> = {};
    for (const m of arr) o[m.status] = (o[m.status] ?? 0) + 1;
    return o;
  };

  console.log(`Total movimientos categoría "sueldo": ${sueldo.length}  ($${sum(sueldo).toLocaleString("es-CL")})`);
  console.log(`  → hacia SOCIO (MJ/JT):   ${socio.length}  ($${sum(socio).toLocaleString("es-CL")})  status: ${JSON.stringify(byStatus(socio))}`);
  console.log(`  → hacia NO-socio:        ${noSocio.length}  ($${sum(noSocio).toLocaleString("es-CL")})  status: ${JSON.stringify(byStatus(noSocio))}`);

  // Desglose de los socio por contraparte
  const porNombre: Record<string, { n: number; monto: number }> = {};
  for (const m of socio) {
    const k = m.counterpartyName ?? m.description.slice(0, 30);
    (porNombre[k] ??= { n: 0, monto: 0 }).n++;
    porNombre[k].monto += Math.abs(m.amount);
  }
  console.log(`\nDesglose socio por contraparte:`);
  for (const [k, v] of Object.entries(porNombre).sort((a, b) => b[1].monto - a[1].monto)) {
    console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(3)} movs   $${v.monto.toLocaleString("es-CL")}`);
  }

  // Cuántas transferencias a socios hay en total (cualquier categoría), para
  // ver cuántas NO están como sueldo (ya re-imputadas o sin categoría).
  const todasSocio = await prisma.bankMovement.count({
    where: {
      type: "cargo",
      OR: [
        { counterpartyRut: { contains: "18022887" } },
        { counterpartyRut: { contains: "18023983" } },
        { counterpartyName: { contains: "Maria Jose", mode: "insensitive" } },
        { counterpartyName: { contains: "Jose Tomas", mode: "insensitive" } },
        { description: { contains: "Maria Jose", mode: "insensitive" } },
        { description: { contains: "Jose Tomas", mode: "insensitive" } },
      ],
    },
  });
  console.log(`\nEgresos hacia MJ/JT en total (cualquier categoría): ${todasSocio}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
