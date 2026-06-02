// Deduplicación de movimientos bancarios al importar cartolas Santander.
//
// CONTEXTO — por qué no alcanza con `balanceAfter`:
// La idempotencia del import usaba como llave el saldo corrido posterior
// (`balanceAfter`), reconstruido sumando los movimientos en un orden
// canónico desde el saldo inicial de la cartola. Esa llave es frágil cuando
// dos cartolas del mismo período NO traen exactamente los mismos
// movimientos. Caso real (2026-06-02, cuenta Operativa):
//
//   - La cartola PROVISORIA (snapshot del 16/05) no incluía aún 5 compras
//     con tarjeta del 18/05 que recién settlearon después.
//   - La cartola HISTÓRICA (cierre, 02/06) sí las incluía.
//   - Como esas 5 compras (cargos) ordenan ANTES del abono de Carolina
//     (+4.953.540) en el orden canónico, el saldo corrido de ese abono
//     quedó distinto entre las dos cartolas (16.148.641 vs 15.958.160).
//   - El dedup por balanceAfter no las reconoció como el mismo movimiento
//     → quedó duplicado al reimportar el período que se solapa.
//
// El tie-break por descripción (nombres truncados a distinto largo entre
// formatos) NO es la causa: reordenar movimientos del mismo (fecha, monto)
// deja el CONJUNTO de balanceAfter invariante, así que el dedup igual los
// reconoce. Lo que rompe es que falte/sobre un movimiento en el set.
//
// SOLUCIÓN — huella estable, independiente del saldo corrido:
// Identificamos cada movimiento por (fecha, monto, contraparte estable):
//   - Para transferencias: el N° de cuenta de la contraparte (los dígitos
//     líderes antes de "Transf"). Ese número es IDÉNTICO entre formatos —
//     el banco trunca el NOMBRE del beneficiario a distinto largo, pero no
//     el número de cuenta.
//   - Para el resto (compras con tarjeta, comisiones, etc.): la descripción
//     normalizada (el banco la trae estable entre formatos para estos).
// La huella no depende de balanceAfter, así que un set incompleto en una
// cartola no desincroniza el dedup.
//
// GEMELOS LEGÍTIMOS: dos transferencias reales del mismo monto, mismo día y
// misma contraparte comparten huella. Para no colapsarlas, el dedup es por
// CONTEO: cada cartola es la lista autoritativa de su período, así que el
// total que se conserva es el MÁXIMO de copias visto entre cartolas (no la
// suma). Si la DB ya tiene J copias de una huella y la cartola trae K, se
// insertan max(0, K − J) — preservando los gemelos y sin duplicar.

export interface DedupMovement {
  date: Date;
  amount: number;
  description: string;
}

// Dígitos líderes de la cuenta de la contraparte en una transferencia.
// "0105112904 Transf. Maria Carolina Ovalle" → "0105112904". null si la
// glosa no es una transferencia con número de cuenta adelante.
function leadingTransferAccount(description: string): string | null {
  return description.match(/^(\d{8,11}[K\d])\s+Transf/i)?.[1] ?? null;
}

// Huella estable de un movimiento para deduplicar entre formatos de cartola.
// NO usa balanceAfter (ver explicación arriba).
export function movementFingerprint(m: DedupMovement): string {
  const day = m.date.toISOString().slice(0, 10);
  const lead = leadingTransferAccount(m.description);
  // Para no-transferencias usamos la descripción normalizada (trim + espacios
  // colapsados + mayúsculas). El banco trae estas glosas estables entre
  // formatos; el truncado variable es propio de los NOMBRES de transferencia,
  // que acá ya quedan cubiertos por `lead`.
  const key = lead ?? m.description.trim().replace(/\s+/g, " ").toUpperCase();
  return `${day}|${m.amount}|${key}`;
}

export interface DedupPlan<T> {
  toInsert: T[];
  duplicates: T[];
}

// Decide, por conteo de huella, qué movimientos entrantes son nuevos y cuáles
// ya existen. `existing` son los movimientos ya guardados de la cuenta (basta
// con los del rango de fechas de la cartola). Preserva gemelos: si la DB ya
// tiene J copias de una huella y la cartola trae K, marca como duplicadas las
// primeras min(J, K) e inserta el resto.
export function planImportDedup<T extends DedupMovement>(
  existing: DedupMovement[],
  incoming: T[]
): DedupPlan<T> {
  const existingCounts = new Map<string, number>();
  for (const e of existing) {
    const fp = movementFingerprint(e);
    existingCounts.set(fp, (existingCounts.get(fp) ?? 0) + 1);
  }

  // Cuántas copias de cada huella ya "consumimos" marcándolas duplicadas.
  const dupUsed = new Map<string, number>();
  const toInsert: T[] = [];
  const duplicates: T[] = [];

  for (const m of incoming) {
    const fp = movementFingerprint(m);
    const coveredByDb = existingCounts.get(fp) ?? 0;
    const used = dupUsed.get(fp) ?? 0;
    if (used < coveredByDb) {
      // Todavía hay una copia en la DB que cubre a este movimiento → duplicado.
      duplicates.push(m);
      dupUsed.set(fp, used + 1);
    } else {
      // Ya cubrimos todas las copias de la DB; esta es nueva (gemelo extra o
      // movimiento que la DB no tenía).
      toInsert.push(m);
    }
  }

  return { toInsert, duplicates };
}
