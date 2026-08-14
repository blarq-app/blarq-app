// Diagnóstico SOLO LECTURA: ¿alcanza (fecha + monto) para identificar sin
// ambigüedad un traspaso interno Operativa→Sueldos?
//
// Es la pregunta que decide el diseño del bot de traspasos: cuando MJ manda
// la foto del comprobante, el único dato duro que trae el papel es la fecha y
// el monto. Si dos traspasos del mismo día tuvieran el mismo monto, no
// podríamos elegir solos.
//
// Uso: npx tsx scripts/diag-traspasos-sueldos-match.ts <ruta-env>
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
  console.log("=== HOST:", host, "===");
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador #64:", p64?.name ?? "(no existe)");

  const cuentas = await prisma.bankAccount.findMany({
    select: { id: true, alias: true, role: true, accountNumber: true },
  });
  console.log("\nCuentas:");
  for (const c of cuentas) {
    console.log(`  ${c.alias} | role=${c.role} | ${c.accountNumber}`);
  }

  const movs = await prisma.bankMovement.findMany({
    where: { category: "transfer_interno" },
    select: {
      id: true,
      date: true,
      amount: true,
      projectId: true,
      internalConcepto: true,
      internalTransferToId: true,
      bankAccount: { select: { alias: true, role: true } },
    },
    orderBy: { date: "desc" },
  });
  console.log(`\nMovimientos transfer_interno: ${movs.length}`);

  const aSueldos = movs.filter(
    (x) => x.bankAccount.role === "salary_fund" && x.amount > 0
  );
  console.log(`  lado que ENTRA a Sueldos (amount>0): ${aSueldos.length}`);
  console.log(
    `  con obra puesta: ${aSueldos.filter((x) => x.projectId).length} | con concepto: ${aSueldos.filter((x) => x.internalConcepto).length}`
  );

  // ¿Hay dos del mismo día con el mismo monto? Esa es la colisión que rompería
  // el match del bot.
  const porClave = new Map<string, number>();
  for (const x of aSueldos) {
    const k = `${x.date.toISOString().slice(0, 10)}|${Math.round(Math.abs(x.amount))}`;
    porClave.set(k, (porClave.get(k) ?? 0) + 1);
  }
  const colisiones = [...porClave.entries()].filter(([, n]) => n > 1);
  console.log(`\nColisiones (misma fecha + mismo monto): ${colisiones.length}`);
  for (const [k, n] of colisiones) console.log(`  ${k} → ${n}`);

  // Con ventana de ±1 día (tolerancia por si el comprobante quedó fechado el
  // día anterior/siguiente al que el banco registró el movimiento).
  let colisiones1d = 0;
  for (const a of aSueldos) {
    const otros = aSueldos.filter(
      (b) =>
        b.id !== a.id &&
        Math.round(Math.abs(b.amount)) === Math.round(Math.abs(a.amount)) &&
        Math.abs(b.date.getTime() - a.date.getTime()) <= 24 * 3600 * 1000
    );
    if (otros.length > 0) colisiones1d++;
  }
  console.log(`Movimientos con algún gemelo a ±1 día: ${colisiones1d}`);

  console.log("\nÚltimos 10 traspasos que entran a Sueldos:");
  for (const x of aSueldos.slice(0, 10)) {
    console.log(
      `  ${x.date.toISOString()} | $${Math.round(x.amount).toLocaleString("es-CL")} | obra=${x.projectId ? "sí" : "—"} | concepto=${x.internalConcepto ?? "—"} | par=${x.internalTransferToId ? "sí" : "NO"}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
