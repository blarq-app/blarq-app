import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/facturas/search
//
// Búsqueda dinámica de facturas para imputar a un movimiento bancario.
// Usado por el modal "Asignar Pagos" en /banco/movimientos.
//
// Query params (todos opcionales):
//   q                : texto libre — match en folioNumber, businessName, rutIssuer, rutReceiver
//   type             : "emitida" | "recibida" (filtra al lado correcto del mov)
//   counterpartyRut  : RUT contraparte del mov para "Mismo cliente/proveedor"
//   projectId        : "Mismo proyecto"
//   onlyWithBalance  : "1" para excluir facturas pagadas (default: 1)
//   amount           : monto exacto del mov, para preferir match con saldo cercano
//
// Devuelve top 50 ordenadas por relevancia (saldo más cercano al monto del mov primero,
// fecha más reciente como desempate).

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const type = url.searchParams.get("type");
    const counterpartyRut = url.searchParams.get("counterpartyRut");
    const projectId = url.searchParams.get("projectId");
    const onlyWithBalance = url.searchParams.get("onlyWithBalance") !== "0";
    const amount = url.searchParams.get("amount")
      ? Math.abs(Number(url.searchParams.get("amount")))
      : null;

    const where: Record<string, unknown> = {
      // NC no se "paga", revierte otra factura
      tipoDoc: { not: 61 },
    };
    if (type === "emitida" || type === "recibida") where.type = type;
    if (onlyWithBalance) where.status = { in: ["pendiente", "parcial"] };
    if (projectId) where.projectId = projectId;

    if (q) {
      const orFilters: Record<string, unknown>[] = [
        { folioNumber: { contains: q, mode: "insensitive" } },
        { businessName: { contains: q, mode: "insensitive" } },
        { rutIssuer: { contains: q, mode: "insensitive" } },
        { rutReceiver: { contains: q, mode: "insensitive" } },
      ];
      // Si q es solo números, también buscar en monto exacto
      const num = Number(q.replace(/\D/g, ""));
      if (num > 0) orFilters.push({ totalAmount: num });
      where.OR = orFilters;
    }

    if (counterpartyRut) {
      // counterpartyRut viene tipo "0795239502" del banco. Probamos por
      // contains en ambos lados (rutIssuer si type=recibida, rutReceiver si emitida).
      const digits = counterpartyRut.replace(/\D/g, "");
      // Si type=recibida, el emisor es el proveedor (== contraparte).
      // Si type=emitida, el receptor es el cliente (== contraparte).
      const counterpartyField = type === "emitida" ? "rutReceiver" : "rutIssuer";
      const existingOr = (where.OR as Record<string, unknown>[]) ?? null;
      const rutFilter = { [counterpartyField]: { contains: digits.slice(-8) } };
      // Si ya hay OR (de q), AND con el rutFilter; sino aplicar directo.
      if (existingOr) {
        where.AND = [{ OR: existingOr }, rutFilter];
        delete where.OR;
      } else {
        Object.assign(where, rutFilter);
      }
    }

    const raw = await prisma.invoice.findMany({
      where,
      orderBy: { issueDate: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        tipoDoc: true,
        folioNumber: true,
        businessName: true,
        rutIssuer: true,
        rutReceiver: true,
        totalAmount: true,
        status: true,
        issueDate: true,
        projectId: true,
        project: { select: { name: true, numeroProyecto: true } },
        payments: { select: { amountApplied: true } },
      },
    });

    // Calcular saldo restante en JS (Prisma no agrega bien contra otra columna)
    const enriched = raw.map((inv) => {
      const paid = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
      const remaining = inv.totalAmount - paid;
      return {
        id: inv.id,
        type: inv.type,
        tipoDoc: inv.tipoDoc,
        folioNumber: inv.folioNumber,
        businessName: inv.businessName,
        totalAmount: inv.totalAmount,
        paid,
        remaining,
        status: inv.status,
        issueDate: inv.issueDate.toISOString().slice(0, 10),
        projectName: inv.project
          ? `${inv.project.numeroProyecto ? inv.project.numeroProyecto + " · " : ""}${inv.project.name}`
          : null,
      };
    });

    // Si tenemos amount, ordenar por proximidad de saldo restante al monto del mov.
    // Prioriza match exacto > parcial > excede.
    if (amount && amount > 0) {
      enriched.sort((a, b) => {
        const da = Math.abs(a.remaining - amount);
        const db = Math.abs(b.remaining - amount);
        return da - db;
      });
    }

    return NextResponse.json({ ok: true, facturas: enriched.slice(0, 50) });
  } catch (error) {
    console.error("Error /api/facturas/search:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
