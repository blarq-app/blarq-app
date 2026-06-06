/**
 * Tipos compartidos del panel "Actualizar" (diferencias de una cotización en
 * borrador respecto al catálogo). Los usan: el GET de auditoría-precios (los
 * arma), el endpoint `aplicar` (los recibe y aplica) y el BudgetAuditBanner
 * (los muestra con un check por cada uno).
 *
 * Regla MJ (2026-06-06): nada del catálogo entra solo a una cotización. El
 * panel muestra cada cambio y MJ elige, uno por uno, cuáles acepta.
 *
 * Tres tipos de cambio:
 *   - update : un componente que ya está en la partida cambió de precio o
 *              nombre respecto al material del catálogo.
 *   - add    : un componente que el catálogo tiene y la partida no (material
 *              nuevo). Aplicarlo lo agrega.
 *   - remove : un componente de la partida cuyo origen ya no existe en el
 *              catálogo (material eliminado). Aplicarlo lo borra.
 */

export type AuditChangeKind = "update" | "add" | "remove";

interface AuditChangeBase {
  kind: AuditChangeKind;
  // id del registro a tocar: para update/remove es el ObraItemComponent.id;
  // para add es el PartidaComponent.id del catálogo (el molde a copiar).
  id: string;
  obraItemId: string;
  budgetVersionId: string;
  itemNumber: string;
  itemName: string;
  compType: string; // material | mano_obra | perdida | margen | herramientas | subcontrato
}

export interface AuditChangeUpdate extends AuditChangeBase {
  kind: "update";
  oldDescription: string;
  newDescription: string;
  oldUnitCost: number;
  newUnitCost: number;
}

export interface AuditChangeAdd extends AuditChangeBase {
  kind: "add";
  description: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

export interface AuditChangeRemove extends AuditChangeBase {
  kind: "remove";
  description: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

export type AuditChange = AuditChangeUpdate | AuditChangeAdd | AuditChangeRemove;

// Lo que el cliente manda de vuelta al aplicar: solo lo necesario para
// re-identificar el cambio (el servidor re-valida todo antes de tocar nada).
export interface AuditChangeRef {
  kind: AuditChangeKind;
  id: string;
  obraItemId: string;
}
