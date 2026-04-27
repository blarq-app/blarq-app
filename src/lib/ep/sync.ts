// Lógica pura de sincronización EP ↔ presupuesto.
//
// computeSyncDiff() compara los items del EP contra los items del presupuesto
// objetivo y devuelve una estructura describiendo qué hay que agregar,
// actualizar, eliminar y qué quedó fuera de alcance (con pagos previos).
//
// El matching se hace por `lineageId` — identidad estable de partida a través
// de versiones del presupuesto. Tanto el endpoint preview (UI) como el POST
// sync (mutación) usan esta función como única fuente de verdad para la diff.

export type DiffField =
  | "name"
  | "descriptionMaestro"
  | "unit"
  | "quantity"
  | "laborUnitPrice"
  | "itemNumber"
  | "chapter";

export type ChangeRecord = {
  field: DiffField;
  oldValue: string | number | null;
  newValue: string | number | null;
};

export type EpItemForDiff = {
  id: string;
  lineageId: string;
  chapter: string;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
};

export type BudgetItemForDiff = {
  id: string;
  lineageId: string;
  chapter: string;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  costLabor: number | null;
  sortOrder: number;
};

export type AddedItem = {
  lineageId: string;
  chapter: string;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  laborTotal: number;
};

export type UpdatedItem = {
  id: string;
  lineageId: string;
  chapter: string;
  itemNumber: string;
  name: string;
  changes: ChangeRecord[];
};

export type RemovedSafeItem = {
  id: string;
  lineageId: string;
  chapter: string;
  itemNumber: string;
  name: string;
};

export type RemovedWithPaymentItem = RemovedSafeItem & {
  prevAmountPaid: number;
};

export type SyncDiff = {
  added: AddedItem[];
  updated: UpdatedItem[];
  removedSafe: RemovedSafeItem[];
  removedWithPayments: RemovedWithPaymentItem[];
  unchangedCount: number;
};

// Devuelve el diff entre los items del EP y los items del presupuesto objetivo.
// `prevAmountPaidByLineage`: monto pagado en EPs cerrados anteriores, indexado
// por lineageId. Se usa para clasificar las partidas removidas en safe vs
// with-payments.
export function computeSyncDiff(
  epItems: EpItemForDiff[],
  budgetItems: BudgetItemForDiff[],
  prevAmountPaidByLineage: Map<string, number>
): SyncDiff {
  const existingByLineage = new Map(epItems.map((i) => [i.lineageId, i]));
  const budgetLineages = new Set(budgetItems.map((b) => b.lineageId));

  const removedSafe: RemovedSafeItem[] = [];
  const removedWithPayments: RemovedWithPaymentItem[] = [];
  for (const s of epItems) {
    if (budgetLineages.has(s.lineageId)) continue;
    const prevPaid = prevAmountPaidByLineage.get(s.lineageId) ?? 0;
    const base = {
      id: s.id,
      lineageId: s.lineageId,
      chapter: s.chapter,
      itemNumber: s.itemNumber,
      name: s.name,
    };
    if (prevPaid > 0) {
      removedWithPayments.push({ ...base, prevAmountPaid: prevPaid });
    } else {
      removedSafe.push(base);
    }
  }

  const added: AddedItem[] = [];
  const updated: UpdatedItem[] = [];
  let unchangedCount = 0;

  for (const b of budgetItems) {
    const laborUnitPrice = b.costLabor ?? 0;
    const existing = existingByLineage.get(b.lineageId);

    if (!existing) {
      added.push({
        lineageId: b.lineageId,
        chapter: b.chapter,
        itemNumber: b.itemNumber,
        name: b.name,
        descriptionMaestro: b.descriptionMaestro,
        unit: b.unit,
        quantity: b.quantity,
        laborUnitPrice,
        laborTotal: laborUnitPrice * b.quantity,
      });
      continue;
    }

    const changes: ChangeRecord[] = [];
    if (existing.chapter !== b.chapter)
      changes.push({ field: "chapter", oldValue: existing.chapter, newValue: b.chapter });
    if (existing.itemNumber !== b.itemNumber)
      changes.push({ field: "itemNumber", oldValue: existing.itemNumber, newValue: b.itemNumber });
    if (existing.name !== b.name)
      changes.push({ field: "name", oldValue: existing.name, newValue: b.name });
    if ((existing.descriptionMaestro ?? null) !== (b.descriptionMaestro ?? null))
      changes.push({
        field: "descriptionMaestro",
        oldValue: existing.descriptionMaestro,
        newValue: b.descriptionMaestro,
      });
    if (existing.unit !== b.unit)
      changes.push({ field: "unit", oldValue: existing.unit, newValue: b.unit });
    if (existing.quantity !== b.quantity)
      changes.push({ field: "quantity", oldValue: existing.quantity, newValue: b.quantity });
    if (existing.laborUnitPrice !== laborUnitPrice)
      changes.push({
        field: "laborUnitPrice",
        oldValue: existing.laborUnitPrice,
        newValue: laborUnitPrice,
      });

    if (changes.length === 0) {
      unchangedCount++;
    } else {
      updated.push({
        id: existing.id,
        lineageId: existing.lineageId,
        chapter: existing.chapter,
        itemNumber: existing.itemNumber,
        name: existing.name,
        changes,
      });
    }
  }

  return { added, updated, removedSafe, removedWithPayments, unchangedCount };
}
