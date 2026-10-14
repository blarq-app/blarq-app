/**
 * "Profesional a cargo" de los documentos que salen de la app (PDF de obra,
 * EP, maestro, artefactos, muebles y el Excel del maestro).
 *
 * Antes cada plantilla tenía el nombre escrito a mano y en TODO MAYÚSCULA
 * ("JOSÉ TOMÁS LARRAÍN"), mientras el mandante sale como está escrito
 * ("Constanza Neumann"): en el pie de la portada los dos nombres quedaban en
 * estilos distintos y se veía mal. Ahora van con mayúscula inicial, igual
 * que el mandante, y en un solo lugar para que no vuelvan a divergir (el
 * Excel del maestro además lo tenía sin tildes).
 *
 * Si un documento quiere mostrarlo en mayúsculas, que lo haga su CSS para
 * todo el bloque — no el dato.
 */

/** Obra, estados de pago y documento del maestro. */
export const PROFESIONAL_OBRA = "José Tomás Larraín";

/** Artefactos y muebles. */
export const PROFESIONAL_DISENO = "María José Blanco";
