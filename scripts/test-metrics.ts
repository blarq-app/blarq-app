// Tests sobre computeProjectMetrics() — la fuente única de verdad para
// los cálculos contables (gastado, cobrado, utilidad, desviaciones).
//
// MJ va a salir de Maxxa en 1-3 meses; cuando eso pase, esta función ES
// el único cálculo confiable. Cualquier regresión silenciosa (como el bug
// del IVA del 29-abr) se traduce en plata mal contabilizada.
//
// Estos tests no usan framework — son funciones que tiran si algo falla.
// Correr: npx tsx scripts/test-metrics.ts
//
// Si pasa todo, exit 0. Si falla algo, exit 1 con reporte.

import { computeProjectMetrics, type ProjectWithMetrics } from "../src/lib/projects/metrics";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertEq(actual: number, expected: number, label: string, tolerance = 0.01) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label} — esperado ${expected}, actual ${actual}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    failures.push(`  ✗ ${label}`);
  }
}

// ─── Helper: builder de proyecto mock ──────────────────────────────────
// Construye un ProjectWithMetrics con valores por defecto sanos.
// Sobreescribir con `overrides` para cada test.
function mockProject(overrides: Partial<ProjectWithMetrics> = {}): ProjectWithMetrics {
  const base: Record<string, unknown> = {
    id: "test",
    name: "Test Project",
    clientName: "Test Client",
    clientPhone: null,
    clientEmail: null,
    address: null,
    status: "ejecucion",
    startDate: new Date("2026-01-01"),
    estimatedEndDate: null,
    actualEndDate: null,
    currentVersion: "V1",
    ufReference: null,
    notes: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date(),
    maestroId: null,
    isInternal: false,
    numeroProyecto: 1,
    numeroCotizacion: 1,
    invoices: [],
    budgetVersions: [],
    estadosPago: [],
    ...overrides,
  };
  return base as unknown as ProjectWithMetrics;
}

function mockBudget(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    projectId: "test",
    version: "V1",
    type: "obra",
    status: "aprobado",
    ggPercentage: 20,
    utilityPercentage: 5,
    observations: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    obraItems: [],
    muebleChapters: [],
    artefactoItems: [],
    paymentTerms: [],
    ...overrides,
  };
}

function mockObraItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    budgetVersionId: "b1",
    chapter: "demoliciones",
    itemNumber: "1.1",
    name: "ITEM TEST",
    descriptionCliente: null,
    descriptionMaestro: null,
    unit: "GL",
    quantity: 1,
    unitPrice: 100000,
    total: 100000,
    costMaterial: 50000,
    costLabor: 30000,
    costTools: 10000,
    costMargin: 0,
    costLoss: 0,
    costSubcontract: 10000,
    catalogPartidaId: null,
    sortOrder: 0,
    lineageId: "l1",
    parentLineageId: null,
    ...overrides,
  };
}

function mockInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    projectId: "test",
    categoryId: null,
    type: "recibida",
    tipoDoc: 33,
    folioNumber: "1",
    rutIssuer: "11111111-1",
    rutReceiver: "77270733-9",
    businessName: "Proveedor Test",
    issueDate: new Date(),
    dueDate: null,
    netAmount: 100000,
    iva: 19000,
    totalAmount: 119000,
    status: "pendiente",
    origin: "manual",
    siiTrackId: null,
    xmlUrl: null,
    pdfUrl: null,
    syncedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: null,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Test 1: regresión del bug del IVA — gastado debe ser NETO
// ───────────────────────────────────────────────────────────────────────
console.log("\nTest 1: Gastado NETO (regresión bug IVA del 29-abr)");
{
  const project = mockProject({
    invoices: [
      mockInvoice({ netAmount: 1000000, iva: 190000, totalAmount: 1190000 }),
      mockInvoice({ netAmount: 500000, iva: 95000, totalAmount: 595000 }),
    ],
  });
  const m = computeProjectMetrics(project);
  // Total gastado debe ser NETO (1.000.000 + 500.000 = 1.500.000)
  // NO totalAmount (1.190.000 + 595.000 = 1.785.000) — eso era el bug.
  assertEq(m.totalGastado, 1_500_000, "totalGastado suma netAmount, no totalAmount");
  // Si alguien vuelve a meter totalAmount, este test falla con un diff de
  // exactamente el IVA — fácil de diagnosticar.
}

