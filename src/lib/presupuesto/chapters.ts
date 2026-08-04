/**
 * Capítulos de obra — fuente ÚNICA de cómo se agrupan y se numeran.
 *
 * Antes los capítulos eran 8 claves fijas en lib/utils.ts (OBRA_CHAPTERS) y
 * cada consumidor (editor, PDF del cliente, PDF del maestro, Excel, estado de
 * pago, comparador de versiones) repetía a mano el mismo bloque de "recorrer
 * las 8 claves, filtrar partidas, saltar los vacíos, renumerar". Seis copias de
 * la misma regla. Ahora los capítulos son filas propias de cada versión
 * (modelo ObraChapter, nombre libre y orden arrastrable) y la regla vive acá.
 *
 * La numeración que ve el cliente NO se guarda en la base: se deriva de la
 * posición entre los capítulos QUE TIENEN PARTIDAS. Un capítulo vacío no sale
 * en el PDF y no consume número — igual que antes.
 *
 * Partidas huérfanas (sin capítulo, o apuntando a uno que ya no existe): NO se
 * pierden, caen en un capítulo sintético al final. Esto es a propósito y es el
 * arreglo de un bug real: con el modelo viejo, una partida cuya clave no
 * calzaba con ninguna de las 8 desaparecía del editor y del PDF pero seguía
 * sumando en el total. Portofino V6 tenía 17 partidas así ($2.161.958): el
 * cuadro de capítulos del PDF no cuadraba con su propio total. Con este
 * fallback, una partida puede quedar mal ubicada pero nunca invisible.
 */

export const SIN_CAPITULO_ID = "__sin_capitulo__";

/**
 * LA LISTA. Un solo vocabulario para los capítulos del presupuesto de obra y
 * las categorías del Catálogo de Partidas, en orden cronológico de obra.
 *
 * Hasta 2026-08-03 esto eran DOS listas escritas a mano en archivos distintos
 * —`CAPITULOS_SUGERIDOS` acá y `CATALOG_CATEGORY_ORDER` en lib/utils.ts— que
 * nadie mantuvo iguales. Divergieron: el capítulo "INSTALACIONES ELECTRICAS"
 * contra la categoría "INSTALACIONES ELECT.", "INSTALACIONES SANITARIAS Y
 * GASFITERIA" contra "INSTALACIONES SANITARIAS", "LIMPIEZA Y ASEO" contra
 * "ASEO Y LIMPIEZA". Guardar una partida al catálogo tenía que adivinar a cuál
 * de las dos listas hacerle caso.
 *
 * GANARON LOS NOMBRES DEL PRESUPUESTO, y el motivo importa: el nombre del
 * capítulo **sale en el PDF que ve el cliente** y hay decenas en versiones ya
 * enviadas o aprobadas — renombrarlos cambiaría documentos ya emitidos. Las
 * categorías del catálogo, en cambio, las ve solo BLARQ. Así que el catálogo se
 * adapta al presupuesto y no al revés.
 *
 * "INSTALACIONES GAS" ya no está: sus partidas viven en "INSTALACIONES
 * SANITARIAS Y GASFITERIA", que es como MJ nombra el capítulo (decisión
 * 2026-08-03; nunca había usado "INSTALACIONES GAS" como capítulo en ninguna
 * obra).
 *
 * Esto NO limita lo que MJ puede escribir: el nombre del capítulo sigue siendo
 * texto libre desde el PR #331. Esta lista son las SUGERENCIAS y el ORDEN.
 */
export const CAPITULOS = [
  "OBRAS PRELIMINARES",
  "DEMOLICIONES",
  "REPARACIONES",
  "OBRA GRUESA",
  "AISLACION E IMPERMEABILIZACION",
  "INSTALACIONES ELECTRICAS",
  "INSTALACIONES SANITARIAS Y GASFITERIA",
  "CLIMATIZACION",
  "TERMINACIONES",
  "MUEBLES",
  "LIMPIEZA Y ASEO",
] as const;

/**
 * Los 8 capítulos de siempre, en su orden de siempre. Ya NO son la ley: son
 * las SUGERENCIAS que ofrece el botón "+ Capítulo" para no tener que escribir
 * los nombres a mano. Un presupuesto nuevo arranca SIN capítulos (decisión MJ
 * 2026-07-27) y MJ elige de esta lista o escribe el nombre que quiera.
 *
 * Los nombres son los FORMALES — los que salían en el PDF del cliente. Desde
 * 2026-07-27 hay un solo nombre por capítulo y es el que se ve en todos lados.
 */
// Las que ofrece el botón "+ Capítulo" en el editor de OBRA. Salen de LA LISTA
// de arriba, con dos ajustes:
//   - MUEBLES no se ofrece: los muebles tienen su propio presupuesto, no son un
//     capítulo de la obra. Sigue existiendo como categoría del catálogo.
//   - ADICIONALES sí se ofrece aunque NO sea categoría del catálogo (decisión
//     MJ 2026-08-03). Es un cajón por proyecto, no un tipo de trabajo: un molde
//     reusable es "pintura de muro", no "adicional", y guardarlo bajo
//     ADICIONALES lo haría imposible de encontrar después.
export const CAPITULOS_SUGERIDOS = [
  ...CAPITULOS.filter((c) => c !== "MUEBLES"),
  "ADICIONALES",
] as const;

