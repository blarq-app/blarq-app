// SOLO LECTURA — no escribe NADA en la base.
//
// Pendiente 160. Hay dos juegos de categorías a propósito (no son duplicados):
//   · appliesTo="recibida" → lo que BLARQ COMPRA (Materiales, Mano de obra,
//     Muebles > Mueble/Cubiertas/Herrajes, Artefactos > Cocina/Baño/Iluminación…)
//   · appliesTo="emitida"  → lo que BLARQ COBRA al cliente (Obra, Muebles,
//     Artefactos). Alimenta "Me paso a Sueldos" vía conceptoDeFactura.
//
// Este script busca facturas archivadas en el juego EQUIVOCADO (una compra
// guardada en una categoría de cobro, o al revés) y, para cada una, propone
// destino mirando cómo quedaron catalogadas las OTRAS facturas del MISMO
// proveedor. Si el proveedor no deja clara la subcategoría, propone el padre
// y lo dice — no adivina.
//
// Uso: npx tsx scripts/diag-160-facturas-lado-equivocado.ts .env.prod
// NO usa dotenv (leería la base vieja): lee el DATABASE_URL del archivo dado.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-160-facturas-lado-equivocado.ts <ruta-env>");
  process.exit(1);
}
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  console.log(`# BASE: ${host}\n`);

  const cats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, appliesTo: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ruta = (id: string | null): string => {
    if (!id) return "(sin categoría)";
    const c = byId.get(id);
    if (!c) return `(categoría desconocida ${id})`;
    return c.parentId ? `${byId.get(c.parentId)?.name ?? "?"} > ${c.name}` : c.name;
  };

  // ── 1. El árbol completo, con cuántas facturas de cada tipo cuelgan ──────
  const conteos = await prisma.invoice.groupBy({
    by: ["categoryId", "type"],
    _count: { _all: true },
    _sum: { netAmount: true },
  });
  const cuenta = (catId: string, tipo: string) =>
    conteos.find((c) => c.categoryId === catId && c.type === tipo)?._count._all ?? 0;

  for (const lado of ["recibida", "emitida", "both"] as const) {
    const raices = cats.filter((c) => !c.parentId && c.appliesTo === lado);
    if (raices.length === 0) continue;
    console.log(
      `\n=== JUEGO "${lado}" — ${lado === "recibida" ? "lo que BLARQ COMPRA" : lado === "emitida" ? "lo que BLARQ COBRA al cliente" : "ambos"} ===`
    );
    for (const r of raices) {
      const hijas = cats.filter((c) => c.parentId === r.id);
      console.log(
        `  ${r.name.padEnd(22)} id=${r.id}  recibidas=${cuenta(r.id, "recibida")} emitidas=${cuenta(r.id, "emitida")}${hijas.length ? `  (${hijas.length} subcategorías)` : ""}`
      );
      for (const h of hijas) {
        console.log(
          `      └ ${h.name.padEnd(18)} id=${h.id}  recibidas=${cuenta(h.id, "recibida")} emitidas=${cuenta(h.id, "emitida")}`
        );
      }
    }
  }

  // ── 2. Facturas en el lado equivocado ────────────────────────────────────
  // Una factura está mal si su categoría (o la raíz de su categoría) tiene un
  // appliesTo que no es ni "both" ni el tipo de la factura.
  const raizDe = (catId: string): (typeof cats)[number] => {
    const c = byId.get(catId)!;
    return c.parentId ? byId.get(c.parentId)! : c;
  };

  const todas = await prisma.invoice.findMany({
    where: { categoryId: { not: null } },
    select: {
      id: true,
      type: true,
      folioNumber: true,
      rutIssuer: true,
      businessName: true,
      netAmount: true,
      issueDate: true,
      categoryId: true,
      project: { select: { name: true, numeroProyecto: true } },
    },
    orderBy: { issueDate: "asc" },
  });

  const malUbicadas = todas.filter((i) => {
    const r = raizDe(i.categoryId!);
    return r.appliesTo !== "both" && r.appliesTo !== i.type;
  });

  console.log(`\n\n=== FACTURAS EN EL JUEGO EQUIVOCADO: ${malUbicadas.length} ===`);

  // Para proponer destino: cómo quedó catalogado el resto de lo del mismo RUT,
  // mirando solo categorías del lado CORRECTO para esa factura.
  const propuestaPorRut = new Map<string, { ruta: string; catId: string; n: number }[]>();
  for (const inv of malUbicadas) {
    const rut = inv.rutIssuer ?? `nombre:${inv.businessName}`;
    if (propuestaPorRut.has(rut)) continue;
    const hermanas = todas.filter(
      (o) =>
        o.id !== inv.id &&
        (o.rutIssuer ?? `nombre:${o.businessName}`) === rut &&
        o.type === inv.type &&
        raizDe(o.categoryId!).appliesTo !== "emitida"
    );
    const agrupado = new Map<string, number>();
    for (const h of hermanas) agrupado.set(h.categoryId!, (agrupado.get(h.categoryId!) ?? 0) + 1);
    propuestaPorRut.set(
      rut,
      [...agrupado.entries()]
        .map(([catId, n]) => ({ catId, ruta: ruta(catId), n }))
        .sort((a, b) => b.n - a.n)
    );
  }

  let total = 0;
  for (const inv of malUbicadas) {
    const rut = inv.rutIssuer ?? `nombre:${inv.businessName}`;
    const evidencia = propuestaPorRut.get(rut) ?? [];
    total += inv.netAmount ?? 0;
    console.log(
      `\n  ${fecha(inv.issueDate)}  F-${(inv.folioNumber ?? "?").padEnd(9)} ${(inv.businessName ?? "?").slice(0, 30).padEnd(30)} ${clp(inv.netAmount ?? 0).padStart(12)}`
    );
    console.log(
      `     tipo=${inv.type} · obra: ${inv.project ? `#${inv.project.numeroProyecto ?? "-"} ${inv.project.name}` : "SIN OBRA"} · rut ${inv.rutIssuer ?? "—"}`
    );
    console.log(`     HOY está en:  ${ruta(inv.categoryId)}  [juego de COBRO]`);
    if (evidencia.length === 0) {
      console.log(
        `     evidencia:    no hay otras facturas de este proveedor bien catalogadas → mover al PADRE y que MJ afine`
      );
    } else {
      console.log(
        `     evidencia:    ${evidencia.map((e) => `${e.ruta} (${e.n})`).join(" · ")}`
      );
    }
  }
  console.log(`\n  Neto total involucrado: ${clp(total)}`);

  // ── 3. ¿Hay reglas de proveedor apuntando al juego de cobro? ─────────────
  // Si las hubiera, cada sync del SII volvería a mandar facturas para allá.
  const emitidasCats = cats.filter((c) => raizDe(c.id).appliesTo === "emitida").map((c) => c.id);
  const reglas = await prisma.invoiceCategorizationRule.findMany({
    where: { categoryId: { in: emitidasCats } },
    select: { id: true, rutIssuer: true, providerName: true, businessName: true, categoryId: true },
  });
  console.log(`\n\n=== REGLAS DE PROVEEDOR apuntando al juego de COBRO: ${reglas.length} ===`);
  for (const r of reglas) {
    console.log(
      `  rut=${r.rutIssuer ?? "—"} nombre=${r.providerName ?? r.businessName ?? "—"} → ${ruta(r.categoryId)}`
    );
  }
  if (reglas.length === 0) {
    console.log("  (ninguna — o sea, esto no se vuelve a ensuciar solo con el sync del SII)");
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