// ───────────────────────────────────────────────────────────────────────
// Test 2: cobrado vs totalAcordado
// ───────────────────────────────────────────────────────────────────────
console.log("\nTest 2: Cobrado al cliente (c/IVA) vs total acordado");
{
  const project = mockProject({
    budgetVersions: [
      mockBudget({
        type: "obra",
        ggPercentage: 20,
        utilityPercentage: 5,
        obraItems: [
          mockObraItem({ total: 1_000_000 }),
        ],
      }),
    ],
    invoices: [
      // 1 emitida por 5M c/IVA (cobrado parcial)
      mockInvoice({ type: "emitida", netAmount: 4_201_681, iva: 798_319, totalAmount: 5_000_000 }),
    ],
  });
  const m = computeProjectMetrics(project);
  // totalAcordado = obraTotal (c/IVA al cliente)
  //   = 1.000.000 * 1.20 (GG) * 1.05 (Util) * 1.19 (IVA) = 1.499.400
  const expectedAcordado = 1_000_000 * 1.20 * 1.05 * 1.19;
  assertEq(m.totalAcordado, expectedAcordado, "totalAcordado = obra c/IVA + muebles + artefactos");
  // totalCobrado = totalAmount de emitidas (c/IVA)
  assertEq(m.totalCobrado, 5_000_000, "totalCobrado suma totalAmount (c/IVA)");
}

// ───────────────────────────────────────────────────────────────────────
// Test 3: utilidad real
// ───────────────────────────────────────────────────────────────────────
console.log("\nTest 3: Utilidad real = cobrado − gastado − pagos maestros");
{
  const project = mockProject({
    invoices: [
      // Cobrado 5M c/IVA
      mockInvoice({ type: "emitida", netAmount: 4_201_681, iva: 798_319, totalAmount: 5_000_000 }),
      // Gastado 2M neto (2.380.000 c/IVA)
      mockInvoice({ type: "recibida", netAmount: 2_000_000, iva: 380_000, totalAmount: 2_380_000 }),
    ],
  });
  const m = computeProjectMetrics(project);
  // utilidadReal = 5.000.000 - 2.000.000 - 0 (sin pagos a maestros) = 3.000.000
  assertEq(m.utilidadReal, 3_000_000, "utilidadReal = cobrado − gastado − pagos maestros");
}

// ───────────────────────────────────────────────────────────────────────
// Test 4: caso borde — proyecto sin nada
// ───────────────────────────────────────────────────────────────────────
console.log("\nTest 4: Proyecto vacío — debe devolver 0, no explotar");
{
  const project = mockProject({
    invoices: [],
    budgetVersions: [],
    estadosPago: [],
  });
  const m = computeProjectMetrics(project);
  assertEq(m.totalAcordado, 0, "totalAcordado = 0");
  assertEq(m.totalCobrado, 0, "totalCobrado = 0");
  assertEq(m.totalGastado, 0, "totalGastado = 0");
  assertEq(m.totalPagadoMaestros, 0, "totalPagadoMaestros = 0");
  assertEq(m.utilidadReal, 0, "utilidadReal = 0");
  assertEq(m.pctCobrado, 0, "pctCobrado = 0 (sin division by zero)");
  assertEq(m.avanceObraPct, 0, "avanceObraPct = 0");
  // Sin presupuesto, conceptDeviations devuelve [] (no inventa filas en 0)
  assert(m.conceptDeviations.length === 0, "conceptDeviations vacío sin presupuesto");
  assert(m.alerts.length === 0, "no hay alerts");
}

// ───────────────────────────────────────────────────────────────────────
// Test 5: presupuesto sin aprobar — debe usar el más reciente
// ───────────────────────────────────────────────────────────────────────
console.log("\nTest 5: Sin presupuesto aprobado — fallback al más reciente");
{
  const project = mockProject({
    budgetVersions: [
      mockBudget({
        type: "obra",
        version: "V1",
        status: "borrador",
        createdAt: new Date("2026-01-01"),
        obraItems: [mockObraItem({ total: 500_000 })],
      }),
      mockBudget({
        type: "obra",
        version: "V2",
        status: "borrador",
        createdAt: new Date("2026-03-01"),
        obraItems: [mockObraItem({ total: 1_000_000 })],
      }),
    ],
  });
  const m = computeProjectMetrics(project);
  // Debe usar V2 (más reciente) → 1.000.000 * 1.20 * 1.05 * 1.19 = 1.499.400
  assertEq(m.totalAcordado, 1_000_000 * 1.20 * 1.05 * 1.19, "usa V2 (más reciente) cuando no hay aprobado");
  assert(m.versionLabels.obra === "V2", `versionLabels.obra = "V2" (era ${m.versionLabels.obra})`);
}

// ─── Resumen ───────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`✓ Pasados: ${passed}`);
console.log(`${failed > 0 ? "✗" : " "} Fallidos: ${failed}`);

if (failed > 0) {
  console.log(`\nFallas:`);
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log(`\n✅ Todos los tests pasaron — metrics.ts sigue calculando bien.`);
