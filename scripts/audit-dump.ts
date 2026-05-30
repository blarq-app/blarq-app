// Dump READ-ONLY para la auditoría de facturas + conciliación (2026-05-29).
//
// Solo `findMany` con `select` explícito — CERO writes, cero migraciones.
// Excluye `Invoice.pdfContent` (Bytes) a propósito: no aporta a la auditoría
// y pesa ~cientos de MB.
//
// Escribe un JSON plano (sin comprimir, legible) en:
//   backups/audit-facturas-conciliacion-<YYYY-MM-DDTHH-MM>.json
// (la carpeta backups/ está gitignored — no se commitea nada con datos.)
//
// Uso (apuntando a PROD, leyendo la URL de un archivo local, NUNCA del chat):
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" \
//     npx tsx scripts/audit-dump.ts
//
// Verificación del entorno: el script imprime a qué branch Neon apunta y
// aborta si no reconoce prod (ep-shy-morning) salvo que pases --force.

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";

function inferEnv(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (/ep-shy-morning/.test(url)) return "prod";
  if (/ep-solitary-mud/.test(url)) return "dev";
  return "unknown";
}

async function main() {
  const env = inferEnv();
  const force = process.argv.includes("--force");
  console.log(`audit-dump — entorno detectado: ${env}`);
  // No imprimir el DATABASE_URL: contiene la contraseña. Solo el host.
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—";
  console.log(`Host: ${host}`);
  if (env !== "prod" && !force) {
    console.error(
      `\nEsperaba prod (ep-shy-morning) y detecté "${env}". ` +
        `La auditoría va contra prod (dev está desactualizado). ` +
        `Si querés correrlo igual, agregá --force.`
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── Facturas (sin pdfContent) ─────────────────────────────────────────
  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      projectId: true,
      categoryId: true,
      type: true,
      tipoDoc: true,
      folioNumber: true,
      rutIssuer: true,
      rutReceiver: true,
      businessName: true,
      issueDate: true,
      dueDate: true,
      netAmount: true,
      iva: true,
      totalAmount: true,
      status: true,
      paidAt: true,
      conceptoCobro: true,
      referenceFolioNumber: true,
      referenceTipoDoc: true,
      compensationType: true,
      appliedToInvoiceId: true,
      refundBankMovementId: true,
      origin: true,
      siiCodigo: true,
      pdfFetchedAt: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // ── Movimientos bancarios ─────────────────────────────────────────────
  const bankMovements = await prisma.bankMovement.findMany({
    select: {
      id: true,
      bankAccountId: true,
      date: true,
      description: true,
      amount: true,
      type: true,
      balanceAfter: true,
      externalRef: true,
      counterpartyName: true,
      counterpartyRut: true,
      category: true,
      internalTransferToId: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // ── Imputaciones (puente N:N) ─────────────────────────────────────────
  const invoicePayments = await prisma.invoicePayment.findMany({
    select: {
      id: true,
      bankMovementId: true,
      invoiceId: true,
      amountApplied: true,
      createdAt: true,
    },
  });

  // ── Cuentas, reembolsadores, proyectos, categorías, reglas ────────────
  const bankAccounts = await prisma.bankAccount.findMany();
  const reembolsadores = await prisma.reembolsador.findMany({
    include: { aliases: true },
  });
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      numeroProyecto: true,
      numeroCotizacion: true,
      name: true,
      clientName: true,
      clientRut: true,
      isInternal: true,
      status: true,
    },
  });
  const costCategories = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, type: true, appliesTo: true },
  });
  const invoiceRules = await prisma.invoiceCategorizationRule.findMany();
  const bankRules = await prisma.bankCategorizationRule.findMany();

  const data = {
    meta: {
      env,
      generatedAt: new Date().toISOString(),
      counts: {
        invoices: invoices.length,
        bankMovements: bankMovements.length,
        invoicePayments: invoicePayments.length,
        bankAccounts: bankAccounts.length,
        reembolsadores: reembolsadores.length,
        projects: projects.length,
        costCategories: costCategories.length,
        invoiceRules: invoiceRules.length,
        bankRules: bankRules.length,
      },
    },
    invoices,
    bankMovements,
    invoicePayments,
    bankAccounts,
    reembolsadores,
    projects,
    costCategories,
    invoiceRules,
    bankRules,
  };

  const dir = join(process.cwd(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const fullPath = join(dir, `audit-facturas-conciliacion-${ts}.json`);
  writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");

  console.log(`\nConteos:`);
  for (const [k, v] of Object.entries(data.meta.counts)) {
    console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}`);
  }
  console.log(`\nEscrito: ${fullPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
