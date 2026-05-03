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
//   - UPDATE de Invoice: setea projectId + categoryId. Las que en Maxxa
//     salen como "PROVEEDORES" sin sub quedan con categoryId=null para
//     que las reglas RUT→categoría las clasifiquen luego.
//
// Uso:  npx tsx scripts/import-maxxa-assignments.ts [--apply]
//   sin --apply: dry-run, solo reporta lo que haría.
//   con --apply: ejecuta los UPSERT/UPDATE.

import { prisma } from "../src/lib/prisma";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
// Archivos a procesar: vienen como args (todo lo que no empieza con "--").
// Si no se pasan, usa el default.
const ARG_FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILES =
  ARG_FILES.length > 0
    ? ARG_FILES
    : ["/Users/mjblanco/Downloads/DetallesCentroCosto.xls"];

// ─── Parseo del HTML "xls" de Maxxa ──────────────────────────────────────
// Maxxa exporta un .xls que en realidad es HTML plano <table><tr><td>.
// Con regex simples es suficiente, sin agregar dependencias.
type Row = Record<string, string>;

function parseHtml(filePath: string): Row[] {
  const html = readFileSync(filePath, "utf-8");
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
  // Centros con prefijo 00_* son internos (BLARQ, CASA, etc).
  // Auto-creación los marca con isInternal=true (ver resolveOrCreateProject).
  "00_BLARQ": "CREATE",
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
function mapCategoria(desc: string, sub: string): CatPath | null {
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
  // En la app las dejamos con categoryId=null (renderiza como "sin
  // categoría" itálica). Las reglas RUT→categoría las clasifican
  // automáticamente cuando MJ asigna la primera del proveedor.
  if (d === "PROVEEDORES") return null;

  // Por defecto, también null.
  return null;
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

  // Junto las filas de todos los archivos. Si dos archivos tuvieran la misma
  // factura (mismo folio + tipoDoc + rutDoc), la última gana — pero como
  // cada export de Maxxa es un mes distinto, eso no debería pasar.
  const rows: Row[] = [];
  for (const f of FILES) {
    const r = parseHtml(f);
    console.log(`  · ${f.split("/").pop()}: ${r.length} filas`);
    rows.push(...r);
  }
  console.log(`Total: ${rows.length} filas\n`);

  // 1) Resolver projectId por centro de costo
  // Estrategia:
  //   a) Si el centro está en CENTRO_PLAN, aplicar override
  //   b) Si no: parsear "NN_Algo (Cliente)" para extraer numeroProyecto y name
  //      - Buscar primero por numeroProyecto en DB (los 9 ya existentes ya
  //        están con el name limpio "Portofino", "Lefevre", etc — el match
  //        por numero es más confiable que por name)
  //      - Si no hay match: crear un proyecto nuevo
  const projectByCentro = new Map<string, string | null>();

  // a) Aplicar CENTRO_PLAN overrides explícitos
  for (const [centro, plan] of Object.entries(CENTRO_PLAN)) {
    if (plan === "NULL") {
      projectByCentro.set(centro, null);
    } else if (plan === "CREATE") {
      const resolved = await resolveOrCreateProject(centro);
      projectByCentro.set(centro, resolved);
    } else {
      projectByCentro.set(centro, plan.existingId);
      const p = await prisma.project.findUnique({ where: { id: plan.existingId } });
      console.log(`  · ${centro} → proyecto existente: ${p?.name ?? "(?)"}`);
    }
  }

  // b) Detectar centros que aparecen en los archivos pero NO en CENTRO_PLAN
  //    y resolverlos dinámicamente
  const centrosEnArchivo = new Set(rows.map((r) => r.CentroCosto).filter(Boolean));
  for (const centro of centrosEnArchivo) {
    if (projectByCentro.has(centro)) continue;
    const resolved = await resolveOrCreateProject(centro);
    projectByCentro.set(centro, resolved);
  }

  // Helper: dado un centro como "60_Portofino (Carola Ovalle)" intenta
  // matchear el proyecto existente por numeroProyecto; si no existe,
  // lo crea con name = parte antes del paréntesis (sin NN_) y clientName
  // = parte dentro del paréntesis.
  async function resolveOrCreateProject(centro: string): Promise<string | null> {
    // Parsear "NN_..." y "(...)"
    const numMatch = centro.match(/^(\d+)_/);
    let numero = numMatch ? parseInt(numMatch[1], 10) : null;
    // Overrides manuales para corregir números mal asignados en Maxxa.
    // (En Maxxa "52_Pauline Dumay" venía con número 52, pero MJ confirmó
    // que el numeroProyecto correcto es 53.)
    const NUMERO_OVERRIDES: Record<string, number> = {
      "52_Pauline Dumay": 53,
    };
    if (NUMERO_OVERRIDES[centro] != null) {
      numero = NUMERO_OVERRIDES[centro];
    }
    const parenMatch = centro.match(/^(.+?)\s*\((.+)\)\s*$/);
    const fullName = parenMatch ? parenMatch[1].trim() : centro;
    const clientName = parenMatch ? parenMatch[2].trim() : fullName;
    // Limpiar prefijo "NN_" del name
    const name = fullName.replace(/^\d+_/, "").trim() || fullName;

    // Centros "00_*" son internos (gastos de empresa, no proyectos)
    const isInternal = numero === 0;

    // Buscar existente por numeroProyecto (más robusto que por name)
    let existing = numero != null
      ? await prisma.project.findUnique({ where: { numeroProyecto: numero } })
      : null;
    // Fallback: buscar por name
    if (!existing) {
      existing = await prisma.project.findFirst({ where: { name } });
    }
    if (existing) {
      console.log(`  · ${centro} → proyecto existente: ${existing.name} (Nº ${existing.numeroProyecto ?? "—"})`);
      return existing.id;
    }

    // Crear nuevo. Si numero está libre, usarlo. Si no, dejarlo null.
    // Para internos: numero siempre null (no son proyectos numerados).
    let numeroProyecto: number | null = null;
    let numeroCotizacionToUse: number | null = null;
    if (!isInternal) {
      if (numero != null) {
        const conflict = await prisma.project.findUnique({ where: { numeroProyecto: numero } });
        numeroProyecto = conflict ? null : numero;
      }
      // Cotización única — siguiente disponible
      const maxC = await prisma.project.aggregate({ _max: { numeroCotizacion: true } });
      numeroCotizacionToUse = (maxC._max.numeroCotizacion ?? 0) + 1;
    }
    if (APPLY) {
      const p = await prisma.project.create({
        data: {
          name,
          clientName: isInternal ? "Gastos empresa" : clientName,
          status: "ejecucion",
          numeroProyecto,
          numeroCotizacion: numeroCotizacionToUse,
          isInternal,
        },
      });
      const tag = isInternal ? "interno" : `Nº ${numeroProyecto ?? "—"}, C-${numeroCotizacionToUse}`;
      console.log(`  ✓ creado proyecto: ${name} (${tag})`);
      return p.id;
    } else {
      const tag = isInternal ? "interno" : `Nº ${numeroProyecto ?? "—"}, cliente: ${clientName}`;
      console.log(`  + crearía proyecto: ${name} (${tag})`);
      return "<<NEW>>";
    }
  }

  // 2) Pre-cargar todas las categorías para resolver paths
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
    const rutTercero = normRut(row.RutDoc);
    const centro = row.CentroCosto;
    const desc = row.DescCatego;
    const sub = row.DescSubCatego;
    // Maxxa: TipoMov = "out" → factura recibida (compra a proveedor)
    //        TipoMov = "in"  → factura emitida (venta a cliente)
    // En DB: para recibidas el RUT del Excel es el rutIssuer (proveedor);
    //        para emitidas el RUT del Excel es el rutReceiver (cliente).
    const isEmitida = String(row.TipoMov).toLowerCase() === "in";
    const dbType = isEmitida ? "emitida" : "recibida";

    if (!projectByCentro.has(centro)) {
      stats.centroMissing.add(centro);
      continue;
    }

    // Match: tipoDoc + folio + (rutIssuer | rutReceiver según el tipo)
    const candidates = await prisma.invoice.findMany({
      where: { tipoDoc, folioNumber: folio, type: dbType },
      select: { id: true, rutIssuer: true, rutReceiver: true, businessName: true, totalAmount: true, projectId: true, categoryId: true },
    });
    const inv = candidates.find((c) =>
      normRut(isEmitida ? (c.rutReceiver ?? "") : (c.rutIssuer ?? "")) === rutTercero
    );

    if (!inv) {
      stats.notFound.push(`${dbType} tipoDoc=${tipoDoc} folio=${folio} rut=${rutTercero} (${row.NomAux})`);
      continue;
    }
    stats.matched++;

    // Resolver projectId
    const projectId = projectByCentro.get(centro);
    const finalProjectId = projectId === "<<NEW>>" ? null : projectId ?? null;

    // Resolver categoryId. catPath=null → factura queda con categoryId=null
    // (las reglas RUT→categoría la clasifican cuando MJ asigne la primera
    // del proveedor).
    const catPath = mapCategoria(desc, sub);
    const categoryId = catPath ? findCat(catPath) : null;
    if (catPath && !categoryId) {
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
