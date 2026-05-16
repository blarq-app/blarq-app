/**
 * Carga las 3 transferencias de Carolina Ovalle que el importador viejo
 * descartó como "duplicados" (eran transferencias reales del mismo monto
 * el mismo día). Bug detectado 2026-05-16.
 *
 * Las 3 faltantes (todas $5.000.000 ingreso):
 *   - 2026-02-16  · pareja del id_pago Maxxa 19083521 / 19083519
 *   - 2026-03-16  · pareja del id_pago Maxxa 19237248 / 19237245
 *   - 2026-05-13  · pendiente en Maxxa, sin id_pago
 *
 * Estrategia: para cada fecha, contamos cuántos movimientos de $5.000.000
 * hay hoy en la app. El Excel de cartola tiene 2 por fecha. Insertamos
 * los que falten para llegar a 2. El externalRef de los nuevos se marca
 * "maxxa-recovery:<fecha>" para que sean distinguibles y el import futuro
 * no los vuelva a tocar.
 *
 * Dry-run por defecto, --apply para escribir.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

// Las 3 fechas donde falta una transferencia de $5.000.000.
const FALTANTES = [
  { fecha: "2026-02-16", descripcion: "0105112904 Transf. Maria Carolina" },
  { fecha: "2026-03-16", descripcion: "0105112904 Transf. MARIA CAROLINA" },
  { fecha: "2026-05-13", descripcion: "0105112904 Transf. Maria Ovalle Al" },
];
const MONTO = 5000000;

async function main() {
  // Identificar la cuenta bancaria a partir de un movimiento existente de
  // Carolina (todos están en la misma cuenta operativa).
  const sample = await prisma.bankMovement.findFirst({
    where: {
      OR: [
        { description: { contains: "carolina", mode: "insensitive" } },
        { description: { contains: "ovalle", mode: "insensitive" } },
      ],
    },
    select: { bankAccountId: true },
  });
  if (!sample) throw new Error("No se encontró ningún movimiento de Carolina");
  const bankAccountId = sample.bankAccountId;
  console.log(`Cuenta bancaria: ${bankAccountId}\n`);

  for (const f of FALTANTES) {
    const dayStart = new Date(f.fecha + "T00:00:00.000Z");
    const dayEnd = new Date(f.fecha + "T23:59:59.999Z");
    const existentes = await prisma.bankMovement.findMany({
      where: {
        bankAccountId,
        amount: MONTO,
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true, externalRef: true, description: true },
    });
    const faltan = 2 - existentes.length;
    console.log(
      `${f.fecha} · $${MONTO.toLocaleString("es-CL")} · en app: ${existentes.length} · faltan: ${faltan < 0 ? 0 : faltan}`
    );
    if (faltan <= 0) continue;

    for (let i = 0; i < faltan; i++) {
      const externalRef = `maxxa-recovery:${f.fecha}:${i + 1}`;
      if (!APPLY) {
        console.log(
          `  (dry-run) crearía: ${f.fecha} $${MONTO} "${f.descripcion}" externalRef=${externalRef}`
        );
        continue;
      }
      await prisma.bankMovement.create({
        data: {
          bankAccountId,
          date: new Date(f.fecha + "T12:00:00.000Z"),
          description: f.descripcion,
          amount: MONTO,
          type: "abono",
          externalRef,
          counterpartyName: "Maria Carolina Ovalle Aldunate",
          counterpartyRut: null,
          status: "sin_asignar",
        },
      });
      console.log(`  creado: ${f.fecha} $${MONTO} externalRef=${externalRef}`);
    }
  }

  if (!APPLY) console.log("\n(dry-run. Para escribir, correr con --apply)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
