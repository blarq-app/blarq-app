import type { Prisma } from "@prisma/client";

/**
 * Criterio único de "proyectos asignables": qué proyectos pueden aparecer en un
 * desplegable donde se le asigna un centro de costo a algo (una factura, un
 * movimiento de banco, un gasto de contabilidad).
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * Este mismo `where` estaba copiado a mano en 5 pantallas y, al agregarse el
 * status "archivado" a los proyectos, ninguna de las 5 se enteró: las obras
 * archivadas se colaban en todos los desplegables. Mismo patrón que la lista de
 * categorías del banco (§3.2 de la auditoría de banco 2026-07). Un solo lugar
 * para que no vuelvan a divergir.
 *
 * QUÉ SE ESCONDE Y POR QUÉ
 * ------------------------
 * - `cotizacion` (no ganada): todavía no es una obra, no debería recibir gastos.
 * - `archivado`: obra/cotización que MJ archivó — ya no está en circulación.
 *
 * QUÉ NO SE ESCONDE NUNCA
 * -----------------------
 * - Los centros internos (`isInternal`): BLARQ y CASA. Salen sin número igual
 *   que las archivadas, pero son justo donde caen los gastos del estudio (BLARQ
 *   tiene cientos de facturas). Esconder "todo lo que no tiene número" las mata.
 * - Un proyecto archivado QUE YA TIENE FACTURAS asignadas. Hoy las 4 archivadas
 *   tienen 0 facturas, pero si mañana se archiva una obra con gastos encima, no
 *   queremos que desaparezca del desplegable y deje esas facturas sin forma de
 *   reasignarse.
 */
export const PROYECTOS_ASIGNABLES_WHERE = {
  NOT: {
    OR: [
      // Cotizaciones no ganadas.
      { status: "cotizacion", isInternal: false },
      // Archivadas que no arrastran ninguna factura.
      { status: "archivado", isInternal: false, invoices: { none: {} } },
    ],
  },
} satisfies Prisma.ProjectWhereInput;
