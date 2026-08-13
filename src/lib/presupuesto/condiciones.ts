/**
 * Condiciones (antes "observaciones generales") de una cotización.
 *
 * El problema que resuelve este módulo: hasta 2026-08 las condiciones vivían
 * HARDCODEADAS dentro de cada plantilla de PDF (una lista distinta por tipo),
 * y el campo `observations` de la versión era otra cosa — en obra ni siquiera
 * se imprimía. JT escribió a mano las 8 condiciones de una cotización de obra
 * porque en la app no las veía; ese texto no iba a salir nunca. Y al revés:
 * notas internas ("Importado desde Excel V7…") sí se estaban imprimiendo en
 * los PDF de muebles y artefactos.
 *
 * Ahora hay una sola fuente por versión: `BudgetVersion.conditions` (lista
 * ordenada). Lo que está ahí es exactamente lo que sale en el PDF — nada
 * fijo por detrás. Al crear una cotización se precarga con la PLANTILLA de su
 * tipo (modelo `ConditionTemplate`, editable desde Configuración). Cambiar la
 * plantilla NO toca cotizaciones ya creadas: cada versión conserva lo que se
 * pactó con ese cliente.
 *
 * Las constantes de abajo son el texto original de las plantillas de PDF,
 * copiado tal cual. Son condiciones comerciales: no reescribir la redacción.
 * Solo se usan como semilla cuando todavía no existe la fila en la base.
 */

export type TipoCondiciones = "obra" | "muebles" | "artefactos";

export interface Condicion {
  /**
   * Título opcional en negrita al principio de la línea ("Plazos de entrega.").
   * Solo lo usan algunas condiciones de muebles; obra y artefactos van sin él.
   */
  lead?: string | null;
  text: string;
}

const CONDICIONES_OBRA: Condicion[] = [
  { text: "Mandante dejará libre los accesos y las superficies a intervenir, dispondrá de suministro eléctrico y de agua potable, además de baño para las personas que trabajen en la obra." },
  { text: "Todo aumento de obra se recargará al costo directo según los precios unitarios más un recargo del mismo porcentaje en GG expresado en la oferta." },
  { text: "No se consideran Permisos Municipales ni de administración del Condominio dentro de este presupuesto." },
  { text: "Esta cotización tiene una validez de 10 días corridos." },
  { text: "Los pagos se harán con el valor de la UF del día, y solo se aceptarán pagos por transferencia bancaria o con tarjeta por medio de link de pago, en cuyo caso se agregará la comisión de Transbank." },
  { text: "Los valores expresados en la cotización podrían variar luego de visitar la propiedad." },
  { text: "Al aprobar la cotización se autoriza a la empresa BLARQ a publicar contenido en Redes Sociales y página web: fotos y videos del avance y estado de la obra, y a la instalación de publicidad hacia el exterior de la obra (terrazas, balcones, portón)." },
  { text: "Una vez aprobado el presupuesto, se solicita pago de anticipo al menos 2 semanas antes del comienzo de la obra." },
];

const CONDICIONES_MUEBLES: Condicion[] = [
  { lead: "Plazos de entrega.", text: "60 días corridos para muebles desde el ingreso a producción, salvo fuerza mayor. Las cubiertas de cuarzo y granito tienen un plazo de 10 días hábiles para instalación, posterior a su rectificación." },
  { lead: "Condiciones de entrega.", text: "Los muebles ingresan una vez puestos los cerámicos de muros con el frague seco, instalación de agua y desagüe. De haber pintura, debe estar seca. Las cubiertas solo se rectifican una vez instalados los muebles base." },
  { lead: "Garantías.", text: "Durante la etapa de diseño se revisan minuciosamente todos los detalles hasta lograr la plena satisfacción del cliente. Aprobado el diseño, todo cambio tiene costo adicional. No nos hacemos responsables por alteraciones en muebles y cubiertas una vez recibidos a conformidad." },
  { text: "Este presupuesto tiene una validez de 10 días corridos." },
  { text: "Los valores podrán sufrir modificaciones si existen variaciones considerables respecto de las medidas rectificadas en terreno." },
];

const CONDICIONES_ARTEFACTOS: Condicion[] = [
  { text: "Los artefactos cotizados están sujetos a disponibilidad de stock al momento del pago del anticipo." },
  { text: "Los descuentos aplicados son sobre precio lista del proveedor y válidos solo para esta cotización." },
  { text: "Tiempo de despacho: 7 a 15 días hábiles tras el pago del anticipo, dependiendo del proveedor." },
  { text: "Esta cotización tiene una validez de 10 días corridos." },
  { text: "Los precios pueden variar por ajustes del proveedor o tipo de cambio." },
];

/** Semilla por tipo. Solo aplica si la plantilla todavía no existe en la base. */
export const CONDICIONES_SEMILLA: Record<TipoCondiciones, Condicion[]> = {
  obra: CONDICIONES_OBRA,
  muebles: CONDICIONES_MUEBLES,
  artefactos: CONDICIONES_ARTEFACTOS,
};

export const TIPOS_CONDICIONES: TipoCondiciones[] = ["obra", "muebles", "artefactos"];

export function esTipoCondiciones(v: unknown): v is TipoCondiciones {
  return typeof v === "string" && (TIPOS_CONDICIONES as string[]).includes(v);
}

/**
 * Normaliza lo que venga de la base (columna Json) o del cliente a una lista
 * limpia: descarta filas sin texto, recorta espacios y deja `lead` en null
 * cuando viene vacío.
 *
 * Devuelve `null` solo si el valor no es una lista — eso significa "esta
 * versión es anterior al cambio y todavía no tiene condiciones propias".
 * Una lista VACÍA es una decisión válida y distinta: la cotización sale sin
 * observaciones (§ "lo que ves es lo que sale").
 */
export function parseCondiciones(value: unknown): Condicion[] | null {
  if (!Array.isArray(value)) return null;
  const out: Condicion[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      const text = raw.trim();
      if (text) out.push({ text });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) continue;
    const lead = typeof obj.lead === "string" ? obj.lead.trim() : "";
    out.push(lead ? { lead, text } : { text });
  }
  return out;
}
