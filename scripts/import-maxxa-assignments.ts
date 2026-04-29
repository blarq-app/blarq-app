// Importa las asignaciones (proyecto + categoría) que MJ ya tenía en
// Maxxa para las facturas recibidas de abril 2026. El input es el HTML
// que Maxxa exporta como ".xls" (DetallesCentroCosto.xls).
//
// Match: por (tipoDoc, folioNumber, rutIssuer) contra las Invoice del SII
// que ya están en la DB.
//
// Side-effects:
//   - Crea proyectos faltantes (con el mismo nombre del centro de costo
//     en Maxxa). 63_JNC se mapea al proyecto Lefevre que ya existe.
//   - Crea categoría "Pendiente de asignar" para las que en Maxxa salen
//     como "PROVEEDORES" sin sub.
//   - UPDATE de Invoice: setea projectId + categoryId.
//
// Uso:  npx tsx scripts/import-maxxa-assignments.ts [--apply]
//   sin --apply: dry-run, solo reporta lo que haría.
//   con --apply: ejecuta los UPSERT/UPDATE.

import { prisma } from "../src/lib/prisma";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const FILE = "/Users/mjblanco/Downloads/DetallesCentroCosto.xls";

// ─── Parseo del HTML "xls" de Maxxa ──────────────────────────────────────
// Maxxa exporta un .xls que en realidad es HTML plano <table><tr><td>.
// Con regex simples es suficiente, sin agregar dependencias.
type Row = Record<string, string>;

function parseHtml(): Row[] {
  const html = readFileSync(FILE, "utf-8");
  const trMatches = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows: string[][] = trMatches.map((m) => {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "") // strip inner tags (<b>, <br>, etc)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim()
    );
    return cells;
  });
  if (rows.length < 2) throw new Error("Excel vacío");

  const header = rows[0];
  const out: Row[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r: Row = {};
    for (let j = 0; j < header.length; j++) r[header[j]] = rows[i][j] ?? "";
    out.push(r);
  }
  return out;
}

// ─── Mapeos ──────────────────────────────────────────────────────────────

// CentroCosto Maxxa → ¿qué hacer?
//   "EXISTING:<projectId>" → usar proyecto existente
//   "CREATE"               → crear proyecto con ese nombre
//   "NULL"                 → dejar projectId = null
const CENTRO_PLAN: Record<string, "CREATE" | "NULL" | { existingId: string }> = {
  "60_Portofino (Carola Ovalle)": "CREATE",
  "46_Ampliacion Casa Arrau (Pía Garcés)": "CREATE",
  "00_BLARQ": "CREATE", // TODO: esto debería ser un cost center, no un proyecto
  "62_Rosas (Cristian Zulueta)": "CREATE",
  "SIN CENTRO DE COSTO": "NULL",
  "59_Cocina Farellones (Pauline Dumay)": "CREATE",
  "54_Francisco de Aguirre (Hevia Decombe)": "CREATE",
  "63_JNC (Cristian Lefevre)": { existingId: "cmnx59uvq0000rty9ouec5i25" },
  "57_Quincho La Llaveria": "CREATE",
  "58_Ana Maria Didyk": "CREATE",
};

// (DescCatego, DescSubCatego) Maxxa → nombre de categoría en la app
// Si la categoría tiene parent, devuelve [parent, child]. Si no, [name].
type CatPath = [string] | [string, string];
function mapCategoria(desc: string, sub: string): CatPath {
  const d = desc.trim();
  const s = sub.trim();

  if (d === "MATERIALES") return ["Materiales"];
  if (d === "MANO DE OBRA") return ["Mano de obra"];
  if (d === "GASTOS GENERALES") return ["Gastos generales"];
  if (d === "GASTOS FINANCIEROS") return ["Gastos financieros"];
  if (d === "HERRAMIENTAS") return ["Herramientas"];
  if (d === "AUTOS - AUTOPISTAS") return ["Auto - Autopistas"];
  if (d === "AUTOS - COMBUSTIBLE") return ["Auto - Combustible"];
  if (d === "AUTOS - SEGURO") return ["Auto - Seguro"];

  if (d === "MUEBLES") {
    if (s === "CUBIERTAS") return ["Muebles", "Cubiertas"];
    if (s === "HERRAJES") return ["Muebles", "Herrajes"];
    return ["Muebles"];
  }

  if (d === "ARTEFACTOS") {
    if (s === "ILUMINACIÓN") return ["Artefactos", "Iluminación"];
    return ["Artefactos"];
  }

  if (d === "SUBCONTRATO") {
    if (s === "RETIRO ESCOMBROS / FLETE") return ["Subcontrato", "Flete / Retiro escombros"];
    if (s === "VENTANAS") return ["Subcontrato", "Ventanas"];
    return ["Subcontrato"];
  }

  // PROVEEDORES = default que pone Maxxa cuando no se asignó.
  // Lo mandamos al "Pendiente de asignar" para distinguir de las que
  // realmente están sin categoría asignada en la app.
  if (d === "PROVEEDORES") return ["Pendiente de asignar"];

  // Por defecto, también pendiente.
  return ["Pendiente de asignar"];
}

