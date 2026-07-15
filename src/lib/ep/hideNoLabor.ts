// Criterio para esconder del EP del maestro las partidas que NO son suyas:
// las que no llevan mano de obra de él porque las provee/ejecuta un tercero
// (material o subcontrato). Ejemplos reales de MJ: "ESPEJO A MEDIDA"
// (subcontrato $510k, MO $0), una provisión que se le cobra al cliente aparte,
// un subcontrato de ventanas. Eso no tiene que aparecer en el EP del maestro.
//
// OJO — el criterio NO es "está en $0". Una partida con mano de obra pendiente
// de precio (MO $0 temporal, sin ningún otro costo cargado) SÍ tiene que
// mostrarse: es del maestro, solo le falta el precio. La señal de "esto es
// deliberado, no es del maestro" es: MO en 0 PERO con costo por otro lado
// (material / subcontrato / herramientas).
//
// El costo "por otro lado" se lee del ObraItem VIGENTE (el snapshot del EP no
// lo guarda). La MO se lee del snapshot del propio EP (`laborUnitPrice`), así
// que nunca escondemos una fila que tenga plata en el total del EP. Si el
// ObraItem no se puede resolver (versión cambiada, etc.), NO se esconde: mejor
// mostrar de más que ocultar algo que sí es del maestro.

export type ObraItemOtroCosto = {
  costMaterial: number | null;
  costSubcontract: number | null;
  costTools: number | null;
};

export function esSinManoDeObra(
  laborUnitPriceSnapshot: number,
  obraItemCosto: ObraItemOtroCosto | undefined
): boolean {
  // Con MO > 0 en el EP, es del maestro sí o sí → mostrar.
  if ((laborUnitPriceSnapshot ?? 0) !== 0) return false;
  // Sin el ObraItem no podemos saber si hay costo por otro lado → mostrar.
  if (!obraItemCosto) return false;
  const otroCosto =
    (obraItemCosto.costMaterial ?? 0) +
    (obraItemCosto.costSubcontract ?? 0) +
    (obraItemCosto.costTools ?? 0);
  // MO en 0 + costo por otro lado = deliberado (material/subcontrato) → esconder.
  return otroCosto > 0;
}
