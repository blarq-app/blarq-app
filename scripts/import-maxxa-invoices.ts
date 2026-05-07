// Importa facturas legacy desde un export de Maxxa (HTML disfrazado de
// .xls). A diferencia de scripts/import-maxxa-assignments.ts (que solo
// asigna projectId/categoryId a facturas que YA existen en BD vía
// SimpleFactura), este script CREA las Invoice que no existen.
//
// Uso típico: facturas anteriores a 2026-04-01 (fecha de corte de
// SimpleFactura) que no llegaron por sync SII, pero que sí están en
// Maxxa.
//
// Match: por (tipoDoc, folioNumber, rutIssuer/rutReceiver según type).
// Si NO existe en BD → la crea con origin='maxxa_legacy'.
// Si existe → solo updatea projectId + categoryId (delegando al script
// de asignaciones para reglas más finas).
//
// Args:
//   --apply               Aplica cambios (default: dry-run).
//   --project=<filtro>    Filtra por nombre/numero de proyecto (case-
//                         insensitive substring sobre el CentroCosto).
//                         Si no se pasa, procesa TODAS las filas.
//   <archivo.xls>...      Uno o más archivos a procesar.
//
// Ejemplo:
//   npx tsx scripts/import-maxxa-invoices.ts \
//     --project=Aguirre \
//     /path/to/DetallesCentroCosto*.xls \
//     --apply

import { prisma } from "../src/lib/prisma";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");

const projectFilterArg = process.argv.find((a) => a.startsWith("--project="));
const PROJECT_FILTER = projectFilterArg
  ? projectFilterArg.slice("--project=".length).toLowerCase()
  : null;

const FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (FILES.length === 0) {
  console.error("Falta al menos un archivo Maxxa .xls");
  process.exit(1);
}

// ─── Parser HTML→rows ────────────────────────────────────────────────────

type Row = Record<string, string>;

function parseHtml(filePath: string): Row[] {
  const html = readFileSync(filePath, "utf-8");
  const trMatches = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows: string[][] = trMatches.map((m) => {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .trim()
    );
    return cells;
  });
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const r: Row = {};
    header.forEach((h, j) => (r[h] = row[j] ?? ""));
    return r;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Maxxa exporta montos en formato chileno: "1.234.567,89".
