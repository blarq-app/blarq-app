// Test de regresión de la fuente única del status de movimientos bancarios
// (src/lib/banco/movementStatus.ts). Solo las funciones PURAS — no toca la
// base. Correr con: npx tsx scripts/test-movement-status.ts
//
// Cubre los umbrales que antes estaban copiados 4 veces en la app (tolerancia
// $1) y las reglas de categorización, para que un cambio accidental se note.

import {
  MOV_STATUS,
  esModoExplicito,
  statusPorImputacion,
  statusAlCategorizar,
} from "../src/lib/banco/movementStatus";

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FALLA: ${name} — esperaba ${String(want)}, dio ${String(got)}`);
  }
}

// ── statusPorImputacion: la plata manda ────────────────────────────────────
check("sin nada imputado → null (decide el reposo)", statusPorImputacion(0, 100000), null);
check("imputación negativa → null", statusPorImputacion(-5, 100000), null);
check("imputado completo → conciliado", statusPorImputacion(100000, 100000), MOV_STATUS.CONCILIADO);
check("tolerancia $1 (99.999 de 100.000) → conciliado", statusPorImputacion(99999, 100000), MOV_STATUS.CONCILIADO);
check("le faltan $2 → parcial", statusPorImputacion(99998, 100000), MOV_STATUS.PARCIAL);
check("imputación chica → parcial", statusPorImputacion(1000, 100000), MOV_STATUS.PARCIAL);
check("sobre-imputado (split raro) → conciliado", statusPorImputacion(120000, 100000), MOV_STATUS.CONCILIADO);

// ── statusAlCategorizar: la imputación le gana a la categoría ──────────────
check("con pagos completos + categoría → sigue conciliado", statusAlCategorizar(100000, 100000, "sueldo"), MOV_STATUS.CONCILIADO);
check("con pagos parciales + categoría → sigue parcial", statusAlCategorizar(40000, 100000, "sueldo"), MOV_STATUS.PARCIAL);
check("sin pagos + categoría → sin_factura", statusAlCategorizar(0, 100000, "sueldo"), MOV_STATUS.SIN_FACTURA);
check("sin pagos + sacar categoría → sin_asignar", statusAlCategorizar(0, 100000, null), MOV_STATUS.SIN_ASIGNAR);

// ── esModoExplicito: interno y neto_cero no se derivan ─────────────────────
check("interno es modo", esModoExplicito(MOV_STATUS.INTERNO), true);
check("neto_cero es modo", esModoExplicito(MOV_STATUS.NETO_CERO), true);
check("conciliado NO es modo", esModoExplicito(MOV_STATUS.CONCILIADO), false);
check("sin_asignar NO es modo", esModoExplicito(MOV_STATUS.SIN_ASIGNAR), false);
check("null NO es modo", esModoExplicito(null), false);

console.log(`\n${pass} OK · ${fail} fallas`);
if (fail > 0) process.exit(1);
