import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { applyRulesToMovement } from "@/lib/banco/categorizationRules";

// POST /api/banco/reglas/aplicar
//
// Pasa todas las reglas existentes contra los movimientos en status="sin_asignar".
// Útil después de crear/editar una regla — categoriza retroactivamente los movs
// que ya estaban importados sin categoría.
//
// No tiene body. Devuelve { tried, categorized } — cuántos movs se intentó
// procesar y cuántos terminaron categorizados (los que matchearon alguna regla).
export async function POST() {
  const movs = await prisma.bankMovement.findMany({
    where: { status: "sin_asignar" },
    select: { id: true },
  });

  let categorized = 0;
  for (const m of movs) {
    const r = await applyRulesToMovement(m.id);
    if (r.applied) categorized++;
  }

  return NextResponse.json({
    ok: true,
    tried: movs.length,
    categorized,
  });
}
