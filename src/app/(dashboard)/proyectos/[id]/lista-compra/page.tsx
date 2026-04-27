import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ListaCompraClient, {
  ComputedRow,
} from "@/components/listaCompra/ListaCompraClient";

export default async function ListaCompraPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Todas las versiones de obra
  const obraBudgets = await prisma.budgetVersion.findMany({
    where: { projectId: id, type: "obra" },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, status: true, createdAt: true },
  });

  // Presupuesto seleccionado: ?v=ID > aprobado más reciente > último
  let selectedBudget = v ? obraBudgets.find((b) => b.id === v) : null;
  if (!selectedBudget)
    selectedBudget = obraBudgets.find((b) => b.status === "aprobado") || null;
  if (!selectedBudget) selectedBudget = obraBudgets[0] || null;

  // Traer partidas con catalogo y componentes
  let computed: ComputedRow[] = [];
  let itemsWithoutCatalog = 0;

  if (selectedBudget) {
    const full = await prisma.budgetVersion.findUnique({
      where: { id: selectedBudget.id },
      include: { obraItems: true },
    });

    const catalogIds =
      full?.obraItems
        .map((i) => i.catalogPartidaId)
        .filter((x): x is string => !!x) || [];

    itemsWithoutCatalog =
      full?.obraItems.filter((i) => !i.catalogPartidaId).length || 0;

    const componentsRaw = await prisma.partidaComponent.findMany({
      where: {
        partidaId: { in: catalogIds },
        type: "material",
      },
      include: { material: true },
    });
    // Excluir provisiones — no son materiales que se compran
    const components = componentsRaw.filter((c) => !c.material?.isProvision);

    const compsByPartida = new Map<string, typeof components>();
    for (const c of components) {
      if (!compsByPartida.has(c.partidaId))
        compsByPartida.set(c.partidaId, []);
      compsByPartida.get(c.partidaId)!.push(c);
    }

    type Agg = {
      key: string;
      name: string;
      unit: string;
      materialId: string | null;
      qtyNeeded: number;
      totalBudgeted: number;
      partidas: Set<string>;
      referenceLink: string | null;
    };
    const agg = new Map<string, Agg>();

    for (const obraItem of full?.obraItems || []) {
      if (!obraItem.catalogPartidaId) continue;
      const comps = compsByPartida.get(obraItem.catalogPartidaId) || [];
      for (const c of comps) {
        const qty = (c.quantity || 0) * (obraItem.quantity || 0);
        if (qty <= 0) continue;
        const budgeted = (c.unitCost || 0) * qty;
        const name = c.material?.name || c.description;
        const unit = c.material?.unit || c.unit;
        const key = c.materialId
          ? `mat:${c.materialId}`
          : `name:${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
        const prev = agg.get(key);
        if (prev) {
          prev.qtyNeeded += qty;
          prev.totalBudgeted += budgeted;
          prev.partidas.add(obraItem.name);
        } else {
          agg.set(key, {
            key,
            name,
            unit,
            materialId: c.materialId || null,
            qtyNeeded: qty,
            totalBudgeted: budgeted,
            partidas: new Set([obraItem.name]),
            referenceLink: c.material?.referenceLink || null,
          });
        }
      }
    }

    // Traer tracking guardado (qtyBought/notas)
    const tracking = await prisma.shoppingItem.findMany({
      where: { projectId: id },
    });
    const trackingByKey = new Map<string, (typeof tracking)[number]>();
    for (const t of tracking) {
      const k = t.materialId
        ? `mat:${t.materialId}`
        : `name:${t.name.trim().toLowerCase()}|${t.unit.trim().toLowerCase()}`;
      trackingByKey.set(k, t);
    }

    // Merge: filas desde presupuesto — precio viene del presupuesto, no del catálogo actual
    for (const a of agg.values()) {
      const t = trackingByKey.get(a.key);
      // Precio unitario efectivo = lo presupuestado / cantidad total necesaria
      const unitPrice =
        a.qtyNeeded > 0 && a.totalBudgeted > 0
          ? Math.round(a.totalBudgeted / a.qtyNeeded)
          : null;
      computed.push({
        key: a.key,
        shoppingItemId: t?.id || null,
        name: a.name,
        unit: a.unit,
        materialId: a.materialId,
        qtyNeeded: a.qtyNeeded,
        qtyBought: t?.qtyBought || 0,
        notes: t?.notes || null,
        source: "budget",
        partidas: Array.from(a.partidas).slice(0, 3),
        unitPrice,
        priceSource: unitPrice ? "presupuesto" : null,
        referenceLink: a.referenceLink,
      });
      trackingByKey.delete(a.key);
    }

    // Lo que quedó en tracking es manual o excedente (ya comprado pero no en presupuesto)
    for (const t of trackingByKey.values()) {
      computed.push({
        key: t.materialId
          ? `mat:${t.materialId}`
          : `name:${t.name.trim().toLowerCase()}|${t.unit.trim().toLowerCase()}`,
        shoppingItemId: t.id,
        name: t.name,
        unit: t.unit,
        materialId: t.materialId,
        qtyNeeded: 0,
        qtyBought: t.qtyBought,
        notes: t.notes,
        source: t.manualAdd ? "manual" : "excess",
        partidas: [],
        unitPrice: null,
        priceSource: null,
        referenceLink: null,
      });
    }

    // Ordenar: primero los del presupuesto alfabético, después manuales, después excess
    const order = { budget: 0, manual: 1, excess: 2 };
    computed.sort((a, b) => {
      const s = order[a.source] - order[b.source];
      if (s !== 0) return s;
      return a.name.localeCompare(b.name);
    });
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Materiales calculados en vivo desde el presupuesto de obra.
      </p>

      <ListaCompraClient
        projectId={project.id}
        rows={computed}
        budgets={obraBudgets.map((b) => ({
          id: b.id,
          version: b.version,
          status: b.status,
        }))}
        selectedBudgetId={selectedBudget?.id || null}
        itemsWithoutCatalog={itemsWithoutCatalog}
      />
    </div>
  );
}
