// Tests sobre las funciones de auto-categorización y conciliación:
//   - applyInvoiceRule           (lib/facturas/categorizationRules.ts)
//   - upsertInvoiceRule          (idem) — incluye aplicación retroactiva
//   - recomputeInvoiceStatus     (lib/banco/invoicePayments.ts)
//   - applyRulesToMovement       (lib/banco/categorizationRules.ts)
//   - upsertRuleFromMovement     (idem)
//   - suggestRulePattern         (idem) — pura, no DB
//
// Estas funciones son el motor del flujo "MJ asigna una factura → la regla
// contagia a las próximas + a las viejas sin categoría". Cualquier regresión
// silenciosa rompe la promesa: facturas nuevas que llegan sin clasificar,
// o que se sobreescribe la categoría manual de MJ.
//
// Patrón: usa la dev DB pero con MARKERS únicos (tipoDoc=999, RUTs 9999XXXX,
// patterns con prefijo __test_) para no chocar con data real. Cleanup
// idempotente al inicio y al final.
//
// Correr: npx tsx scripts/test-rules.ts

import { prisma } from "../src/lib/prisma";
import {
  applyInvoiceRule,
  upsertInvoiceRule,
} from "../src/lib/facturas/categorizationRules";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";
import {
  applyRulesToMovement,
  upsertRuleFromMovement,
  suggestRulePattern,
} from "../src/lib/banco/categorizationRules";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label} — esperado ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`;
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

// Markers para cleanup idempotente.
const TEST_TIPODOC = 999;
const TEST_RUT_PREFIX = "9999"; // RUTs 99990001-1 .. 99990009-9
const TEST_PATTERN_PREFIX = "__test_";

// Nombre marcador para las reglas internacionales de test (rutIssuer null →
// no las agarra el filtro por RUT del cleanup).
const TEST_INTL_PREFIX = "__test_intl_";

async function cleanup() {
  await prisma.invoice.deleteMany({ where: { tipoDoc: TEST_TIPODOC } });
  await prisma.invoiceCategorizationRule.deleteMany({
    where: { rutIssuer: { startsWith: TEST_RUT_PREFIX } },
  });
  // Reglas internacionales de test (por nombre, sin RUT).
  await prisma.invoiceCategorizationRule.deleteMany({
    where: { providerName: { startsWith: TEST_INTL_PREFIX } },
  });
  await prisma.bankCategorizationRule.deleteMany({
    where: { descriptionPattern: { startsWith: TEST_PATTERN_PREFIX } },
  });
  await prisma.bankMovement.deleteMany({
    where: { description: { startsWith: TEST_PATTERN_PREFIX } },
  });
}

async function main() {
  await cleanup();

  // Resolver IDs de fixtures dependientes (usamos data real existente).
  const cat = await prisma.costCategory.findFirst({
    where: { name: "Materiales", parentId: null },
  });
  if (!cat) throw new Error("No existe categoría 'Materiales' — abortar.");
  const cat2 = await prisma.costCategory.findFirst({
    where: { name: "Mano de obra", parentId: null },
  });
  if (!cat2) throw new Error("No existe categoría 'Mano de obra' — abortar.");
  const account = await prisma.bankAccount.findFirst();
  if (!account) throw new Error("No hay BankAccount para tests — abortar.");

  // ─────────────────────────────────────────────────────────────────────
  // suggestRulePattern (pura)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nsuggestRulePattern:");
  assertEq(
    suggestRulePattern("0772707339 Transf de Maria"),
    "Transf de Maria",
    "salta prefijo numérico, toma 3 palabras",
  );
  assertEq(
    suggestRulePattern("Compra SODIMAC LAS CONDES"),
    "Compra SODIMAC LAS",
    "sin prefijo numérico, primeras 3 palabras",
  );
  assertEq(
    suggestRulePattern("PAGO"),
    "PAGO",
    "una sola palabra → la usa entera",
  );
  assertEq(
    suggestRulePattern("12345 67890"),
    "12345 67890",
    "todo numérico → fallback a primeros 30 chars (no inventa patrón vacío)",
  );

  // ─────────────────────────────────────────────────────────────────────
  // applyInvoiceRule
  // ─────────────────────────────────────────────────────────────────────
  console.log("\napplyInvoiceRule:");
  {
    // Caso 1: factura recibida sin categoría + regla existente → aplica.
    const rut = `${TEST_RUT_PREFIX}0001-1`;
    await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer: rut, businessName: "PROVEEDOR TEST 1", categoryId: cat.id, hits: 5 },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "recibida",
        tipoDoc: TEST_TIPODOC,
        folioNumber: "1",
        rutIssuer: rut,
        rutReceiver: "77270733-9",
        businessName: "PROVEEDOR TEST 1",
        issueDate: new Date(),
        netAmount: 1000,
        iva: 190,
        totalAmount: 1190,
        status: "pendiente",
        origin: "manual",
      },
    });
    const r = await applyInvoiceRule(inv.id);
    assert(r.applied, "aplica cuando hay regla y categoryId=null");
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.categoryId, cat.id, "categoryId queda seteada");
    const rule = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: rut } });
    assertEq(rule?.hits, 6, "hits incrementa de 5 a 6");
  }

  {
    // Caso 2: factura ya tiene categoría → NO aplica (respeta decisión manual).
    const rut = `${TEST_RUT_PREFIX}0002-2`;
    await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer: rut, businessName: "P2", categoryId: cat.id, hits: 1 },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "recibida",
        tipoDoc: TEST_TIPODOC,
        folioNumber: "2",
        rutIssuer: rut,
        rutReceiver: "77270733-9",
        businessName: "P2",
        issueDate: new Date(),
        netAmount: 1000,
        iva: 190,
        totalAmount: 1190,
        status: "pendiente",
        origin: "manual",
        categoryId: cat2.id, // ya clasificada manualmente
      },
    });
    const r = await applyInvoiceRule(inv.id);
    assert(!r.applied, "no aplica si ya tiene categoryId");
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.categoryId, cat2.id, "categoryId manual NO se sobrescribe");
  }

  {
    // Caso 3: factura emitida → SÍ aplica. applyInvoiceRule está diseñada
    // para recibidas Y emitidas (ver su docstring: las emitidas usan project
    // rules porque el RUT del cliente identifica el proyecto). No filtra por
    // tipo. Esta aserción se corrigió: antes esperaba "no aplica", reflejando
    // un comportamiento viejo que el código ya no tiene.
    const rut = `${TEST_RUT_PREFIX}0003-3`;
    await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer: rut, businessName: "P3", categoryId: cat.id, hits: 1 },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "emitida", // <<<
        tipoDoc: TEST_TIPODOC,
        folioNumber: "3",
        rutIssuer: rut,
        rutReceiver: "77270733-9",
        businessName: "P3",
        issueDate: new Date(),
        netAmount: 1000,
        iva: 190,
        totalAmount: 1190,
        status: "pendiente",
        origin: "manual",
      },
    });
    const r = await applyInvoiceRule(inv.id);
    assert(r.applied, "aplica también a emitidas (por diseño, no filtra por tipo)");
  }

  // ─────────────────────────────────────────────────────────────────────
  // upsertInvoiceRule (incluye aplicación retroactiva)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nupsertInvoiceRule (retroactivo):");
  {
    // Caso 4: regla nueva → retro toca solo las del MISMO RUT con categoryId=null.
    const rut = `${TEST_RUT_PREFIX}0004-4`;
    const otroRut = `${TEST_RUT_PREFIX}0014-4`;
    // 2 facturas mismo RUT sin categoría
    await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "4a",
        rutIssuer: rut, rutReceiver: "77270733-9", businessName: "P4",
        issueDate: new Date(), netAmount: 1000, iva: 190, totalAmount: 1190,
        status: "pendiente", origin: "manual",
      },
    });
    await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "4b",
        rutIssuer: rut, rutReceiver: "77270733-9", businessName: "P4",
        issueDate: new Date(), netAmount: 2000, iva: 380, totalAmount: 2380,
        status: "pendiente", origin: "manual",
      },
    });
    // 1 factura mismo RUT con OTRA categoría → no debe tocarse
    const respetada = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "4c",
        rutIssuer: rut, rutReceiver: "77270733-9", businessName: "P4",
        issueDate: new Date(), netAmount: 3000, iva: 570, totalAmount: 3570,
        status: "pendiente", origin: "manual",
        categoryId: cat2.id, // decisión manual previa
      },
    });
    // 1 factura OTRO RUT sin categoría → no debe tocarse (RUT distinto)
    const otroProveedor = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "4d",
        rutIssuer: otroRut, rutReceiver: "77270733-9", businessName: "P14",
        issueDate: new Date(), netAmount: 4000, iva: 760, totalAmount: 4760,
        status: "pendiente", origin: "manual",
      },
    });

    const r = await upsertInvoiceRule(rut, "P4", { categoryId: cat.id });
    assert(r.created, "crea la regla nueva");
    assertEq(r.appliedRetroactively, 2, "retroactivamente toca 2 (las del mismo RUT con null)");

    const respetadaAfter = await prisma.invoice.findUnique({ where: { id: respetada.id } });
    assertEq(respetadaAfter?.categoryId, cat2.id, "respeta categoría manual previa del mismo RUT");

    const otroAfter = await prisma.invoice.findUnique({ where: { id: otroProveedor.id } });
    assertEq(otroAfter?.categoryId, null, "no toca facturas de otros RUTs");
  }

  {
    // Caso 5: regla existe con MISMA categoría → solo incrementa hits, retro funciona igual.
    const rut = `${TEST_RUT_PREFIX}0005-5`;
    await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer: rut, businessName: "P5", categoryId: cat.id, hits: 3 },
    });
    await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "5a",
        rutIssuer: rut, rutReceiver: "77270733-9", businessName: "P5",
        issueDate: new Date(), netAmount: 1000, iva: 190, totalAmount: 1190,
        status: "pendiente", origin: "manual",
      },
    });
    const r = await upsertInvoiceRule(rut, "P5", { categoryId: cat.id });
    assert(!r.created && !r.updated, "ni crea ni actualiza categoría");
    assertEq(r.appliedRetroactively, 1, "retro aplica al null pendiente");
    const ruleAfter = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: rut } });
    assertEq(ruleAfter?.hits, 4, "hits incrementa 3→4");
  }

  {
    // Caso 6: regla existe con OTRA categoría → cambia + resetea hits + retro
    // re-clasifica TODAS las del RUT con null al nuevo valor.
    const rut = `${TEST_RUT_PREFIX}0006-6`;
    await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer: rut, businessName: "P6", categoryId: cat.id, hits: 8 },
    });
    await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "6a",
        rutIssuer: rut, rutReceiver: "77270733-9", businessName: "P6",
        issueDate: new Date(), netAmount: 1000, iva: 190, totalAmount: 1190,
        status: "pendiente", origin: "manual",
      },
    });
    const r = await upsertInvoiceRule(rut, "P6", { categoryId: cat2.id });
    assert(r.updated, "marca updated cuando cambia categoría");
    assertEq(r.appliedRetroactively, 1, "retro toca el null con la NUEVA categoría");
    const ruleAfter = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: rut } });
    assertEq(ruleAfter?.categoryId, cat2.id, "regla apunta a la nueva categoría");
    assertEq(ruleAfter?.hits, 1, "hits se resetea a 1");
  }

  // ─────────────────────────────────────────────────────────────────────
  // INTERNACIONALES sin RUT — regla por nombre exacto (Google Workspace, etc.)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nreglas internacionales (sin RUT, por nombre):");
  {
    // Caso 7: upsertInvoiceRule sin RUT crea regla por nombre y aplica
    // retroactivamente SOLO a las facturas del mismo nombre exacto sin RUT.
    const name = `${TEST_INTL_PREFIX}Google Workspace`;
    const otroName = `${TEST_INTL_PREFIX}Anthropic`;
    // 2 facturas sin RUT mismo nombre, sin categoría
    for (const folio of ["7a", "7b"]) {
      await prisma.invoice.create({
        data: {
          type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: folio,
          rutIssuer: null, rutReceiver: "77270733-9", businessName: name,
          issueDate: new Date(), netAmount: 1000, iva: 190, totalAmount: 1190,
          status: "pendiente", origin: "gasto_internacional",
        },
      });
    }
    // 1 factura sin RUT del mismo nombre pero ya categorizada → no se toca
    const respetada = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "7c",
        rutIssuer: null, rutReceiver: "77270733-9", businessName: name,
        issueDate: new Date(), netAmount: 2000, iva: 380, totalAmount: 2380,
        status: "pendiente", origin: "gasto_internacional", categoryId: cat2.id,
      },
    });
    // 1 factura sin RUT de OTRO nombre → no se toca (nombre distinto)
    const otroIntl = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "7d",
        rutIssuer: null, rutReceiver: "77270733-9", businessName: otroName,
        issueDate: new Date(), netAmount: 3000, iva: 570, totalAmount: 3570,
        status: "pendiente", origin: "gasto_internacional",
      },
    });
    // 1 factura CON RUT que casualmente comparte el nombre → no se toca
    // (el match sin RUT exige rutIssuer null; ésta tiene RUT).
    const conRut = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "7e",
        rutIssuer: `${TEST_RUT_PREFIX}0077-7`, rutReceiver: "77270733-9", businessName: name,
        issueDate: new Date(), netAmount: 4000, iva: 760, totalAmount: 4760,
        status: "pendiente", origin: "manual",
      },
    });

    const r = await upsertInvoiceRule(null, name, { categoryId: cat.id });
    assert(r.created, "crea la regla internacional (por nombre)");
    assert(r.ruleId !== null, "devuelve ruleId (no null)");
    assertEq(r.appliedRetroactively, 2, "retro toca las 2 del mismo nombre sin RUT");

    const respetadaAfter = await prisma.invoice.findUnique({ where: { id: respetada.id } });
    assertEq(respetadaAfter?.categoryId, cat2.id, "respeta categoría manual previa (mismo nombre)");
    const otroAfter = await prisma.invoice.findUnique({ where: { id: otroIntl.id } });
    assertEq(otroAfter?.categoryId, null, "no toca facturas de otro nombre");
    const conRutAfter = await prisma.invoice.findUnique({ where: { id: conRut.id } });
    assertEq(conRutAfter?.categoryId, null, "no toca facturas del mismo nombre que SÍ tienen RUT");

    // La regla se guardó por providerName, no por rutIssuer.
    const rule = await prisma.invoiceCategorizationRule.findUnique({ where: { providerName: name } });
    assert(rule !== null, "regla existe con providerName");
    assertEq(rule?.rutIssuer, null, "regla internacional tiene rutIssuer null");
  }

  {
    // Caso 8: applyInvoiceRule matchea por nombre cuando la factura no tiene RUT.
    const name = `${TEST_INTL_PREFIX}Neon Inc`;
    await prisma.invoiceCategorizationRule.create({
      data: { providerName: name, businessName: name, categoryId: cat.id, hits: 2 },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "recibida", tipoDoc: TEST_TIPODOC, folioNumber: "8a",
        rutIssuer: null, rutReceiver: "77270733-9", businessName: name,
        issueDate: new Date(), netAmount: 1000, iva: 190, totalAmount: 1190,
        status: "pendiente", origin: "gasto_internacional",
      },
    });
    const applied = await applyInvoiceRule(inv.id);
    assert(applied.applied, "applyInvoiceRule aplica por nombre a factura sin RUT");
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.categoryId, cat.id, "categoría queda seteada por la regla de nombre");
    const ruleAfter = await prisma.invoiceCategorizationRule.findUnique({ where: { providerName: name } });
    assertEq(ruleAfter?.hits, 3, "hits incrementa 2→3");
  }

  {
    // Caso 9: sin RUT ni nombre → no se puede identificar proveedor, no crea regla.
    const r = await upsertInvoiceRule(null, null, { categoryId: cat.id });
    assert(!r.created && !r.updated, "no crea regla sin RUT ni nombre");
    assertEq(r.ruleId, null, "ruleId null cuando no hay proveedor");
    assertEq(r.appliedRetroactively, 0, "no toca ninguna factura");
  }

  // ─────────────────────────────────────────────────────────────────────
  // recomputeInvoiceStatus
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nrecomputeInvoiceStatus:");
  {
    // Caso 7: 0 pagos → pendiente
    const inv = await prisma.invoice.create({
      data: {
        type: "emitida", tipoDoc: TEST_TIPODOC, folioNumber: "7a",
        rutIssuer: "77270733-9", rutReceiver: `${TEST_RUT_PREFIX}0007-7`,
        businessName: "BLARQ", issueDate: new Date(),
        netAmount: 100000, iva: 19000, totalAmount: 119000,
        status: "parcial", origin: "manual",
      },
    });
    await recomputeInvoiceStatus(inv.id);
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.status, "pendiente", "0 pagos → status=pendiente");
    assertEq(after?.paidAt, null, "sin paidAt");
  }

  {
    // Caso 8: pago parcial → parcial
    const mov = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date("2026-04-15"),
        description: `${TEST_PATTERN_PREFIX}mov_parcial`,
        amount: 50000,
        type: "abono",
      },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "emitida", tipoDoc: TEST_TIPODOC, folioNumber: "8a",
        rutIssuer: "77270733-9", rutReceiver: `${TEST_RUT_PREFIX}0008-8`,
        businessName: "BLARQ", issueDate: new Date(),
        netAmount: 100000, iva: 19000, totalAmount: 119000,
        status: "pendiente", origin: "manual",
      },
    });
    await prisma.invoicePayment.create({
      data: { bankMovementId: mov.id, invoiceId: inv.id, amountApplied: 50000 },
    });
    await recomputeInvoiceStatus(inv.id);
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.status, "parcial", "0 < imputado < total → parcial");
    assertEq(after?.paidAt, null, "parcial no setea paidAt");
  }

  {
    // Caso 9: pago completo (varios movs) → pagada con paidAt = max(date)
    const m1 = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date("2026-04-10"),
        description: `${TEST_PATTERN_PREFIX}mov_pagada1`,
        amount: 60000, type: "abono",
      },
    });
    const m2 = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date("2026-04-20"), // más reciente — debe ganar
        description: `${TEST_PATTERN_PREFIX}mov_pagada2`,
        amount: 59000, type: "abono",
      },
    });
    const inv = await prisma.invoice.create({
      data: {
        type: "emitida", tipoDoc: TEST_TIPODOC, folioNumber: "9a",
        rutIssuer: "77270733-9", rutReceiver: `${TEST_RUT_PREFIX}0009-9`,
        businessName: "BLARQ", issueDate: new Date(),
        netAmount: 100000, iva: 19000, totalAmount: 119000,
        status: "pendiente", origin: "manual",
      },
    });
    await prisma.invoicePayment.createMany({
      data: [
        { bankMovementId: m1.id, invoiceId: inv.id, amountApplied: 60000 },
        { bankMovementId: m2.id, invoiceId: inv.id, amountApplied: 59000 },
      ],
    });
    await recomputeInvoiceStatus(inv.id);
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.status, "pagada", "imputado >= total → pagada");
    assertEq(
      after?.paidAt?.toISOString(),
      new Date("2026-04-20").toISOString(),
      "paidAt = fecha del último mov (no del primero)",
    );
  }

  {
    // Caso 10: status="anulada" no se toca aunque tenga pagos.
    const inv = await prisma.invoice.create({
      data: {
        type: "emitida", tipoDoc: TEST_TIPODOC, folioNumber: "10a",
        rutIssuer: "77270733-9", rutReceiver: `${TEST_RUT_PREFIX}0010-0`,
        businessName: "BLARQ", issueDate: new Date(),
        netAmount: 100000, iva: 19000, totalAmount: 119000,
        status: "anulada", origin: "manual",
      },
    });
    await recomputeInvoiceStatus(inv.id);
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    assertEq(after?.status, "anulada", "anulada no se recalcula");
  }

  // ─────────────────────────────────────────────────────────────────────
  // applyRulesToMovement + upsertRuleFromMovement
  // ─────────────────────────────────────────────────────────────────────
  console.log("\napplyRulesToMovement / upsertRuleFromMovement:");
  {
    // Caso 11: regla matchea descripción (case-insensitive substring) → categoriza.
    await prisma.bankCategorizationRule.create({
      data: {
        descriptionPattern: `${TEST_PATTERN_PREFIX}previred`,
        category: "previred",
        hits: 2,
      },
    });
    const mov = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date(),
        description: `Algo ${TEST_PATTERN_PREFIX}PREVIRED algo`,
        amount: -100000, type: "cargo",
      },
    });
    const r = await applyRulesToMovement(mov.id);
    assert(r.applied, "matchea por substring case-insensitive");
    assertEq(r.category, "previred", "categoría correcta");
    const after = await prisma.bankMovement.findUnique({ where: { id: mov.id } });
    assertEq(after?.category, "previred", "mov.category seteada");
    assertEq(after?.status, "sin_factura", "status pasa a sin_factura");
  }

  {
    // Caso 12: mov ya conciliado → no aplica.
    const mov = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date(),
        description: `${TEST_PATTERN_PREFIX}previred match`,
        amount: -100, type: "cargo",
        status: "conciliado",
      },
    });
    const r = await applyRulesToMovement(mov.id);
    assert(!r.applied, "no aplica si status != sin_asignar");
  }

  {
    // Caso 13: upsertRuleFromMovement crea regla con primeras 3 palabras significativas.
    const desc = `0772707339 ${TEST_PATTERN_PREFIX}sueldo MJ extra`;
    const r = await upsertRuleFromMovement(desc, "sueldo");
    assertEq(r.rulePattern, `${TEST_PATTERN_PREFIX}sueldo MJ extra`, "patrón derivado de 3 palabras");
    const rule = await prisma.bankCategorizationRule.findFirst({
      where: { descriptionPattern: r.rulePattern, category: "sueldo" },
    });
    assert(rule !== null, "regla creada en BD");
    // Llamarla 2da vez → incrementa hits, no duplica.
    await upsertRuleFromMovement(desc, "sueldo");
    const ruleAfter = await prisma.bankCategorizationRule.findFirst({
      where: { descriptionPattern: r.rulePattern, category: "sueldo" },
    });
    assertEq(ruleAfter?.hits, 2, "segunda invocación incrementa hits a 2");
  }

  await cleanup();

  // ─── Resumen ─────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`✓ Pasados: ${passed}`);
  console.log(`${failed > 0 ? "✗" : " "} Fallidos: ${failed}`);

  if (failed > 0) {
    console.log(`\nFallas:`);
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  console.log(`\n✅ Todos los tests pasaron — motor de reglas y pagos OK.`);
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
