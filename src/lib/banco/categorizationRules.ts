// Reglas de auto-categorización de movimientos bancarios.
// El patrón se deriva de las primeras palabras de la descripción.
// Match es substring case-insensitive contra BankMovement.description.

import { prisma } from "@/lib/prisma";

/**
 * Genera el patrón default para una nueva regla a partir de la descripción
 * del movimiento. Toma las primeras 3 palabras "significativas" — descarta
 * tokens 100% numéricos al inicio (típicos del banco: "0772707339 Transf...")
 * para que el patrón sea reutilizable entre movs distintos.
 */
export function suggestRulePattern(description: string): string {
  const tokens = description.trim().split(/\s+/);
  // Saltar tokens iniciales 100% numéricos (RUTs prefijados, IDs)
  let i = 0;
  while (i < tokens.length && /^\d+$/.test(tokens[i])) i++;
  // Tomar 3 tokens útiles
  const slice = tokens.slice(i, i + 3).join(" ");
  return slice || description.slice(0, 30);
}

/**
 * Aplica las reglas existentes a un movimiento sin_asignar. Si alguna
 * regla matchea, categoriza el mov y suma 1 hit.
 *
 * Devuelve { applied: true, ruleId, category } si aplicó algo.
 */
export async function applyRulesToMovement(
  movId: string
): Promise<{ applied: boolean; category?: string }> {
  const mov = await prisma.bankMovement.findUnique({
    where: { id: movId },
    select: { id: true, description: true, status: true },
  });
  if (!mov || mov.status !== "sin_asignar") return { applied: false };

  const rules = await prisma.bankCategorizationRule.findMany({
    orderBy: { hits: "desc" }, // las que más matchean primero
  });
  if (rules.length === 0) return { applied: false };

  const lowerDesc = mov.description.toLowerCase();
  for (const r of rules) {
    if (lowerDesc.includes(r.descriptionPattern.toLowerCase())) {
      await prisma.bankMovement.update({
        where: { id: movId },
        data: { category: r.category, status: "sin_factura" },
      });
      await prisma.bankCategorizationRule.update({
        where: { id: r.id },
        data: { hits: { increment: 1 } },
      });
      return { applied: true, category: r.category };
    }
  }
  return { applied: false };
}

/**
 * Upsert de regla cuando MJ categoriza manualmente.
 * Pattern viene del mov actual (suggestRulePattern). Si ya existe la regla
 * para (pattern, category), incrementa hits.
 */
export async function upsertRuleFromMovement(
  movDescription: string,
  category: string
): Promise<{ rulePattern: string }> {
  const pattern = suggestRulePattern(movDescription);
  if (!pattern) return { rulePattern: "" };
  await prisma.bankCategorizationRule.upsert({
    where: {
      descriptionPattern_category: {
        descriptionPattern: pattern,
        category,
      },
    },
    create: { descriptionPattern: pattern, category, hits: 1 },
    update: { hits: { increment: 1 } },
  });
  return { rulePattern: pattern };
}
