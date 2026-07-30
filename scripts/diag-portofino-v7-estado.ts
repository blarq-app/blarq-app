/**
 * Diagnóstico previo a cargar el presupuesto de obra Portofino V7 (proyecto #60).
 *
 * OJO: NO usa dotenv. Lee el DATABASE_URL directo de `.env.prod` y lo pasa como
 * datasource explícito, porque `prisma` auto-carga `.env` (la base VIEJA
 * ep-solitary-mud) y ya nos hizo sacar conclusiones equivocadas antes (§4.9).
 * Imprime el HOST y el marcador (#64 = "Paseo del Sena") para que quede probado
 * en la salida contra qué base se leyó.
 *
 * Solo LEE. No escribe nada.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";

function leerDatabaseUrl(ruta: string): string {
  const txt = readFileSync(ruta, "utf8");
  for (const linea of txt.split("\n")) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const [k, ...resto] = l.split("=");
    if (k.trim() === "DATABASE_URL") {
      return resto.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error(`No encontré DATABASE_URL en ${ruta}`);
}

const url = leerDatabaseUrl(ENV_PROD);
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("HOST:", host);
  console.log("¿ES LA VIVA (ep-shy-morning)?:", host.includes("ep-shy-morning") ? "SÍ" : "NO — PARAR");

  const marcador = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { numeroProyecto: true, name: true },
  });
  console.log("MARCADOR #64:", marcador?.name ?? "(no existe)");

  const ultimaFactura = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true, businessName: true },
  });
  console.log(
    "ÚLTIMA FACTURA:",
    ultimaFactura?.issueDate?.toISOString().slice(0, 10),
    "—",
    ultimaFactura?.businessName
  );

  console.log("\n=== PROYECTO #60 ===");
  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 60 },
    include: {
      budgetVersions: {
        include: {
          _count: { select: { obraItems: true, muebleItems: true, artefactoItems: true } },
          obraChapters: { orderBy: { sortOrder: "asc" } },
          paymentTerms: true,
        },
        orderBy: [{ type: "asc" }, { version: "asc" }],
      },
      estadosPago: {
        select: { id: true, number: true, status: true, maestroId: true, budgetVersionId: true },
        orderBy: { number: "asc" },
      },
    },
  });
  if (!p) throw new Error("No existe proyecto #60 en esta base");
  console.log(`#${p.numeroProyecto} ${p.name} — status=${p.status} id=${p.id}`);

  for (const v of p.budgetVersions) {
    console.log(
      `  [${v.type}] ${v.version} status=${v.status} gg=${v.ggPercentage} util=${v.utilityPercentage} dcto=${v.discountPercentage} ` +
        `obra=${v._count.obraItems} muebles=${v._count.muebleItems} artef=${v._count.artefactoItems} caps=${v.obraChapters.length} ` +
        `enviado=${v.sentAt ? v.sentAt.toISOString().slice(0, 10) : "no"} id=${v.id}`
    );
    if (v.obraChapters.length) {
      console.log("      caps:", v.obraChapters.map((c) => `${c.sortOrder}:${c.name}`).join(" | "));
    }
    if (v.paymentTerms.length) {
      console.log("      pagos:", v.paymentTerms.map((t) => `${t.stage} ${t.percentage}%`).join(" | "));
    }
  }

  console.log("\n=== ESTADOS DE PAGO del #60 ===");
  for (const ep of p.estadosPago) {
    console.log(`  EP ${ep.number} status=${ep.status} maestro=${ep.maestroId ?? "-"} version=${ep.budgetVersionId ?? "-"}`);
  }

  // Detalle de las partidas de obra que ya existan, para el snapshot ANTES.
  const obras = p.budgetVersions.filter((v) => v.type === "obra");
  for (const v of obras) {
    const items = await prisma.obraItem.findMany({
      where: { budgetVersionId: v.id },
      orderBy: { sortOrder: "asc" },
      select: {
        itemNumber: true, name: true, quantity: true, unitPrice: true, total: true,
        costLabor: true, costMaterial: true, noCobrado: true, chapter: true,
        _count: { select: { components: true } },
      },
    });
    const cobrables = items.filter((i) => !i.noCobrado);
    const cd = cobrables.reduce((s, i) => s + i.total, 0);
    const gg = cd * ((v.ggPercentage ?? 0) / 100);
    const ut = cd * ((v.utilityPercentage ?? 0) / 100);
    console.log(
      `\n  --- obra ${v.version}: ${items.length} partidas (${items.length - cobrables.length} no cobradas) ` +
        `CD=${Math.round(cd).toLocaleString("es-CL")} neto=${Math.round(cd + gg + ut).toLocaleString("es-CL")} ` +
        `total c/IVA=${Math.round((cd + gg + ut) * 1.19).toLocaleString("es-CL")}`
    );
    console.log(
      `      MO total (Σ costLabor×cant)=${Math.round(items.reduce((s, i) => s + (i.costLabor ?? 0) * i.quantity, 0)).toLocaleString("es-CL")}`
    );
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