export interface ChapterLike {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ChapterItemLike {
  chapterId: string | null;
  sortOrder: number;
  subChapter?: string | null;
  name?: string;
}

export interface ChapterGroup<C extends ChapterLike, I> {
  chapter: C;
  items: I[];
  /**
   * Número que se muestra (1, 2, 3…), contando SOLO los capítulos con
   * partidas. null = capítulo vacío: no lleva número y no sale en el PDF.
   */
  index: number | null;
  /** Suma de los `total` de las partidas, si el tipo los trae. */
  subtotal: number;
}

/**
 * Orden de las partidas DENTRO de un capítulo: por sortOrder, el orden manual
 * que arma MJ arrastrando las filas.
 *
 * A propósito NO hay desempate acá. En los presupuestos viejos TODAS las
 * partidas tienen sortOrder = 0 (el campo nunca se pobló), así que el
 * desempate decide el orden real de esas obras. El editor y el PDF usaban
 * desempates DISTINTOS: el editor rompía el empate por zona y nombre, el PDF y
 * el estado de pago lo dejaban en el orden en que venían de la base. Unificar
 * los dos acá le cambiaba el orden a PDFs de cliente ya emitidos (verificado:
 * partidas que se daban vuelta de a pares en Constanza Bravo).
 *
 * Como el sort de JS es estable, cada consumidor conserva su comportamiento de
 * siempre: el que quiera un desempate propio ordena ANTES de llamar acá (es lo
 * que hace el editor), y el que no, recibe las partidas en el orden en que las
 * trajo de la base. Unificar los dos criterios es una decisión de MJ, no un
 * efecto colateral de este cambio.
 */
function compararPartidas(a: ChapterItemLike, b: ChapterItemLike): number {
  return a.sortOrder - b.sortOrder;
}

/**
 * Agrupa las partidas por capítulo, en el orden de los capítulos, con las
 * partidas ya ordenadas adentro y el número de capítulo ya reflowado.
 *
 * @param includeEmpty true (editor) = devuelve también los capítulos sin
 *   partidas, con index null. false (PDF, Excel, EP) = los saltea.
 */
export function groupByChapter<
  C extends ChapterLike,
  I extends ChapterItemLike & { total?: number }
>(
  chapters: C[],
  items: I[],
  { includeEmpty = false }: { includeEmpty?: boolean } = {}
): ChapterGroup<C, I>[] {
  const ordenados = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const conocidos = new Set(ordenados.map((c) => c.id));

  const porCapitulo = new Map<string, I[]>();
  for (const it of items) {
    const key =
      it.chapterId && conocidos.has(it.chapterId) ? it.chapterId : SIN_CAPITULO_ID;
    const arr = porCapitulo.get(key);
    if (arr) arr.push(it);
    else porCapitulo.set(key, [it]);
  }

  const huerfanas = porCapitulo.get(SIN_CAPITULO_ID) ?? [];
  const lista: C[] = [...ordenados];
  if (huerfanas.length > 0) {
    // Capítulo sintético al final. No existe en la base: es la red para que
    // ninguna partida quede invisible.
    lista.push({
      id: SIN_CAPITULO_ID,
      name: "SIN CAPITULO",
      sortOrder: Number.MAX_SAFE_INTEGER,
    } as C);
  }

  let numero = 0;
  const grupos: ChapterGroup<C, I>[] = [];
  for (const chapter of lista) {
    const propias = (porCapitulo.get(chapter.id) ?? []).sort(compararPartidas);
    if (propias.length === 0 && !includeEmpty) continue;
    if (propias.length > 0) numero++;
    grupos.push({
      chapter,
      items: propias,
      index: propias.length > 0 ? numero : null,
      subtotal: propias.reduce((s, i) => s + (i.total ?? 0), 0),
    });
  }
  return grupos;
}

/**
 * Igual que groupByChapter pero para las partidas de un ESTADO DE PAGO.
 *
 * El EP no mira los capítulos del presupuesto vivo: cada partida trae su
 * propia FOTO del capítulo (chapterName + chapterOrder), copiada al crearse el
 * EP y refrescada al sincronizar. Es a propósito — una partida `outOfScope`
 * (estaba en la versión vieja y ya no está en la nueva) puede pertenecer a un
 * capítulo que se borró, y el EP tiene que seguir mostrándola en su lugar.
 *
 * Agrupa por NOMBRE de capítulo y ordena por chapterOrder. Las partidas sin
 * foto (data anterior a la migración) caen juntas al final.
 */
export interface EpChapterItemLike {
  chapterName?: string | null;
  chapterOrder?: number;
  sortOrder: number;
  subChapter?: string | null;
  name?: string;
}

export function groupEpItemsByChapter<I extends EpChapterItemLike>(
  items: (I & { total?: number })[]
): ChapterGroup<ChapterLike, I>[] {
  const capitulos = new Map<string, ChapterLike>();
  for (const it of items) {
    const nombre = it.chapterName?.trim() || "SIN CAPITULO";
    const orden = it.chapterName?.trim()
      ? it.chapterOrder ?? 0
      : Number.MAX_SAFE_INTEGER;
    const previo = capitulos.get(nombre);
    // Si dos partidas traen posiciones distintas para el mismo nombre (puede
    // pasar entre EPs sincronizados en momentos distintos), gana la menor.
    if (!previo || orden < previo.sortOrder) {
      capitulos.set(nombre, { id: nombre, name: nombre, sortOrder: orden });
    }
  }
  const conChapterId = items.map((it) => ({
    ...it,
    chapterId: it.chapterName?.trim() || "SIN CAPITULO",
  }));
  return groupByChapter(
    [...capitulos.values()],
    conChapterId
  ) as unknown as ChapterGroup<ChapterLike, I>[];
}
