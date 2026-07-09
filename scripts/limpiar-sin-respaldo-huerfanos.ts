// Limpieza de "pagos sin factura" HUÉRFANOS.
//
// Contexto: la acción masiva "pago sin factura" crea un Invoice sintético
// (origin "sin_respaldo", folio SR-…, tipoDoc 1043) + un InvoicePayment que
// lo cuelga del movimiento del banco. Al desconciliar por "Editar" (PATCH
// individual) —antes del fix de esta rama— solo se borraba el InvoicePayment,
// dejando el Invoice sin_respaldo sin ningún pago y sin movimiento: un gasto
// fantasma que igual sumaba al "gastado" del proyecto.
//
// Este script encuentra esos huérfanos (origin "sin_respaldo" y CERO
// InvoicePayment) y, con confirmación, los borra. Por default SOLO LISTA.
//
// Uso:
//   LISTAR  (no escribe): npx tsx scripts/limpiar-sin-respaldo-huerfanos.ts <ruta-env>
//   BORRAR:               npx tsx scripts/limpiar-sin-respaldo-huerfanos.ts <ruta-env> --apply
//
// La base VIVA es ep-shy-morning (hoy en .env.prod). Anclá en el HOST que
// imprime el script, NO en el nombre del archivo (§4.9). Confirmá el HOST
// antes de correr con --apply.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const apply = process.argv.includes("--apply");

if (!envPath) {
  console.error("Falta la ruta del env. Uso: npx tsx scripts/limpiar-sin-respaldo-huerfanos.ts <ruta-env> [--apply]");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  console.log(apply ? "MODO: BORRAR (--apply)\n" : "MODO: LISTAR (sin escribir)\n");

  // Marcador de base viva para que quede en el log (§4.9).
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Marcador base: #64 = ${p64?.name ?? "(no existe)"} (viva esperada: "Paseo del Sena")\n`);

  // Huérfanos: origin "sin_respaldo" y sin NINGÚN InvoicePayment. Mismo
  // criterio que borra el código (bulk/route.ts:179 y el PATCH individual).
  const huerfanos = await prisma.invoice.findMany({
    where: { origin: "sin_respaldo", payments: { none: {} } },
    select: {
      id: true,
      folioNumber: true,
      totalAmount: true,
      issueDate: true,
      businessName: true,
      project: { select: { numeroProyecto: true, name: true } },
      category: { select: { name: true } },
    },
    orderBy: { issueDate: "asc" },
  });

  // Info: 1043 huérfanos que NO tienen origin "sin_respaldo" (no los toca este
  // script — el código solo limpia origin "sin_respaldo"). Solo para visibilidad.
  const otros1043 = await prisma.invoice.count({
    where: { tipoDoc: 1043, origin: { not: "sin_respaldo" }, payments: { none: {} } },
  });

  console.log(`Huérfanos sin_respaldo (a borrar): ${huerfanos.length}`);
  if (otros1043 > 0) {
    console.log(`(Info: ${otros1043} tipoDoc 1043 huérfanos con OTRO origin — NO se tocan)`);
  }
  console.log("");

  if (huerfanos.length === 0) {
    console.log("Nada que limpiar. ✓");
    return;
  }

  // Detalle + gastado por proyecto afectado antes/después.
  const totalMonto = huerfanos.reduce((s, h) => s + h.totalAmount, 0);
  const porProyecto = new Map<string, { name: string; count: number; monto: number }>();
  for (const h of huerfanos) {
    const key = h.project ? `${h.project.numeroProyecto ?? "?"} · ${h.project.name}` : "(sin proyecto)";
    const cur = porProyecto.get(key) ?? { name: key, count: 0, monto: 0 };
    cur.count++;
    cur.monto += h.totalAmount;
    porProyecto.set(key, cur);
  }

  console.log("── Detalle de los huérfanos ──");
  for (const h of huerfanos) {
    const proy = h.project ? `${h.project.numeroProyecto ?? "?"} · ${h.project.name}` : "(sin proyecto)";
    console.log(
      `  F-${h.folioNumber ?? "—"} | ${fmt(h.totalAmount)} | ${h.issueDate.toISOString().slice(0, 10)} | ${h.businessName ?? "—"} | proy: ${proy} | cat: ${h.category?.name ?? "—"}`
    );
  }
  console.log(`\n  TOTAL: ${huerfanos.length} facturas · ${fmt(totalMonto)}\n`);

  console.log("── Impacto en 'gastado' por proyecto (lo que baja al borrar) ──");
  for (const [, v] of porProyecto) {
    console.log(`  ${v.name}: -${fmt(v.monto)}  (${v.count} ${v.count === 1 ? "factura" : "facturas"})`);
  }
  console.log("");

  if (!apply) {
    console.log("Esto fue solo LISTAR. Para borrar, volvé a correr con --apply (tras OK de MJ).");
    return;
  }

  // BORRAR. Re-chequeo defensivo por factura: que siga sin pagos justo antes
  // de borrar (por si algo cambió entre el listado y el apply).
  let borrados = 0;
  for (const h of huerfanos) {
    const pays = await prisma.invoicePayment.count({ where: { invoiceId: h.id } });
    if (pays > 0) {
      console.log(`  SALTO F-${h.folioNumber}: ahora tiene ${pays} pago(s), ya no es huérfano.`);
      continue;
    }
    await prisma.invoice.delete({ where: { id: h.id } });
    borrados++;
  }
  console.log(`\n✓ Borrados ${borrados} de ${huerfanos.length} huérfanos.`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
