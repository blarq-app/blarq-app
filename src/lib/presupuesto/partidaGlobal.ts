/**
 * Pasar una partida de obra a GLOBAL (o volver de global a una unidad) sin que
 * el total se mueva. Pendiente 156.
 *
 * El problema: el desglose de una partida es POR UNIDAD. Cada línea que no es
 * "%" vale cantidad × costo, todo eso suma el P.U., y el P.U. se multiplica por
 * la cantidad de la partida. Una línea con unidad "GL" adentro de una partida
 * de 2,7 M2 NO es global: se cobra 2,7 veces (caso real: Los Algarrobos V4,
 * porcelanato tipo ladrillo, CERAMISTA GL $130.000 → contaba $351.000).
 *
 * La conversión: cada línea que NO es "%" multiplica su CANTIDAD por
 * (cantidad vieja / cantidad nueva), y la partida queda con la cantidad nueva.
 * Pasar a GL = cantidad nueva 1, o sea las líneas × 2,7. El total no cambia:
 *   - las líneas fijas crecen en la misma proporción en que baja la cantidad;
 *   - las líneas "%" de otras (pérdida, leyes sociales, margen) no se tocan:
 *     son % de líneas que ya crecieron, así que crecen solas.
 *
 * Se multiplica la CANTIDAD de la línea y no su costo unitario: el costo sigue
 * siendo el precio del material (el que compara la auditoría de precios) y la
 * cantidad pasa a ser la de toda la partida (2,7 M2 de porcelanato en vez de
 * 1). La lista de compra multiplica línea × partida, así que tampoco cambia.
 *
 * Puro: no toca la base. El endpoint calcula con esto, verifica que el total
 * se conserva y recién ahí escribe.
 */

import {
  effectiveTotal,
  esPorcentajeDeOtras,
  precioPorUnidad,
  type ComponenteCalculable,
} from "@/lib/catalog/effectiveTotal";

export interface PartidaReescalable {
  quantity: number;
  unitPrice: number;
  costMaterial: number | null;
  costLabor: number | null;
  costTools: number | null;
  costSubcontract: number | null;
  costLoss: number | null;
  costMargin: number | null;
}

// Los 6 montos por unidad que tiene una partida sin desglose.
export const CAMPOS_COSTO = [
  "costMaterial",
  "costLabor",
  "costTools",
  "costSubcontract",
  "costLoss",
  "costMargin",
] as const;

export interface CambioLinea {
  id: string;
  antes: number;
  despues: number;
}

export type Reescalado =
  | {
      ok: true;
      // Por cuánto se multiplicaron las cantidades de las líneas fijas.
      factor: number;
      cantidadAntes: number;
      cantidadDespues: number;
      precioUnitarioAntes: number;
      precioUnitarioDespues: number;
      // Total según el desglose, antes y después. Son iguales salvo centavos.
      totalAntes: number;
      totalDespues: number;
      // Líneas cuya cantidad cambia (las "%" de otras no aparecen).
      lineas: CambioLinea[];
      // Solo si la partida NO tiene desglose: los montos por unidad nuevos.
      montosSinDesglose: (Record<(typeof CAMPOS_COSTO)[number], number> & { unitPrice: number }) | null;
    }
  | { ok: false; error: string };

// Diferencia que se tolera entre el total antes y después: centavos de
// redondeo de punto flotante, nunca un peso.
const TOLERANCIA = 0.5;

/**
 * ¿Hay que multiplicar la cantidad de esta línea? Sí si su monto es fijo
 * (cantidad × costo). No si es un % de otras líneas (crece sola). Una línea
 * "%" vieja que la cuenta trata como fija (leyes sociales sin objetivo) se
 * multiplica solo si vale algo: en la base hay ~960, todas en $0 menos 2.
 */
function seMultiplica(c: ComponenteCalculable): boolean {
  if (esPorcentajeDeOtras(c)) return false;
  if (c.unit === "%") return (c.quantity || 0) * (c.unitCost || 0) !== 0;
  return true;
}

