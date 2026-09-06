// Regresión mínima de la regla del aviso "material escrito pero no cobrado"
// (pendiente 176). No toca la base: son casos armados a mano, todos sacados
// de filas reales de la base viva medidas el 2026-09-05.
// Uso: npx tsx scripts/test-material-sin-cobrar.ts
import {
  materialesSinCobrar,
  esProvisionAProposito,
} from "../src/lib/presupuesto/materialSinCobrar";

type C = Parameters<typeof esProvisionAProposito>[0];

const mat = (p: Partial<C>): C => ({
  type: "material",
  description: "X",
  unit: "UN",
  quantity: 0,
  unitCost: 1000,
  material: null,
  ...p,
});

const casos: { nombre: string; comps: C[]; esperado: number }[] = [
  {
    // El caso que originó todo: Casa Los Algarrobos, tabique interior.
    nombre: "OSB en cero → avisa",
    comps: [
      mat({ description: "PLACA OSB ESTRUCTURAL 9.5MM 122X244CM", unitCost: 11412 }),
      mat({ description: "VOLCANITA ST 15MM", quantity: 1, unitCost: 8820 }),
    ],
    esperado: 1,
  },
  {
    nombre: "PROVISION por descripción → NO avisa",
    comps: [mat({ description: "PROVISION GRIFERIA LAVAMANOS", unitCost: 50420 })],
    esperado: 0,
  },
  {
    nombre: "PROVISIÓN con tilde → NO avisa",
    comps: [mat({ description: "PROVISIÓN WC $150.000", unitCost: 126050 })],
    esperado: 0,
  },
  {
    // El foco proforma: es provisión pero no dice la palabra. Se apaga
    // tildando el material en el catálogo (decisión de MJ 2026-09-05).
    nombre: "foco proforma sin la palabra, tildado en el catálogo → NO avisa",
    comps: [
      mat({
        description: "FOCO VALOR PROFORMA $25.000 IVA INCL",
        unitCost: 21008,
        material: { isProvision: true },
      }),
    ],
    esperado: 0,
  },
  {
    nombre: "el mismo foco SIN tildar → avisa",
    comps: [
      mat({
        description: "FOCO VALOR PROFORMA $25.000 IVA INCL",
        unitCost: 21008,
        material: { isProvision: false },
      }),
    ],
    esperado: 1,
  },
  {
    // ENCHAPE PIEDRA y MODIFICACIONES ELECTRICAS tienen renglones así.
    nombre: "plantilla vacía (precio 0) → NO avisa",
    comps: [mat({ description: "MATERIAL", unitCost: 0 })],
    esperado: 0,
  },
  {
    nombre: "material con cantidad → NO avisa",
    comps: [mat({ description: "SACO YESO 25KG", quantity: 0.1, unitCost: 4193 })],
    esperado: 0,
  },
  {
    nombre: "mano de obra y leyes en cero → NO avisa (no son material)",
    comps: [
      mat({ type: "mano_obra", description: "MAESTRO", unitCost: 55000 }),
      mat({ type: "mano_obra", description: "LEYES SOCIALES", unit: "%", unitCost: 350 }),
    ],
    esperado: 0,
  },
  {
    nombre: "margen y pérdida en 0% → NO avisan",
    comps: [
      mat({ type: "margen", description: "MARGEN", unit: "%", unitCost: 474 }),
      mat({ type: "perdida", description: "PERDIDA DE MATERIAL", unit: "%", unitCost: 147 }),
    ],
    esperado: 0,
  },
  {
    nombre: "dos materiales en cero → los cuenta a los dos",
    comps: [
      mat({ description: "PLACA OSB ESTRUCTURAL 9.5MM", unitCost: 11412 }),
      mat({ description: "CINTA PARA ENMASCARAR 48MM 40MTS", unitCost: 3353 }),
    ],
    esperado: 2,
  },
  {
    nombre: "partida sin desglose → NO avisa",
    comps: [],
    esperado: 0,
  },
];

let fallos = 0;
for (const c of casos) {
  const got = materialesSinCobrar(c.comps).length;
  const ok = got === c.esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${c.nombre} — esperado ${c.esperado}, dio ${got}`);
}
console.log(`\n${casos.length - fallos}/${casos.length} casos OK`);
process.exit(fallos === 0 ? 0 : 1);