// Punto = separador miles, coma = decimal.
function parseCLP(s: string): number {
  if (!s) return 0;
  const clean = String(s).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function normRut(s: string): string {
  return s
    .replace(/\./g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

// (DescCatego, DescSubCatego) Maxxa → path en CostCategory de la app.
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
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? "APPLY mode (commit a BD)" : "DRY-RUN mode (sin cambios)");
  if (PROJECT_FILTER) console.log(`Filtro proyecto: "${PROJECT_FILTER}"`);
  console.log();

  // 1) Leer archivos
  const allRows: Row[] = [];
  for (const f of FILES) {
    const r = parseHtml(f);
    console.log(`  ${f.split("/").pop()}: ${r.length} filas`);
    allRows.push(...r);
  }
  console.log(`  Total: ${allRows.length} filas\n`);

  // 2) Filtrar por proyecto si aplica
  const rows = PROJECT_FILTER
    ? allRows.filter((r) => String(r.CentroCosto).toLowerCase().includes(PROJECT_FILTER))
    : allRows;
  if (PROJECT_FILTER) {
    console.log(`  Filas tras filtro: ${rows.length}\n`);
  }

  // 3) Pre-cargar proyectos por número (rápido)
  const allProjects = await prisma.project.findMany({
    select: { id: true, name: true, numeroProyecto: true },
  });
  const projectByCentro = new Map<string, string | null>();
  function resolveProject(centro: string): string | null {
    if (projectByCentro.has(centro)) return projectByCentro.get(centro)!;
    const numMatch = centro.match(/^(\d+)_/);
    let resolved: string | null = null;
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      const found = allProjects.find((p) => p.numeroProyecto === num);
      if (found) resolved = found.id;
    }
    if (!resolved) {
      const parenMatch = centro.match(/^(?:\d+_)?(.+?)(?:\s*\(.+\))?\s*$/);
      const namePart = parenMatch ? parenMatch[1].trim() : centro;
      const found = allProjects.find((p) =>
        p.name.toLowerCase().includes(namePart.toLowerCase())
      );
      if (found) resolved = found.id;
    }
    projectByCentro.set(centro, resolved);
    return resolved;
  }

  // 4) Pre-cargar categorías
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
    const child = allCats.find(
      (c) => c.name === path[1] && c.parentId === parent.id
    );
    return child?.id ?? null;
  }

  // 5) Procesar filas
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    noProject: [] as string[],
    catMissing: new Set<string>(),
    centroMissing: new Set<string>(),
  };

  // Dedup: si el archivo Maxxa tiene la misma factura 2 veces (raro), me
  // quedo con la última.
  const seen = new Set<string>();
  let sinRespaldoCount = 0;

  for (const row of rows) {
    const tipoDoc = parseInt(row.CodTipoDoc || "0", 10);
    if (!tipoDoc) continue;
    const folio = String(row.FolioDoc || "").trim();
    if (!folio) continue;

    // "Movimiento sin Respaldo" en Maxxa = pago a maestro sin factura.
    // CodTipoDoc=1043 es código interno propio de Maxxa (no DTE SII real),
    // sin IVA (MontoTotal == MontoDoc). Se guardan con origin distinto
    // para que la UI los pueda mostrar como "Pago sin documento" y MJ no
    // los confunda con facturas. tipoDoc=1043 se mantiene para que el
    // unique (type,tipoDoc,folio,rutIssuer) evite duplicados al re-importar.
    const isSinRespaldo = row.DetalleTipo === "Movimiento sin Respaldo";

    // TipoMov "out" = recibida, "in" = emitida
    const isEmitida = String(row.TipoMov).toLowerCase() === "in";
    const dbType: "emitida" | "recibida" = isEmitida ? "emitida" : "recibida";

    // Para recibidas: Maxxa.RutDoc = proveedor = rutIssuer
    // Para emitidas:  Maxxa.RutDoc = cliente = rutReceiver
    const rutTercero = normRut(row.RutDoc || "");
    const rutIssuer = isEmitida ? "77270733-9" : rutTercero; // BLARQ es 77270733-9
    const rutReceiver = isEmitida ? rutTercero : "77270733-9";

    const dedupeKey = `${dbType}|${tipoDoc}|${folio}|${rutTercero}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const centro = String(row.CentroCosto || "").trim();
    const projectId = centro ? resolveProject(centro) : null;
    if (centro && !projectId) {
      stats.centroMissing.add(centro);
    }

    // Categoría (puede ser null)
    const catPath = mapCategoria(row.DescCatego, row.DescSubCatego);
    const categoryId = catPath ? findCat(catPath) : null;
    if (catPath && !categoryId) {
      stats.catMissing.add(`${row.DescCatego}${row.DescSubCatego ? " > " + row.DescSubCatego : ""}`);
    }

    // Montos: MontoTotal (c/IVA), MontoDoc (neto), iva = total - neto.
    // OJO: Maxxa exporta NC con MontoTotal NEGATIVO. La convención de la
    // app es guardar SIEMPRE positivo y distinguir las NC por tipoDoc=61
    // (metrics.ts aplica sign(-1) cuando suma). Si guardáramos negativo
    // acá, se invertiría el signo doble vez.
    const totalAmount = Math.abs(parseCLP(row.MontoTotal));
    const netAmount = Math.abs(parseCLP(row.MontoDoc));
    const iva = Math.max(0, totalAmount - netAmount);

    // Fechas
    const issueDate = new Date(row.FechaDoc + "T12:00:00-03:00");
    const dueDate = row.FechaVenc
      ? new Date(row.FechaVenc + "T12:00:00-03:00")
      : null;

    // Status: si Saldo = 0 → pagada
    const saldo = parseCLP(row.Saldo);
    const status = saldo <= 0.01 ? "pagada" : "pendiente";
    const paidAt = status === "pagada" ? issueDate : null;

    // Buscar si ya existe (match por tipoDoc + folio + rut + type)
    const existing = await prisma.invoice.findFirst({
      where: {
        type: dbType,
        tipoDoc,
        folioNumber: folio,
        ...(isEmitida
          ? { rutReceiver: { contains: rutTercero.split("-")[0] } }
          : { rutIssuer: { contains: rutTercero.split("-")[0] } }),
      },
      select: {
        id: true,
        projectId: true,
        categoryId: true,
        origin: true,
      },
    });

    if (existing) {
      // Solo actualizar projectId/categoryId si están vacíos en BD
      const updates: Record<string, unknown> = {};
      if (!existing.projectId && projectId) updates.projectId = projectId;
      if (!existing.categoryId && categoryId) updates.categoryId = categoryId;
      if (Object.keys(updates).length === 0) {
        stats.skipped++;
        continue;
      }
      if (APPLY) {
        await prisma.invoice.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      stats.updated++;
      continue;
    }

    // Crear nueva
    if (APPLY) {
      await prisma.invoice.create({
        data: {
          type: dbType,
          tipoDoc,
          folioNumber: folio,
          rutIssuer,
          rutReceiver,
          businessName: row.NomAux || null,
          issueDate,
          dueDate,
          netAmount,
          iva,
          totalAmount,
          status,
          paidAt,
          projectId,
          categoryId,
          origin: isSinRespaldo ? "maxxa_sin_respaldo" : "maxxa_legacy",
          notes: isSinRespaldo
            ? `Pago a maestro sin documento tributario. Importado desde Maxxa el ${new Date().toISOString().slice(0, 10)}. id_inout=${row.id_inout}`
            : `Importado desde Maxxa el ${new Date().toISOString().slice(0, 10)}. id_inout=${row.id_inout}`,
        },
      });
    }
    stats.created++;
    if (isSinRespaldo) sinRespaldoCount++;
  }

  // 6) Reporte
  console.log(`\n=== Resumen ===`);
  console.log(`  Creadas:           ${stats.created}${sinRespaldoCount ? ` (incluye ${sinRespaldoCount} sin respaldo, sin IVA)` : ""}`);
  console.log(`  Actualizadas:      ${stats.updated} (existían sin projectId/categoryId)`);
  console.log(`  Sin cambio:        ${stats.skipped} (ya existían con todo asignado)`);
  if (stats.centroMissing.size > 0) {
    console.log(`\n  Centros sin proyecto en app:`);
    for (const c of stats.centroMissing) console.log(`    - ${c}`);
  }
  if (stats.catMissing.size > 0) {
    console.log(`\n  Categorías sin mapear (${stats.catMissing.size}):`);
    for (const c of stats.catMissing) console.log(`    - ${c}`);
  }
  console.log(`\n${APPLY ? "Cambios aplicados." : "DRY-RUN — para aplicar: --apply"}`);
}

main()
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
