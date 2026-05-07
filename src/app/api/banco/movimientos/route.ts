import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/banco/movimientos
// Listado liviano de movimientos bancarios para selectors (ej. picker
// "Reembolso a la cuenta" en el cartel de NC compensada).
//
// Query params:
//   status   = "sin_asignar" | "conciliado" | "sin_factura" | "interno"
//   type     = "abono" | "cargo"
//   amount   = monto exacto (entero, sin separadores). Tolerancia ±$10.
//   limit    = max resultados (default 100)
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const type = sp.get("type");
  const amountRaw = sp.get("amount");
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type === "abono") where.amount = { gt: 0 };
  if (type === "cargo") where.amount = { lt: 0 };

  if (amountRaw) {
    const target = Number(amountRaw.replace(/[.\s]/g, "").replace(",", "."));
    if (!isNaN(target)) {
      // ±$10 sobre el ABS del monto (manejar abonos y cargos por igual).
      where.OR = [
        { amount: { gte: target - 10, lte: target + 10 } },
        { amount: { gte: -target - 10, lte: -target + 10 } },
      ];
    }
  }

  const movs = await prisma.bankMovement.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      status: true,
      bankAccount: { select: { alias: true } },
    },
  });

  return NextResponse.json({
    movements: movs.map((m) => ({
      id: m.id,
      date: m.date.toISOString(),
      amount: m.amount,
      description: m.description,
      status: m.status,
      bankAccountAlias: m.bankAccount?.alias ?? "",
    })),
  });
}
