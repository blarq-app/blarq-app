// Test de regresión (puro, sin BD ni archivos) del dedup de import de
// cartolas. Congela el fix del bug 2026-06-02: reimportar una cartola que se
// solapa NO debe duplicar, aunque el saldo corrido (balanceAfter) difiera
// entre formatos por un set de movimientos incompleto. Y debe PRESERVAR los
// gemelos legítimos (dos transferencias reales iguales el mismo día).
//
// Uso: npx tsx scripts/test-cartola-dedup.ts

import { movementFingerprint, planImportDedup, type DedupMovement } from "../src/lib/banco/dedup";

let ok = 0, fail = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const pass = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`${pass ? "✓" : "✗"} ${nombre}`);
  if (!pass) { console.log(`    esperado: ${JSON.stringify(esperado)}\n    real:     ${JSON.stringify(real)}`); fail++; } else ok++;
}

const mov = (date: string, amount: number, description: string): DedupMovement =>
  ({ date: new Date(date), amount, description });

// ── Huella: el N° de cuenta líder es la parte estable, no el nombre ─────────
check("misma cuenta, nombre truncado distinto → misma huella",
  movementFingerprint(mov("2026-05-13", 5_000_000, "0105112904 Transf. Maria Carolina")),
  movementFingerprint(mov("2026-05-13", 5_000_000, "0105112904 Transf. Maria Ovalle Aldunate")));

check("distinta cuenta → distinta huella",
  movementFingerprint(mov("2026-05-13", 5_000_000, "0105112904 Transf. Maria Carolina")) !==
  movementFingerprint(mov("2026-05-13", 5_000_000, "0194754353 Transf. Camila Andrea")),
  true);

check("compra con tarjeta: glosa normalizada es la huella",
  movementFingerprint(mov("2026-05-18", -46765, "Compra SODIMAC PARQUE AR")),
  movementFingerprint(mov("2026-05-18", -46765, "compra  sodimac parque ar")));

// ── El bug real: balanceAfter distinto, pero NO debe duplicar ───────────────
// La provisoria ya tiene el abono de Carolina del 18-may. La histórica lo
// trae de nuevo (con otra glosa truncada). No debe insertarse.
{
  const enDB: DedupMovement[] = [
    mov("2026-05-18", 4_953_540, "0105112904 Transf. Maria Carolina"),
  ];
  const cartolaHist: DedupMovement[] = [
    mov("2026-05-18", -46765, "Compra SODIMAC PARQUE AR"), // compra nueva (settleó después)
    mov("2026-05-18", 4_953_540, "0105112904 Transf. Maria Ovalle Aldunate"), // MISMO abono, glosa distinta
  ];
  const plan = planImportDedup(enDB, cartolaHist);
  check("solapamiento: el abono ya existente no se duplica",
    { insert: plan.toInsert.length, dup: plan.duplicates.length },
    { insert: 1, dup: 1 }); // solo la compra nueva entra; el abono es duplicado
  check("solapamiento: lo que entra es la compra nueva, no el abono",
    plan.toInsert.map((m) => m.amount), [-46765]);
}

// ── Gemelos legítimos: dos transferencias reales iguales el mismo día ───────
{
  // Primer import (DB vacía): entran las dos.
  const plan1 = planImportDedup([], [
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
  ]);
  check("gemelos: primer import inserta las dos copias",
    { insert: plan1.toInsert.length, dup: plan1.duplicates.length }, { insert: 2, dup: 0 });

  // Reimport del mismo período: la DB ya tiene las dos → no entra ninguna.
  const enDB = [
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina Ovalle"),
  ];
  const plan2 = planImportDedup(enDB, [
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
    mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
  ]);
  check("gemelos: reimport no duplica (conserva 2, no 4)",
    { insert: plan2.toInsert.length, dup: plan2.duplicates.length }, { insert: 0, dup: 2 });

  // Caso mixto: la DB tenía 1 copia, la cartola trae 2 → entra 1 (la 2da real).
  const plan3 = planImportDedup(
    [mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina")],
    [
      mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
      mov("2026-02-16", 5_000_000, "0105112904 Transf. Maria Carolina"),
    ]
  );
  check("gemelos: DB tenía 1, cartola trae 2 → inserta 1",
    { insert: plan3.toInsert.length, dup: plan3.duplicates.length }, { insert: 1, dup: 1 });
}

// ── Reimport idéntico completo: cero inserciones ────────────────────────────
{
  const movs = [
    mov("2026-05-04", -987926, "0799039206 Transf a Comercial Hisp"),
    mov("2026-05-04", -151883, "Compra SODIMAC PARQUE AR"),
    mov("2026-05-13", 5_000_000, "0105112904 Transf. Maria Ovalle Al"),
  ];
  const plan = planImportDedup(movs, movs);
  check("reimport idéntico: nada se inserta",
    { insert: plan.toInsert.length, dup: plan.duplicates.length }, { insert: 0, dup: 3 });
}

console.log(`\n${ok} ok, ${fail} fallan`);
process.exit(fail ? 1 : 0);
