// Pendiente 184 — recategoriza las facturas mal clasificadas de los
// proveedores cuya regla no calzaba y ordena esas reglas. Aprobado por MJ el
// 2026-09-24 ("acepto todas tus sugerencias"), después de revisar el detalle
// de cada factura leído del PDF del SII (scripts/diag-184-detalle-facturas-dudosas.ts).
//
// El plan (JSON) trae, por factura: RUT, folio, categoría de hoy ("desde") y
// la nueva ("hacia"); y por regla: borrar o cambiar categoría. Solo se toca
// una factura si HOY tiene exactamente la categoría "desde" — si alguien la
// cambió entretanto, el script se detiene sin escribir nada. Antes de
// escribir guarda un respaldo con el estado previo, para poder deshacer.
//
// Uso:
//   npx tsx scripts/aplicar-184-recategorizar.ts <ruta-env> <plan.json> <respaldo.json>            (prueba)
//   npx tsx scripts/aplicar-184-recategorizar.ts <ruta-env> <plan.json> <respaldo.json> --apply    (escribe)
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const [envPath, planPath, respaldoPath] = process.argv.slice(2);
const APPLY = process.argv.includes("--apply");
const url = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Plan = {
  facturas: { rut: string; proveedor: string; folio: string; neto: number; desde: string; hacia: string; motivo: string }[];
  reglas: { rut: string; accion: "borrar" | "categoria"; hacia?: string; nombre: string }[];
};

(async () => {
  try {
    console.log("host:", new URL(url).host, APPLY ? "· APLICANDO" : "· prueba (sin escribir)");
    const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

    // Categorías por ruta "Madre > Hija" (o "Nombre" si es madre). Ruta ambigua → error.
    const cats = await prisma.costCategory.findMany({ include: { parent: { select: { name: true } } } });
    const ruta = (c: (typeof cats)[number]) => (c.parent ? `${c.parent.name} > ${c.name}` : c.name);
    const porRuta = new Map<string, string>();
    const idARuta = new Map<string, string>();
    for (const c of cats) {
      if (porRuta.has(ruta(c))) throw new Error(`Categoría ambigua: ${ruta(c)}`);
      porRuta.set(ruta(c), c.id);
      idARuta.set(c.id, ruta(c));
    }
    const idDe = (r: string) => {
      const id = porRuta.get(r);
      if (!id) throw new Error(`No existe la categoría "${r}"`);
      return id;
    };

    // ── Facturas ──
    const cambios: { id: string; folio: string; proveedor: string; antes: string | null; despues: string; neto: number }[] = [];
    const problemas: string[] = [];
    for (const f of plan.facturas) {
      const invs = await prisma.invoice.findMany({
        where: { rutIssuer: f.rut, folioNumber: f.folio, type: "recibida" }, // incluye NC: su categoría sigue a lo devuelto
        select: { id: true, categoryId: true },
      });
      if (invs.length !== 1) { problemas.push(`${f.proveedor} F${f.folio}: ${invs.length} facturas con ese folio`); continue; }
      const hoy = invs[0].categoryId ? idARuta.get(invs[0].categoryId)! : null;
      if (hoy !== f.desde) { problemas.push(`${f.proveedor} F${f.folio}: hoy dice "${hoy}", el plan esperaba "${f.desde}"`); continue; }
      cambios.push({ id: invs[0].id, folio: f.folio, proveedor: f.proveedor, antes: invs[0].categoryId, despues: idDe(f.hacia), neto: f.neto });
    }

    // ── Reglas ──
    const reglas = [];
    for (const r of plan.reglas) {
      const regla = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: r.rut } });
      if (!regla) { problemas.push(`regla ${r.nombre}: no existe`); continue; }
      if (regla.projectId) problemas.push(`regla ${r.nombre}: tiene centro de costo, revisar antes de tocarla`);
      reglas.push({ plan: r, regla, hacia: r.hacia ? idDe(r.hacia) : null });
    }

    for (const c of cambios)
      console.log(`  ${c.proveedor.padEnd(12)} F${c.folio.padEnd(10)} ${idARuta.get(c.antes ?? "") ?? "—"} → ${idARuta.get(c.despues)}`);
    for (const r of reglas)
      console.log(`  regla ${r.plan.nombre}: ${idARuta.get(r.regla.categoryId ?? "") ?? "—"} → ${r.plan.accion === "borrar" ? "BORRAR" : idARuta.get(r.hacia!)}`);
    console.log(`\n${cambios.length} facturas · ${reglas.length} reglas · problemas: ${problemas.length}`);
    problemas.forEach((p) => console.log("  !! " + p));

    if (problemas.length) return console.log("Hay problemas: no se escribe nada.");
    if (!APPLY) return console.log("Prueba: no se escribió nada.");

    // Respaldo ANTES de escribir.
    fs.writeFileSync(respaldoPath, JSON.stringify({
      fecha: new Date().toISOString(),
      facturas: cambios.map((c) => ({ id: c.id, folio: c.folio, proveedor: c.proveedor, categoryIdAntes: c.antes })),
      reglas: reglas.map((r) => r.regla),
    }, null, 1));
    console.log("respaldo:", respaldoPath);

    await prisma.$transaction([
      ...cambios.map((c) => prisma.invoice.update({ where: { id: c.id }, data: { categoryId: c.despues } })),
      ...reglas.map((r) =>
        r.plan.accion === "borrar"
          ? prisma.invoiceCategorizationRule.delete({ where: { id: r.regla.id } })
          : prisma.invoiceCategorizationRule.update({ where: { id: r.regla.id }, data: { categoryId: r.hacia } })
      ),
    ]);
    console.log("listo.");
  } finally {
    await prisma.$disconnect();
  }
})();
