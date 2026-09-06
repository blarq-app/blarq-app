// ¿Esta partida lleva un material escrito, con precio, que NO se le está
// cobrando al cliente?
//
// El caso que originó esto (MJ, pendiente 176): en una partida de tabique la
// PLACA OSB estaba escrita con su precio pero en cantidad 0. Suma $0, así que
// el material se compra igual y nadie lo cobra — en Casa Los Algarrobos son
// $321.818 que se fueron por ese agujero, y no había nada en pantalla que lo
// dijera. Viene del catálogo y se arrastra a cada obra que usa la partida.
//
// FUENTE ÚNICA del criterio: la usan el editor de obra y el catálogo de
// partidas. Si el aviso se dibuja en dos lugares con dos reglas distintas,
// tarde o temprano se contradicen (ya pasó con la versión vigente, ver
// selectVersion.ts).
//
// NO calcula plata ni toca metrics.ts: solo mira y avisa.

export interface ComponenteParaAviso {
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  // El material del catálogo, cuando la línea está enganchada a uno. Las
  // líneas escritas a mano vienen sin material y acá llegan null/undefined.
  // `isProvision` va opcional porque cada pantalla trae el material con un
  // select distinto (el editor del desglose lo trae entero, la fila de la
  // partida solo con este campo). Solo `=== true` apaga el aviso: si no vino,
  // se avisa — más vale una marca de más que plata que se va sin que nadie
  // la vea.
  material?: { isProvision?: boolean | null } | null;
}

// Convención de MJ: una línea que empieza con "PROVISION …" es un artefacto
// que BLARQ instala pero NO provee — el WC, la grifería, la mampara. El
// artefacto se cobra aparte, en la cotización de artefactos, y la línea en
// cero está ahí solo como referencia de precio. Esas están BIEN y no se avisan.
const EMPIEZA_CON_PROVISION = /^\s*PROVISI[OÓ]N\b/i;

// Dos señales, porque ninguna sola alcanza (medido en la base viva 2026-09-05):
//
//   1. La palabra "PROVISION" en la descripción. En el catálogo acierta el
//      100%, y es la ÚNICA pista disponible en las líneas que no quedaron
//      enganchadas a un material del catálogo (8 de las 41 líneas en cero de
//      las versiones vigentes — Aguirre y JNC).
//   2. El tilde `isProvision` del material del catálogo. Cubre lo que la
//      palabra no ve: el "FOCO VALOR PROFORMA $25.000", la "LÁMPARA COLGANTE
//      LED" y los accesorios de baño son provisiones escritas sin la palabra.
//      MJ las apaga tildando el material UNA vez y se calla en todas las obras.
//
// Sin la señal 2, el aviso se equivocaba en 12 de 23 partidas — más de la
// mitad — y MJ habría aprendido a ignorarlo, que es exactamente lo que había
// que evitar.
export function esProvisionAProposito(c: ComponenteParaAviso): boolean {
  return c.material?.isProvision === true || EMPIEZA_CON_PROVISION.test(c.description);
}

// Los materiales de una partida que están escritos y con precio, pero en
// cantidad 0 — o sea, plata que se gasta y no se cobra.
//
// Quedan FUERA a propósito:
//   · las provisiones (arriba);
//   · los componentes que no son material (la mano de obra y las leyes
//     sociales en 0 son otra cosa y no se resuelven acá);
//   · las líneas en "%" (margen, pérdida): ahí el 0 significa "sin margen",
//     no "material sin cobrar";
//   · las plantillas vacías — descripción "MATERIAL" con precio $0 en ENCHAPE
//     PIEDRA y MODIFICACIONES ELECTRICAS. Un material sin precio no es plata
//     sin cobrar: es un renglón esperando que lo llenen.
export function materialesSinCobrar<T extends ComponenteParaAviso>(
  componentes: readonly T[] | null | undefined
): T[] {
  if (!componentes?.length) return [];
  return componentes.filter(
    (c) =>
      c.type === "material" &&
      c.unit !== "%" &&
      (c.quantity ?? 0) === 0 &&
      (c.unitCost ?? 0) > 0 &&
      !esProvisionAProposito(c)
  );
}

// El texto que MJ lee al pasar el mouse por la marca ámbar: SOLO qué material
// está en cero. Nada más.
//
// La primera versión explicaba también cuánta plata era y qué hacer para
// apagar el aviso. MJ lo cortó (2026-09-05): "no es necesaria tanta
// explicación, solamente decir que X está en cero". El precio ya está en el
// desglose, que se abre con un clic en la misma marca.
//
// Vive acá y no en cada pantalla para que el editor de obra y el catálogo
// digan lo mismo.
export function avisoSinCobrar(sinCobrar: readonly ComponenteParaAviso[]): string {
  if (sinCobrar.length === 0) return "";
  if (sinCobrar.length === 1) return `${sinCobrar[0].description} está en cero.`;
  return `${sinCobrar.length} materiales están en cero:\n${sinCobrar
    .map((c) => `· ${c.description}`)
    .join("\n")}`;
}
