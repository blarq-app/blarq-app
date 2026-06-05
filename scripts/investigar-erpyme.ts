// SOLO LECTURA. Investiga el caso ERPYME: ubicar el movimiento "Compra ERPYME"
// $-43.115 del 27-may-2026 (cta Operativa) y buscar la factura recibida del
// proveedor ERPYME para conciliar. No escribe nada.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // 1) Ubicar el/los movimiento(s) candidatos. Buscamos por glosa "ERPYME"
  //    primero, y aparte por monto -43115 en la cta operativa, por si la
  //    glosa difiere.
  console.log("===== MOVIMIENTOS con 'ERPYME' en la glosa =====");
  const porGlosa = await prisma.bankMovement.findMany({
    where: { description: { contains: "ERPYME", mode: "insensitive" } },
    include: {
      bankAccount: { select: { alias: true, id: true } },
      payments: { select: { id: true, invoiceId: true, amountApplied: true } },
    },
    orderBy: { date: "desc" },
  });
  for (const m of porGlosa) {
    console.log({
      id: m.id,
      cuenta: m.bankAccount.alias,
      bankAccountId: m.bankAccountId,
      date: m.date.toISOString().slice(0, 10),
      amount: m.amount,
      status: m.status,
      category: m.category,
      counterpartyRut: m.counterpartyRut,
      counterpartyName: m.counterpartyName,
      pagos: m.payments.length,
      description: m.description,
    });
  }

  console.log("\n===== MOVIMIENTOS por monto -43115 (±5) cualquier cuenta =====");
  const porMonto = await prisma.bankMovement.findMany({
    where: { amount: { gte: -43120, lte: -43110 } },
    include: { bankAccount: { select: { alias: true } }, payments: { select: { id: true } } },
    orderBy: { date: "desc" },
  });
  for (const m of porMonto) {
    console.log({
      id: m.id,
      cuenta: m.bankAccount.alias,
      date: m.date.toISOString().slice(0, 10),
      amount: m.amount,
      status: m.status,
      pagos: m.payments.length,
      description: m.description,
    });
  }

  // 2) Buscar facturas recibidas de ERPYME por nombre o RUT.
  console.log("\n===== FACTURAS recibidas con 'ERPYME' en businessName =====");
  const facByNombre = await prisma.invoice.findMany({
    where: { type: "recibida", businessName: { contains: "ERPYME", mode: "insensitive" } },
    select: {
      id: true, folioNumber: true, tipoDoc: true, rutIssuer: true, businessName: true,
      issueDate: true, totalAmount: true, status: true, projectId: true, categoryId: true,
      payments: { select: { id: true, amountApplied: true } },
    },
    orderBy: { issueDate: "desc" },
  });
  for (const f of facByNombre) {
    console.log({
      id: f.id, folio: f.folioNumber, tipoDoc: f.tipoDoc, rut: f.rutIssuer,
      nombre: f.businessName, fecha: f.issueDate.toISOString().slice(0, 10),
      total: f.totalAmount, status: f.status, pagos: f.payments.length,
    });
  }

  // 3) Por si el nombre del comercio en la factura no es "ERPYME" sino el
  //    proveedor real: buscar facturas recibidas de monto cercano a 43.115
  //    en ventana de fecha (±31 días del 2026-05-27).
  console.log("\n===== FACTURAS recibidas monto 43115 (±50) cualquier nombre =====");
  const facByMonto = await prisma.invoice.findMany({
    where: { type: "recibida", totalAmount: { gte: 43065, lte: 43165 } },
    select: {
      id: true, folioNumber: true, tipoDoc: true, rutIssuer: true, businessName: true,
      issueDate: true, totalAmount: true, status: true,
      payments: { select: { id: true } },
    },
    orderBy: { issueDate: "desc" },
  });
  for (const f of facByMonto) {
    console.log({
      id: f.id, folio: f.folioNumber, tipoDoc: f.tipoDoc, rut: f.rutIssuer,
      nombre: f.businessName, fecha: f.issueDate.toISOString().slice(0, 10),
      total: f.totalAmount, status: f.status, pagos: f.payments.length,
    });
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
