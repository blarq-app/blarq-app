import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseCartolaSantander } from "@/lib/banco/santanderParser";
import { tryAutoMatchMovementWithInvoices } from "@/lib/banco/invoicePayments";
import { applyRulesToMovement } from "@/lib/banco/categorizationRules";
import { planImportDedup } from "@/lib/banco/dedup";
import { requireSession } from "@/lib/apiAuth";
import { esSocio } from "@/lib/banco/socios";
import { MOV_STATUS } from "@/lib/banco/movementStatus";

// El dedup del import vive en `planImportDedup` (src/lib/banco/dedup.ts).
// Identifica cada movimiento por una huella estable (fecha + monto +
// contraparte) que NO depende del saldo corrido `balanceAfter`. Hasta el
// bug 2026-06-02 el dedup usaba balanceAfter como llave; era frágil cuando
// dos cartolas del mismo período traían sets de movimientos distintos
// (la Provisoria es un snapshot incompleto: le faltan compras que settlean
// después), porque eso corre el saldo reconstruido y desincroniza la llave.
// Ver el comentario extenso en dedup.ts.

// POST /api/banco/import
//   body: form-data con `file` (Excel cartola Santander)
//   query: ?dryRun=1 para preview sin guardar
//
// Flujo:
//   1. Lee el Excel y extrae movimientos.
//   2. Identifica la cuenta por accountNumber (tiene que estar pre-creada
//      en BankAccount — las 2 BLARQ ya están seeded).
//   3. Inserta los movimientos. Idempotente: `planImportDedup` reconoce los
//      que ya existen por huella estable (no por saldo corrido), así que
//      reimportar una cartola que se solapa no duplica, aunque sea de otro
//      formato o un snapshot incompleto.
//   4. Auto-detecta transferencias internas: para cada movimiento marcado
//      como isInternalCandidate, busca el contraparte (mismo monto, sentido
//      opuesto, ±1 día) en LA OTRA cuenta y los linkea.
//   5. Auto-conciliación: cargos contra facturas recibidas pendientes,
//      abonos contra facturas emitidas pendientes (mismo RUT contraparte
//      + monto exacto, ±15 días).
//   6. Devuelve resumen.

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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

    // Dedup por huella estable: traemos los movimientos ya guardados de la
    // cuenta en el rango de fechas de la cartola y dejamos que
    // `planImportDedup` decida cuáles son nuevos y cuáles ya existen
    // (preservando gemelos legítimos por conteo). Acotamos por rango de
    // fechas para no cargar toda la historia de la cuenta.
    let toInsert = cartola.movements;
    let duplicateCount = 0;
    if (cartola.movements.length > 0) {
      const times = cartola.movements.map((m) => m.date.getTime());
      const minDate = new Date(Math.min(...times));
      const maxDate = new Date(Math.max(...times));
      const existing = await prisma.bankMovement.findMany({
        where: { bankAccountId: bankAccount.id, date: { gte: minDate, lte: maxDate } },
        select: { date: true, amount: true, description: true },
      });
      const plan = planImportDedup(existing, cartola.movements);
      toInsert = plan.toInsert;
      duplicateCount = plan.duplicates.length;
    }
    stats.duplicates = duplicateCount;

    if (dryRun) {
      // Preview sin tocar DB.
      stats.created = toInsert.length;
      stats.categorized = toInsert.filter((m) => m.suggestedCategory).length;
      return NextResponse.json({ ok: true, stats, sample: cartola.movements.slice(0, 5) });
    }

    // 3. Insertar los movimientos nuevos. El constraint
    // (bankAccountId, date, amount, balanceAfter) queda como segunda barrera;
    // la decisión real de qué es duplicado la tomó `planImportDedup` arriba.
    //
    // Categorías que GENUINAMENTE no llevan documento → nacen "sin_factura".
    // Solo Previred (cotizaciones) y sueldos/retiros a socios. El resto que se
    // categoriza nace "sin_asignar" para entrar a la cola de conciliación:
    //   - comisiones del banco → SÍ tienen factura (del Santander, ya en el
    //     sistema); se concilian.
    //   - depósitos en efectivo → son INGRESOS de clientes; se concilian con
    //     facturas emitidas, no son "sin factura".
    // Decisión MJ 2026-06-03.
    const CATEGORIAS_SIN_DOCUMENTO = new Set(["previred", "sueldo"]);
    const insertedIds: string[] = [];
    for (const mov of toInsert) {
      try {
        // Un "sueldo" sugerido hacia un SOCIO (MJ/JT) ya NO nace archivado como
        // "sin factura": la transferencia puede ser reembolso, bono o retiro, no
        // necesariamente sueldo. Conserva la sugerencia "sueldo" pero queda en
        // estado "sin_asignar" (cola Pendiente) para que MJ la confirme o la
        // cambie — y si es un reembolso, ahí se concilia contra la factura del
        // proveedor. Los sueldos a NO-socios (empleados) y Previred siguen
        // naciendo "sin factura". Decisión MJ 2026-06-19 (opción B).
        const esSueldoSocio =
          mov.suggestedCategory === "sueldo" &&
          esSocio(mov.counterpartyRut, mov.counterpartyName, mov.description);
        const naceSinFactura =
          !!mov.suggestedCategory &&
          CATEGORIAS_SIN_DOCUMENTO.has(mov.suggestedCategory) &&
          !esSueldoSocio;
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
            status: naceSinFactura ? MOV_STATUS.SIN_FACTURA : MOV_STATUS.SIN_ASIGNAR,
          },
        });
        insertedIds.push(created.id);
        stats.created++;
        if (mov.suggestedCategory) stats.categorized++;
      } catch (e) {
        // P2002 = unique violation del constraint
        // (cuenta,fecha,monto,balanceAfter). Con el dedup por huella esto
        // casi no debería pasar; queda como red de seguridad por si dos
        // movimientos terminan con el mismo saldo corrido.
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
            data: { internalTransferToId: counterpart.id, status: MOV_STATUS.INTERNO, category: "transfer_interno" },
          });
          await prisma.bankMovement.update({
            where: { id: counterpart.id },
            data: { internalTransferToId: mov.id, status: MOV_STATUS.INTERNO, category: "transfer_interno" },
          });
          stats.internalTransfersDetected++;
          break;
        }
      }
    }

    // 5. Auto-matching contra facturas pendientes y parciales.
    // Usa la función compartida tryAutoMatchMovementWithInvoices (única
    // fuente de verdad del auto-match mov→factura). Criterio conservador
    // (ADR 2026-05-30 "conciliación conservadora: fecha flexible"):
    //   - El match exige que el RUT de la contraparte calce con el de la
    //     factura, directo o vía alias de reembolsador (persona→empresa).
    //   - La fecha NO filtra ni descarta.
    //   - Si el mov no trae RUT (compra con tarjeta) o el match es ambiguo,
    //     NO concilia: queda sin_asignar para decisión manual.
    // Maneja el saldo restante (cobros en cuotas) y los movs internos/ya
    // imputados internamente. Antes acá había una copia inline con el bug
    // "toma la primera del mismo monto" (pendiente #2 de la auditoría
    // ronda 32) — se eliminó al unificar con la función compartida.
    for (const movId of insertedIds) {
      const r = await tryAutoMatchMovementWithInvoices(movId);
      if (r.matched) stats.autoMatchedInvoices++;
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