/**
 * Cambia la cantidad de la partida conservando el total: las líneas fijas
 * se multiplican por cantidadAntes / cantidadNueva.
 */
export function reescalarPartida<C extends ComponenteCalculable>(
  item: PartidaReescalable,
  comps: C[],
  cantidadNueva: number
): Reescalado {
  const cantidadAntes = item.quantity ?? 0;
  if (!(cantidadAntes > 0)) {
    return {
      ok: false,
      error:
        "La partida tiene cantidad 0. Poné la cantidad real antes de cambiarle la unidad: si no, el desglose se multiplicaría por 0.",
    };
  }
  if (!(cantidadNueva > 0) || !Number.isFinite(cantidadNueva)) {
    return { ok: false, error: "La cantidad nueva tiene que ser mayor que 0." };
  }
  const factor = cantidadAntes / cantidadNueva;

  if (comps.length === 0) {
    // Partida sin desglose: los montos por unidad se multiplican directo.
    const montos = Object.fromEntries(
      CAMPOS_COSTO.map((k) => [k, (item[k] ?? 0) * factor])
    ) as Record<(typeof CAMPOS_COSTO)[number], number>;
    const unitPrice = (item.unitPrice ?? 0) * factor;
    const totalAntes = (item.unitPrice ?? 0) * cantidadAntes;
    const totalDespues = unitPrice * cantidadNueva;
    if (Math.abs(totalAntes - totalDespues) > TOLERANCIA) {
      return { ok: false, error: "El total se movería al convertir. No se cambió nada." };
    }
    return {
      ok: true,
      factor,
      cantidadAntes,
      cantidadDespues: cantidadNueva,
      precioUnitarioAntes: item.unitPrice ?? 0,
      precioUnitarioDespues: unitPrice,
      totalAntes,
      totalDespues,
      lineas: [],
      montosSinDesglose: { ...montos, unitPrice },
    };
  }

  const lineas: CambioLinea[] = [];
  const nuevas = comps.map((c) => {
    if (!seMultiplica(c)) return c;
    // Redondeo a 9 decimales: 0,7 × 48 da 33,599999999999994 en la cuenta de
    // la máquina y la pantalla mostraba "33.599999". El error que mete el
    // redondeo es de una milésima de peso, muy por debajo de la tolerancia.
    const despues = Math.round((c.quantity || 0) * factor * 1e9) / 1e9;
    lineas.push({ id: c.id, antes: c.quantity || 0, despues });
    return { ...c, quantity: despues };
  });

  const puAntes = precioPorUnidad(comps);
  const puDespues = precioPorUnidad(nuevas);
  const totalAntes = puAntes * cantidadAntes;
  const totalDespues = puDespues * cantidadNueva;
  // Red de seguridad: si una línea de un tipo que no conocemos hiciera que el
  // total se mueva, no se convierte. Mejor negarse que mover plata callado.
  if (Math.abs(totalAntes - totalDespues) > TOLERANCIA) {
    return {
      ok: false,
      error: `El total se movería al convertir (${Math.round(totalAntes)} → ${Math.round(totalDespues)}). No se cambió nada.`,
    };
  }
  return {
    ok: true,
    factor,
    cantidadAntes,
    cantidadDespues: cantidadNueva,
    precioUnitarioAntes: puAntes,
    precioUnitarioDespues: puDespues,
    totalAntes,
    totalDespues,
    lineas,
    montosSinDesglose: null,
  };
}

/** Pasar a GL: la cantidad queda en 1 y el desglose se multiplica por la cantidad. */
export function pasarAGlobal<C extends ComponenteCalculable>(
  item: PartidaReescalable,
  comps: C[]
): Reescalado {
  return reescalarPartida(item, comps, 1);
}

export function esGlobal(unidad: string | null | undefined): boolean {
  return (unidad ?? "").trim().toUpperCase() === "GL";
}

