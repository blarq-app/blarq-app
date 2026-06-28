// Retención de boletas de honorarios — código 151 del F29.
//
// Cuando BLARQ recibe una boleta de honorarios, retiene un % del bruto y lo
// entera al SII en el F29 (línea "retención por rentas del Art. 42 N°2").
//
// La tasa sube gradualmente por la Ley 21.133 hasta 17% en 2028. Validada al
// peso contra datos reales de BLARQ: boletas 2025 al 14,5% (ej. bruto $751.000
// → retención $108.895) y el cruce de marzo 2026 al 15,25% ($66.129, igual que
// el contador).
//
// Las boletas viven en la app como Invoice type="recibida", tipoDoc=1039, con
// totalAmount = bruto (ver scripts/importar-bhe.ts). La retención se calcula
// aquí (no se guarda en la factura).

export const TASA_RETENCION_HONORARIOS: Record<number, number> = {
  2024: 0.1375,
  2025: 0.145,
  2026: 0.1525,
  2027: 0.16,
  2028: 0.17,
};

export function tasaRetencionHonorarios(year: number): number {
  // Años posteriores a la rampa quedan en el tope de 17%.
  return TASA_RETENCION_HONORARIOS[year] ?? 0.17;
}

// Retención de una boleta dado su bruto y el año de emisión.
export function retencionHonorario(bruto: number, year: number): number {
  return Math.round(bruto * tasaRetencionHonorarios(year));
}
