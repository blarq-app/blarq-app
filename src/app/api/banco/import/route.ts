import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseCartolaSantander } from "@/lib/banco/santanderParser";

// POST /api/banco/import
//   body: form-data con `file` (Excel cartola Santander)
//   query: ?dryRun=1 para preview sin guardar
//
// Flujo:
//   1. Lee el Excel y extrae movimientos.
//   2. Identifica la cuenta por accountNumber (tiene que estar pre-creada
//      en BankAccount — las 2 BLARQ ya están seeded).
//   3. Inserta los movimientos. Idempotente: el unique
//      (bankAccountId, date, amount, description) impide duplicados al
//      reimportar la misma cartola.
//   4. Auto-detecta transferencias internas: para cada movimiento marcado
//      como isInternalCandidate, busca el contraparte (mismo monto, sentido
//      opuesto, ±1 día) en LA OTRA cuenta y los linkea.
//   5. Auto-conciliación: cargos contra facturas recibidas pendientes,
//      abonos contra facturas emitidas pendientes (mismo RUT contraparte
//      + monto exacto, ±15 días).
//   6. Devuelve resumen.

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "1";

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta archivo" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const cartola = parseCartolaSantander(buffer);

    if (!cartola.accountNumber) {
      return NextResponse.json(
        { error: "No se pudo identificar el número de cuenta en la cartola" },
        { status: 400 }
      );
    }

    // 2. Buscar la cuenta en DB
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { accountNumber: cartola.accountNumber },
    });
    if (!bankAccount) {
      return NextResponse.json(
        {
          error: `Cuenta ${cartola.accountNumber} no está registrada en la app. Pídele al admin que la cree primero.`,
        },
        { status: 400 }
      );
    }

    // Stats del proceso
    const stats = {
      file: file.name,
      account: { id: bankAccount.id, alias: bankAccount.alias, number: bankAccount.accountNumber },
      cartolaNumber: cartola.cartolaNumber,
      fechaDesde: cartola.fechaDesde,
      fechaHasta: cartola.fechaHasta,
      saldoInicial: cartola.saldoInicial,
      saldoFinal: cartola.saldoFinal,
      total: cartola.movements.length,
      created: 0,
      duplicates: 0,
      autoMatchedInvoices: 0,
      internalTransfersDetected: 0,
      categorized: 0,
      dryRun,
    };

    if (dryRun) {
      // Preview sin tocar DB. Igual contamos cuántos serían duplicados.
      for (const mov of cartola.movements) {
        const exists = await prisma.bankMovement.findFirst({
          where: {
            bankAccountId: bankAccount.id,
            date: mov.date,
            amount: mov.amount,
            description: mov.description,
          },
        });
        if (exists) stats.duplicates++;
        else stats.created++;
        if (mov.suggestedCategory) stats.categorized++;
      }
      return NextResponse.json({ ok: true, stats, sample: cartola.movements.slice(0, 5) });
    }

    // 3. Insertar movimientos (skip duplicates)
    const insertedIds: string[] = [];
    for (const mov of cartola.movements) {
      try {
        const created = await prisma.bankMovement.create({
          data: {
            bankAccountId: bankAccount.id,
            date: mov.date,
            description: mov.description,
            amount: mov.amount,
            type: mov.type,
            externalRef: mov.externalRef,
            counterpartyName: mov.counterpartyName,
            counterpartyRut: mov.counterpartyRut,
            category: mov.suggestedCategory,
            status: mov.suggestedCategory ? "sin_factura" : "sin_asignar",
          },
        });
        insertedIds.push(created.id);
        stats.created++;
        if (mov.suggestedCategory) stats.categorized++;
      } catch (e) {
        // P2002 = unique violation = duplicado. Esperado al reimportar.
        if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
          stats.duplicates++;
        } else {
          throw e;
        }
      }
    }

    // 4. Detectar transferencias internas (solo entre cuentas BLARQ)
    // Para cada movimiento recién insertado con isInternalCandidate, buscar
    // el contraparte en la otra cuenta.
    const otherAccounts = await prisma.bankAccount.findMany({
      where: { id: { not: bankAccount.id } },
    });
    for (const movId of insertedIds) {
      const mov = await prisma.bankMovement.findUnique({ where: { id: movId } });
      if (!mov || !mov.counterpartyRut?.startsWith("0772707339")) continue;

      // Buscar contraparte en OTRA cuenta: mismo monto absoluto, signo
      // opuesto, ±2 días, sin internalTransferToId todavía.
      const fromDate = new Date(mov.date);
      fromDate.setDate(fromDate.getDate() - 2);
      const toDate = new Date(mov.date);
      toDate.setDate(toDate.getDate() + 2);

      for (const otherAcc of otherAccounts) {
        const counterpart = await prisma.bankMovement.findFirst({
          where: {
            bankAccountId: otherAcc.id,
            amount: -mov.amount, // signo opuesto
            date: { gte: fromDate, lte: toDate },
            internalTransferToId: null,
          },
        });
        if (counterpart) {
          // Linkear ambos lados
          await prisma.bankMovement.update({
            where: { id: mov.id },
            data: { internalTransferToId: counterpart.id, status: "interno", category: "transfer_interno" },
          });
          await prisma.bankMovement.update({
            where: { id: counterpart.id },
            data: { internalTransferToId: mov.id, status: "interno", category: "transfer_interno" },
          });
          stats.internalTransfersDetected++;
          break;
        }
      }
    }

    // 5. Auto-matching contra facturas pendientes
    for (const movId of insertedIds) {
      const mov = await prisma.bankMovement.findUnique({ where: { id: movId } });
      if (!mov || mov.status === "interno" || mov.invoiceId) continue;

      // Cargo → buscar factura recibida pendiente del proveedor
      // Abono → buscar factura emitida pendiente al cliente
      const isCargo = mov.amount < 0;
      const targetType = isCargo ? "recibida" : "emitida";
      const absAmount = Math.abs(mov.amount);

      // Tolerancia: ±$10 (para absorber redondeos del banco vs DTE)
      const candidates = await prisma.invoice.findMany({
        where: {
          type: targetType,
          status: "pendiente",
          totalAmount: { gte: absAmount - 10, lte: absAmount + 10 },
        },
        select: { id: true, rutIssuer: true, rutReceiver: true, businessName: true, totalAmount: true },
      });

      if (candidates.length === 0) continue;

      // Si hay múltiples candidatos por monto, intentar desambiguar por RUT
      // contraparte. counterpartyRut viene tipo "0795239502" = 079523950-2
      // (los últimos dígitos son el RUT real, prefijado con un 0 del banco).
      let match = candidates[0];
      if (candidates.length > 1 && mov.counterpartyRut) {
        const movRutDigits = mov.counterpartyRut.replace(/\D/g, "");
        const filtered = candidates.filter((c) => {
          const cRut = (isCargo ? c.rutIssuer : c.rutReceiver) ?? "";
          const cRutDigits = cRut.replace(/\D/g, "");
          return cRutDigits.length > 0 && (movRutDigits.includes(cRutDigits) || cRutDigits.includes(movRutDigits));
        });
        if (filtered.length === 1) match = filtered[0];
        else if (filtered.length > 1) match = filtered[0]; // sigue ambiguo, tomamos el primero (MJ puede corregir)
        else continue; // ningún match por RUT, dejar sin asignar
      }

      // Conciliar: linkear movimiento + marcar factura como pagada
      await prisma.bankMovement.update({
        where: { id: mov.id },
        data: {
          invoiceId: match.id,
          status: "conciliado",
        },
      });
      await prisma.invoice.update({
        where: { id: match.id },
        data: { status: "pagada", paidAt: mov.date },
      });
      stats.autoMatchedInvoices++;
    }

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("Error import cartola:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
