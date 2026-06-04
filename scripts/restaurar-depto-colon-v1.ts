/**
 * Restaura Depto Colon "V1_Sin ampliación" (obra) para que coincida EXACTO
 * con el PDF enviado (08-05-26). PROD.
 *
 * Decisiones de MJ:
 *  - P.U. y totales de las 27 partidas = PDF (contractual).
 *  - Porcelanato (5.1) y Módulo (3.3): opción C — fijar P.U./total al PDF,
 *    desglose intacto (no se inventa ni reescala; queda descuadrado, igual que
 *    ya está toda Con ampliación). isCustomized=true para que el sync no lo pise.
 *  - Encimera eléctrica -> convertir a "INSTALACION ENCIMERA GAS" $46.000
 *    (GASFITER 40.000 + margen 15% = 46.000, cuadra limpio).
 *  - Llave de paso gas ($79.496) y Modificación tubería gas ($90.276):
 *    re-crear usando "Con ampliación" como molde, P.U./total = PDF.
 *  - Al final, pasar la versión a "enviado" para congelarla.
 *
 * DRY-RUN por default. Escribe solo con --apply. Antes de --apply hace backup
 * JSON de la versión completa.
 *
 *   npx tsx scripts/restaurar-depto-colon-v1.ts            # dry-run
 *   npx tsx scripts/restaurar-depto-colon-v1.ts --apply    # escribe (pide backup)
 */
import { config } from "dotenv";
config({ path: ".env.prod", override: true });
import { PrismaClient } from "@prisma/client";
import type { ObraItemComponent } from "@prisma/client";
import { writeFileSync, mkdirSync } from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const SIN = "cmox4g37e0001rt5a82dafihc"; // V1_Sin ampliación (borrador)
const CON = "cmoxcwp5c0001ky04jdtn9fgq"; // V1_Con ampliación (molde gas)