// Líneas que la app sembró sola al pasar montos a mano a desglose
// (seedObraItemComponentsFromLumps: "Mano de obra (monto original)", "Margen
// (% original)"). Llevan rótulo GL pero son POR UNIDAD de la partida: no son
// un global multiplicado por error. Medido en la viva el 2026-10-08: 91
// partidas editables las tienen; sin esta excepción el aviso saldría en todas.
const SEMBRADA_DESDE_MONTO = /\((monto|%) original\)\s*$/i;

/**
 * Líneas en "GL" adentro de una partida con cantidad ≠ 1: se están cobrando
 * tantas veces como diga la cantidad, aunque digan "global". Una partida con
 * cantidad 1 no tiene problema; con cantidad 0 todavía no se cobra nada (el
 * aviso aparece cuando MJ pone la cantidad). Fuera: las líneas en $0 y las
 * sembradas desde un monto (arriba).
 */
export function lineasGlobalesMultiplicadas<C extends ComponenteCalculable & { description?: string }>(
  cantidadPartida: number,
  comps: readonly C[]
): C[] {
  const q = cantidadPartida ?? 0;
  if (!(q > 0) || q === 1) return [];
  return comps.filter(
    (c) =>
      esGlobal(c.unit) &&
      !SEMBRADA_DESDE_MONTO.test(c.description ?? "") &&
      effectiveTotal(c, comps as C[]) !== 0
  );
}

export interface AvisoGlobal<C> {
  // La partida misma dice GL pero tiene cantidad ≠ 1 (TECHUMBRE 10 GL, baños
  // en 3 GL): todo el desglose se cobra esa cantidad de veces.
  partidaEnGL: boolean;
  // Cuántas veces se cobra (la cantidad de la partida).
  veces: number;
  // Las líneas en GL que se multiplican (pueden venir vacías si el aviso es
  // solo por la partida).
  lineas: C[];
  // Lo que suman hoy esas líneas en la partida (costo × cantidad), sin margen.
  montoLineas: number;
}

/**
 * Aviso ámbar del editor de obra (pendiente 156, opción A que eligió MJ):
 * algo en GL se está cobrando más de una vez. Dos casos:
 *   - la partida está en GL con cantidad ≠ 1 ("global es 1", regla de MJ);
 *   - una línea en GL adentro de una partida con cantidad ≠ 1.
 * Solo mira y avisa: no calcula plata de la partida ni toca metrics.ts.
 */
export function avisoGlobal<C extends ComponenteCalculable & { description?: string }>(
  item: { unit: string; quantity: number },
  comps: readonly C[] | null | undefined
): AvisoGlobal<C> | null {
  const q = item.quantity ?? 0;
  if (!(q > 0) || q === 1) return null;
  const todas = comps ?? [];
  const partidaEnGL = esGlobal(item.unit);
  const lineas = lineasGlobalesMultiplicadas(q, todas);
  if (!partidaEnGL && lineas.length === 0) return null;
  const montoLineas = lineas.reduce((s, c) => s + effectiveTotal(c, todas as C[]), 0) * q;
  return { partidaEnGL, veces: q, lineas, montoLineas };
}

// "2,7" · "10" — la cantidad como la escribe MJ.
function veces(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 4 });
}

/**
 * El texto corto del aviso (globito del punto ámbar y frase del panel). Corto
 * a propósito: con el aviso de material sin cobrar MJ pidió "solamente decir
 * que X está en cero", sin explicaciones.
 */
export function textoAvisoGlobal(aviso: AvisoGlobal<{ description?: string }>): string {
  const v = veces(aviso.veces);
  if (aviso.partidaEnGL) return `La partida está en GL con cantidad ${v}: se cobra ${v} veces.`;
  const nombres = aviso.lineas.map((c) => c.description ?? "");
  if (nombres.length === 1) return `${nombres[0]} está en GL y se cobra ${v} veces.`;
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]} están en GL y se cobran ${v} veces.`;
  return `${nombres.length} líneas están en GL y se cobran ${v} veces: ${nombres.join(", ")}.`;
}
