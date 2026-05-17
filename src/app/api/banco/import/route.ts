import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseCartolaSantander } from "@/lib/banco/santanderParser";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";
import { applyRulesToMovement } from "@/lib/banco/categorizationRules";

// Detecta si un movimiento ya está en la BD.
//
// Regla: el identificador estable de una transacción es el saldo
// posterior (`balanceAfter`) — el saldo de la cuenta una vez aplicado el
// movimiento. Es un número absoluto que no depende del formato de
// cartola. Antes el check usaba el n° de documento (`externalRef`), pero
// la cartola Histórica lo trae y la Provisoria lo trae en cero: por eso
// reimportar la misma cartola en el otro formato duplicaba todo (bug
// detectado 2026-05-17).
//
// DOS transferencias del mismo monto el mismo día NO se confunden: cada
// una deja la cuenta en un saldo distinto, así que tienen balanceAfter
// distinto.
async function findExistingMovement(
  bankAccountId: string,
  mov: { date: Date; amount: number; balanceAfter: number }
) {
  return prisma.bankMovement.findFirst({
    where: {
      bankAccountId,
      date: mov.date,
      amount: mov.amount,
      balanceAfter: mov.balanceAfter,
    },
  });
}

// POST /api/banco/import
//   body: form-data con `file` (Excel cartola Santander)
//   query: ?dryRun=1 para preview sin guardar
//
// Flujo:
//   1. Lee el Excel y extrae movimientos.
//   2. Identifica la cuenta por accountNumber (tiene que estar pre-creada
//      en BankAccount — las 2 BLARQ ya están seeded).
//   3. Inserta los movimientos. Idempotente: el unique
//      (bankAccountId, date, amount, balanceAfter) impide duplicados al
//      reimportar la misma cartola, en cualquiera de los dos formatos.
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
        const exists = await findExistingMovement(bankAccount.id, mov);
        if (exists) stats.duplicates++;
        else stats.created++;
        if (mov.suggestedCategory) stats.categorized++;
      }
      return NextResponse.json({ ok: true, stats, sample: cartola.movements.slice(0, 5) });
    }

    // 3. Insertar movimientos (skip duplicates). El check de duplicado es
    // EXPLÍCITO (findExistingMovement) — el constraint de la BD queda como
    // segunda barrera, pero la decisión real de saltar un duplicado la
    // toma este check antes de intentar el insert.
    const insertedIds: string[] = [];
    for (const mov of cartola.movements) {
      const exists = await findExistingMovement(bankAccount.id, mov);
      if (exists) {
        stats.duplicates++;
        continue;
      }
      try {
        const created = await prisma.bankMovement.create({
          data: {
            bankAccountId: bankAccount.id,
            date: mov.date,
            description: mov.description,
            amount: mov.amount,
            type: mov.type,
            balanceAfter: mov.balanceAfter,
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
        // P2002 = unique violation. Con el check explícito de arriba esto
        // casi no debería pasar — solo si dos movimientos de la MISMA
        // cartola coinciden en (cuenta,fecha,monto,balanceAfter).
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

    // 5. Auto-matching contra facturas pendientes y parciales.
    // Compara contra el SALDO restante (totalAmount − Σ payments existentes),
    // no solo contra totalAmount. Eso cubre el caso "factura $15M cobrada en
    // cuotas de $5M+$10M" — la segunda transferencia ($10M) matchea con el
    // saldo restante.
    for (const movId of insertedIds) {
      const mov = await prisma.bankMovement.findUnique({
        where: { id: movId },
        include: { payments: true },
      });
      if (!mov || mov.status === "interno") continue;
      // Si ya tiene imputación parcial o total, saltar.
      if (mov.payments.length > 0) continue;

      // Cargo → buscar factura recibida pendiente/parcial del proveedor
      // Abono → buscar factura emitida pendiente/parcial al cliente
      const isCargo = mov.amount < 0;
      const targetType = isCargo ? "recibida" : "emitida";
      const absAmount = Math.abs(mov.amount);

      // Traemos candidatos cuyo totalAmount es ≥ al monto del mov (para que
      // el saldo restante pueda matchear) y filtramos en JS por saldo.
      const rawCandidates = await prisma.invoice.findMany({
        where: {
          type: targetType,
          status: { in: ["pendiente", "parcial"] },
          tipoDoc: { not: 61 }, // NCs no se "pagan", revierten otra factura
          totalAmount: { gte: absAmount - 10 },
        },
        select: {
          id: true,
          rutIssuer: true,
          rutReceiver: true,
          businessName: true,
          totalAmount: true,
          payments: { select: { amountApplied: true } },
        },
      });

      // Filtrar por saldo restante dentro de tolerancia.
      const candidates = rawCandidates
        .map((c) => {
          const paid = c.payments.reduce((s, p) => s + p.amountApplied, 0);
          return { ...c, remaining: c.totalAmount - paid };
        })
        .filter((c) => c.remaining >= absAmount - 10 && c.remaining <= absAmount + 10);

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

      // Crear el InvoicePayment con el monto exacto del movimiento.
      // El status de la factura lo deriva recomputeInvoiceStatus.
      await prisma.invoicePayment.create({
        data: {
          bankMovementId: mov.id,
          invoiceId: match.id,
          amountApplied: absAmount,
        },
      });
      await prisma.bankMovement.update({
        where: { id: mov.id },
        data: { status: "conciliado" },
      });
      await recomputeInvoiceStatus(match.id);
      stats.autoMatchedInvoices++;
    }

    // 5b. Reglas de auto-categorización: para cada mov que sigue
    // sin_asignar después del auto-match, aplicar reglas guardadas.
    let rulesApplied = 0;
    for (const movId of insertedIds) {
      const r = await applyRulesToMovement(movId);
      if (r.applied) rulesApplied++;
    }
    (stats as { rulesApplied?: number }).rulesApplied = rulesApplied;

    // 6. Actualizar saldo conocido de la cuenta. Solo si la cartola es más
    // reciente que el último saldo guardado — así re-importar una cartola
    // vieja no pisa el saldo más nuevo.
    const cartolaFechaHasta = cartola.fechaHasta;
    if (cartolaFechaHasta && cartola.saldoFinal > 0) {
      const isNewer =
        !bankAccount.lastKnownBalanceDate ||
        cartolaFechaHasta > bankAccount.lastKnownBalanceDate;
      if (isNewer) {
        await prisma.bankAccount.update({
          where: { id: bankAccount.id },
          data: {
            lastKnownBalance: cartola.saldoFinal,
            lastKnownBalanceDate: cartolaFechaHasta,
          },
        });
      }
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