// Normalización de RUT: Maxxa usa "76237019-0" sin puntos. SII
// SimpleFactura puede traer "76237019-0" o "76.237.019-0". Comparamos
// solo con dígitos+DV, sin puntos ni espacios.
function normRut(s: string): string {
  return s.replace(/\./g, "").replace(/\s/g, "").toUpperCase();
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? "🚀 APPLY mode" : "🔍 DRY RUN mode\n");

  const rows = parseHtml();
  console.log(`Excel: ${rows.length} filas`);

  // 1) Resolver projectId por centro de costo (crear los faltantes)
  const projectByCentro = new Map<string, string | null>();
  for (const [centro, plan] of Object.entries(CENTRO_PLAN)) {
    if (plan === "NULL") {
      projectByCentro.set(centro, null);
    } else if (plan === "CREATE") {
      // El nombre del proyecto va sin paréntesis; lo que está dentro va a clientName.
      // Si no hay paréntesis, clientName queda igual al name (MJ lo edita después).
      const m = centro.match(/^(.+?)\s*\((.+)\)\s*$/);
      const name = m ? m[1].trim() : centro;
      const clientName = m ? m[2].trim() : centro;

      const existing = await prisma.project.findFirst({ where: { name } });
      if (existing) {
        projectByCentro.set(centro, existing.id);
        console.log(`  · proyecto ya existe: ${name}`);
      } else {

        if (APPLY) {
          const p = await prisma.project.create({
            data: { name, clientName, status: "en_ejecucion" },
          });
          projectByCentro.set(centro, p.id);
          console.log(`  ✓ creado proyecto: ${centro}`);
        } else {
          projectByCentro.set(centro, "<<NEW>>");
          console.log(`  + crearía proyecto: ${centro} (cliente: ${clientName})`);
        }
      }
    } else {
      projectByCentro.set(centro, plan.existingId);
      const p = await prisma.project.findUnique({ where: { id: plan.existingId } });
      console.log(`  · ${centro} → proyecto existente: ${p?.name ?? "(?)"}`);
    }
  }

  // 2) Asegurar categoría "Pendiente de asignar"
  let pendingCat = await prisma.costCategory.findFirst({
    where: { name: "Pendiente de asignar", parentId: null },
  });
  if (!pendingCat) {
    if (APPLY) {
      pendingCat = await prisma.costCategory.create({
        data: { name: "Pendiente de asignar", sortOrder: 999 },
      });
      console.log(`  ✓ creada categoría "Pendiente de asignar"`);
    } else {
      console.log(`  + crearía categoría "Pendiente de asignar"`);
    }
  }

  // 3) Pre-cargar todas las categorías para resolver paths
  const allCats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true },
  });
  function findCat(path: CatPath): string | null {
    if (path.length === 1) {
      const c = allCats.find((c) => c.name === path[0] && !c.parentId);
      return c?.id ?? null;
    }
    const parent = allCats.find((c) => c.name === path[0] && !c.parentId);
    if (!parent) return null;
    const child = allCats.find((c) => c.name === path[1] && c.parentId === parent.id);
    return child?.id ?? null;
  }

  // Re-fetch para incluir la pendiente recién creada (en APPLY)
  if (APPLY && pendingCat) allCats.push({ ...pendingCat });

  // 4) Recorrer filas y hacer match contra Invoice
  const stats = {
    matched: 0,
    notFound: [] as string[],
    catMissing: [] as string[],
    centroMissing: new Set<string>(),
    updated: 0,
  };

  for (const row of rows) {
    const tipoDoc = parseInt(row.CodTipoDoc || "0", 10);
    const folio = row.FolioDoc;
    const rutIssuer = normRut(row.RutDoc);
    const centro = row.CentroCosto;
    const desc = row.DescCatego;
    const sub = row.DescSubCatego;

    if (!CENTRO_PLAN[centro]) {
      stats.centroMissing.add(centro);
      continue;
    }

    // Match: tipoDoc + folio + rutIssuer (con normalización de RUT)
    const candidates = await prisma.invoice.findMany({
      where: { tipoDoc, folioNumber: folio, type: "recibida" },
      select: { id: true, rutIssuer: true, businessName: true, totalAmount: true, projectId: true, categoryId: true },
    });
    const inv = candidates.find((c) => normRut(c.rutIssuer ?? "") === rutIssuer);

    if (!inv) {
      stats.notFound.push(`tipoDoc=${tipoDoc} folio=${folio} rut=${rutIssuer} (${row.NomAux})`);
      continue;
    }
    stats.matched++;

    // Resolver projectId
    const projectId = projectByCentro.get(centro);
    const finalProjectId = projectId === "<<NEW>>" ? null : projectId ?? null;

    // Resolver categoryId
    const catPath = mapCategoria(desc, sub);
    let categoryId = findCat(catPath);
    if (!categoryId && catPath[0] === "Pendiente de asignar" && pendingCat) {
      categoryId = pendingCat.id;
    }
    if (!categoryId) {
      stats.catMissing.push(`${desc}${sub ? ` > ${sub}` : ""} (folio ${folio})`);
    }

    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          projectId: finalProjectId,
          categoryId: categoryId ?? undefined,
        },
      });
      stats.updated++;
    }
  }

  // 5) Reporte
  console.log(`\n=== Resumen ===`);
  console.log(`Filas Excel:           ${rows.length}`);
  console.log(`Match contra Invoice:  ${stats.matched}`);
  console.log(`No encontradas en DB:  ${stats.notFound.length}`);
  if (stats.notFound.length) {
    console.log(`  Las primeras 10:`);
    for (const n of stats.notFound.slice(0, 10)) console.log(`    · ${n}`);
  }
  if (stats.centroMissing.size) {
    console.log(`Centros desconocidos:`);
    for (const c of stats.centroMissing) console.log(`  · ${c}`);
  }
  if (stats.catMissing.length) {
    console.log(`Categorías sin mapear (${stats.catMissing.length}):`);
    const dedup = [...new Set(stats.catMissing)];
    for (const c of dedup.slice(0, 20)) console.log(`  · ${c}`);
  }
  console.log(`\n${APPLY ? `✓ ${stats.updated} facturas actualizadas` : `(dry-run — nada modificado)`}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