// PDF enviado: [itemNumber, nombre, unidad, cantidad, P.U., total]
const PDF: [string, string, string, number, number, number][] = [
  ["1.1", "Retiro mobiliario cocina", "GL", 1, 195000, 195000],
  ["1.2", "Retiro piso cerámico", "M2", 12.5, 9634, 120419],
  ["1.3", "Retiro revestimiento cerámico", "M2", 28.11, 6469, 181849],
  ["1.3", "Demolición tabique", "M2", 6.05, 15000, 90750],
  ["2.1", "Enlucido de muros", "M2", 16.77, 12967, 217453],
  ["2.2", "Instalación volcanita", "M2", 17.38, 16456, 285999],
  ["2.3", "Construcción tabique interior", "M2", 1.44, 66356, 95553],
  ["3.1", "Nuevo arranque eléctrico", "UN", 2, 55200, 110400],
  ["3.2", "Enchufe/interruptor nuevo Sinthesi S33", "UN", 7, 53974, 377815],
  ["3.3", "Cambio módulo eléctrico", "UN", 10, 9500, 95000],
  ["3.4", "Instalación campana", "UN", 1, 48000, 48000],
  ["3.5", "Instalación horno eléctrico", "UN", 1, 23150, 23150],
  ["3.6", "Instalación microondas", "UN", 1, 30000, 30000],
  ["4.1", "Modificaciones sanitarias cocina", "GL", 1, 152955, 152955],
  ["4.2", "Instalación grifería lavaplatos", "UN", 1, 38500, 38500],
  ["4.3", "Instalación encimera gas", "UN", 1, 46000, 46000],
  ["4.4", "Llave de paso gas", "UN", 1, 79496, 79496],
  ["4.5", "Modificación tubería gas", "GL", 1, 90276, 90276],
  ["4.6", "Instalación desagüe lavaplatos/lavamanos", "UN", 1, 37092, 37092],
  ["4.7", "Instalación lavadora y secadora", "UN", 1, 40000, 40000],
  ["5.1", "Instalación pavimento porcelanato", "M2", 12.5, 36947, 461833],
  ["5.2", "Pintura de muros", "M2", 28.11, 11175, 314131],
  ["5.3", "Pintura de cielos baños/cocina", "M2", 12.5, 9144, 114295],
  ["5.4", "Instalación guardapolvo porcelanato", "ML", 16.61, 16919, 281028],
  ["5.5", "Puerta metálica con vidrio", "UN", 1, 714000, 714000],
  ["6.2", "Limpieza y cuidado general de obra", "GL", 1, 408643, 408643],
  ["6.3", "Retiro de escombros mediano", "UN", 2, 243136, 486272],
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

function effectiveTotal(comp: ObraItemComponent, all: ObraItemComponent[]): number {
  const pct = comp.quantity || 0;
  if (comp.unit !== "%") return (comp.quantity || 0) * (comp.unitCost || 0);
  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const t = all.find((c) => c.id === comp.appliedToComponentId);
    return t ? effectiveTotal(t, all) * (pct / 100) : 0;
  }
  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = all.filter((c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id).reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }
  if (comp.type === "margen") {
    const base = all.filter((c) => c.id !== comp.id && c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }
  return (comp.quantity || 0) * (comp.unitCost || 0);
}
const sumComp = (cs: ObraItemComponent[]) => cs.reduce((s, c) => s + effectiveTotal(c, cs), 0);

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "??";
  if (!host.includes("ep-shy-morning")) { console.error("ABORTO: no es prod"); process.exit(1); }
  console.log(`>>> prod ${host} — modo ${APPLY ? "APPLY (ESCRIBE)" : "DRY-RUN"}\n`);

  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: SIN },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });

  // Plan de acciones
  type Plan = { pdf: typeof PDF[number]; item: (typeof items)[number] | null; accion: string };
  const usados = new Set<string>();
  const plan: Plan[] = [];
  for (const row of PDF) {
    const [, nombre] = row;
    const it = items.find((i) => !usados.has(i.id) && norm(i.name) === norm(nombre));
    if (it) usados.add(it.id);
    let accion = "sin cambio";
    if (!it) {
      accion = "CREAR (molde Con ampliación)";
    } else if (Math.round(it.unitPrice) !== row[4] || Math.round(it.total) !== row[5]) {
      accion = "FIJAR P.U./total al PDF (opción C, desglose intacto)";
    }
    plan.push({ pdf: row, item: it ?? null, accion });
  }
  // El item que sobra en base (encimera eléctrica) -> convertir a encimera gas
  const sobrantes = items.filter((i) => !usados.has(i.id));

  console.log("== PLAN (PDF -> base) ==");
  for (const p of plan) {
    const [num, nombre, , , pu, total] = p.pdf;
    const hoy = p.item ? `hoy PU ${Math.round(p.item.unitPrice)}/tot ${Math.round(p.item.total)}` : "FALTA en base";
    console.log(`  [${num}] ${nombre} -> PU ${pu}/tot ${total} | ${hoy} | ${p.accion}`);
  }
  console.log("\n== SOBRAN en base (no están en el PDF) ==");
  for (const s of sobrantes) console.log(`  ${s.itemNumber} ${s.name} PU ${Math.round(s.unitPrice)} -> CONVERTIR/RESOLVER`);

  // Totales objetivo (PDF)
  const sumPDF = PDF.reduce((a, r) => a + r[5], 0);
  console.log(`\n== TOTALES OBJETIVO (PDF) ==`);
  console.log(`  Costo directo: ${sumPDF} (PDF declara 5135908)`);
  const gg = Math.round(sumPDF * 0.2), util = Math.round(sumPDF * 0.1);
  const neto = sumPDF + gg + util, iva = Math.round(neto * 0.19);
  console.log(`  GG 20% ${gg} | Util 10% ${util} | Neto ${neto} | IVA 19% ${iva} | TOTAL ${neto + iva}`);
  console.log(`  PDF: GG 1027182 | Util 513591 | Neto 6676681 | IVA 1268569 | TOTAL 7945250`);

  if (!APPLY) {
    console.log("\n(DRY-RUN — no se escribió nada. Correr con --apply tras OK de MJ.)");
    return;
  }

  // ===== APPLY =====
  // Backup completo de la versión
  mkdirSync("backups", { recursive: true });
  const full = await prisma.budgetVersion.findUnique({
    where: { id: SIN },
    include: { obraItems: { include: { components: true } } },
  });
  const stamp = process.argv.find((a) => a.startsWith("--stamp="))?.split("=")[1] ?? "manual";
  const backupPath = `backups/restaurar-depto-colon-v1-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(full, null, 2));
  console.log(`\nBackup -> ${backupPath}`);

  // (La mutación real se implementa tras aprobar el dry-run.)
  console.log("APPLY todavía no implementado — pendiente OK del dry-run.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
