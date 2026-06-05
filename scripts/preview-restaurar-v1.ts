/**
 * SOLO LECTURA (prod). Preview de la restauración de las 4 partidas que
 * difieren del PDF en Depto Colon V1_Sin ampliación:
 *   - 5.1 Instalación pavimento porcelanato (drift 43.198 -> 36.947)
 *   - 3.3 Cambio módulo eléctrico       (drift 16.100 -> 9.500)
 *   - 4.4 Llave de paso gas             (re-armar, P.U. 79.496) [molde Con ampliación]
 *   - 4.5 Modificación tubería gas      (re-armar, P.U. 90.276) [molde Con ampliación]
 *   (+ encimera gas 46.000, que sale limpio = GASFITER 40.000 + 15% margen)
 *
 * Método pedido por MJ: conservar lista de materiales y cantidades, mantener
 * % margen y % pérdida, y cuadrar escalando SOLO los materiales (proporcional
 * a su costo actual). Si escalar materiales no cierra limpio (queda un costo
 * de material absurdo/negativo), se MARCA y se para — no se toca el margen.
 *
 * NO escribe nada.
 */
import { config } from "dotenv";
config({ path: ".env.prod", override: true });
import { PrismaClient } from "@prisma/client";
import type { ObraItemComponent } from "@prisma/client";

const prisma = new PrismaClient();

// Espejo EXACTO de recalcObraItem.ts effectiveTotal()
function effectiveTotal(comp: ObraItemComponent, all: ObraItemComponent[]): number {
  const pct = comp.quantity || 0;
  if (comp.unit !== "%") return (comp.quantity || 0) * (comp.unitCost || 0);
  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const target = all.find((c) => c.id === comp.appliedToComponentId);
    if (!target) return 0;
    return effectiveTotal(target, all) * (pct / 100);
  }
  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = all
      .filter((c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id)
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }
  if (comp.type === "margen") {
    const base = all
      .filter((c) => c.id !== comp.id && c.type !== "margen" && c.type !== "perdida")
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }
  return (comp.quantity || 0) * (comp.unitCost || 0);
}

function partidaTotal(comps: ObraItemComponent[]): number {
  return comps.reduce((s, c) => s + effectiveTotal(c, comps), 0);
}

// Escala los materiales (type=material, unit != %) por f y devuelve el total.
function totalConMaterialesEscalados(comps: ObraItemComponent[], f: number): number {
  const scaled = comps.map((c) =>
    c.type === "material" && c.unit !== "%"
      ? { ...c, unitCost: (c.unitCost || 0) * f }
      : c
  );
  return partidaTotal(scaled);
}

// Busca f tal que el total con materiales escalados = target. Monótona en f.
function resolverFactor(comps: ObraItemComponent[], target: number): number {
  let lo = 0, hi = 4;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const t = totalConMaterialesEscalados(comps, mid);
    if (t < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function dumpPartida(label: string, comps: ObraItemComponent[]) {
  console.log(`    desglose:`);
  for (const c of comps) {
    const eff = effectiveTotal(c, comps);
    console.log(`      - ${c.type.padEnd(11)} | "${c.description}" | ${c.unit} | q=${c.quantity} | uc=${Math.round((c.unitCost || 0) * 100) / 100} | efectivo=${Math.round(eff)}`);
  }
}

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "??";
  if (!host.includes("ep-shy-morning")) { console.error("ABORTO no prod"); process.exit(1); }

  const SIN = "cmox4g37e0001rt5a82dafihc"; // V1_Sin ampliación (borrador)
  const CON = "cmoxcwp5c0001ky04jdtn9fgq"; // V1_Con ampliación (enviado) -> molde

  // ---- Porcelanato y módulo (en Sin ampliación) ----
  const targets: Record<string, number> = {
    "instalacion pavimento porcelanato": 36947,
    "cambio modulo electrico": 9500,
  };
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

  const sinItems = await prisma.obraItem.findMany({
    where: { budgetVersionId: SIN },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });

  for (const [needle, target] of Object.entries(targets)) {
    const it = sinItems.find((i) => norm(i.name).includes(needle));
    if (!it) { console.log(`\n### NO ENCONTRADA: ${needle}`); continue; }
    const actual = partidaTotal(it.components);
    console.log(`\n############################################################`);
    console.log(`### ${it.name} (item ${it.itemNumber}, cant ${it.quantity})`);
    console.log(`### P.U. hoy = ${Math.round(actual)} | P.U. PDF objetivo = ${target}`);
    console.log(`### ANTES:`);
    dumpPartida("antes", it.components);

    const f = resolverFactor(it.components, target);
    const scaled = it.components.map((c) =>
      c.type === "material" && c.unit !== "%" ? { ...c, unitCost: (c.unitCost || 0) * f } : c
    );
    const nuevo = partidaTotal(scaled);
    console.log(`### Factor materiales = ${f.toFixed(4)}  -> P.U. resultante = ${Math.round(nuevo)}`);
    console.log(`### DESPUÉS (materiales escalados):`);
    dumpPartida("despues", scaled);

    // ¿Cierra limpio? Chequear que ningún material quede absurdo (< 1% del actual o casi 0)
    const mats = it.components.filter((c) => c.type === "material" && c.unit !== "%");
    const absurdos = mats.filter((c) => (c.unitCost || 0) * f < (c.unitCost || 0) * 0.5);
    if (f < 0.5 || absurdos.length) {
      console.log(`### >>> NO CIERRA LIMPIO: el factor ${f.toFixed(3)} deja los materiales muy por debajo de su costo real (drift no es solo de materiales). PARAR — decisión de MJ.`);
    } else {
      console.log(`### >>> Cierra OK escalando solo materiales.`);
    }
  }

  // ---- Gas: molde desde Con ampliación ----
  const conItems = await prisma.obraItem.findMany({
    where: { budgetVersionId: CON },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });
  for (const needle of ["llave de paso gas", "modificacion tuberia gas", "instalacion encimera gas"]) {
    const it = conItems.find((i) => norm(i.name).includes(needle));
    if (!it) { console.log(`\n### molde gas NO encontrado: ${needle}`); continue; }
    console.log(`\n############################################################`);
    console.log(`### MOLDE (Con ampliación): ${it.name} — P.U. guardado=${Math.round(it.unitPrice)} (suma desglose=${Math.round(partidaTotal(it.components))})`);
    dumpPartida("molde", it.components);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
