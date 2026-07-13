import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ListaCompraClient, {
  ComputedRow,
} from "@/components/listaCompra/ListaCompraClient";
import {
  aggregateShoppingItems,
  countItemsWithoutMaterial,
} from "@/lib/listaCompra/perdidaCantidad";

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
    // Lee componentes desde ObraItemComponent (snapshot por proyecto),
    // NO desde PartidaComponent (catálogo). Regla MJ 2026-05-05: una
    // cotización aprobada es inmutable ante cambios al catálogo.
    // Trae TODOS los componentes (no solo material): la lógica de merma
    // necesita ver las líneas de pérdida para inflar la cantidad del material
    // al que apuntan. Ver src/lib/listaCompra/perdidaCantidad.ts.
    const full = await prisma.budgetVersion.findUnique({
      where: { id: selectedBudget.id },
      include: {
        obraItems: {
          include: {
            components: { include: { material: true } },
          },
        },
      },
    });

    // Solo alertar de partidas que TIENEN plata de material presupuestada pero
    // sin detallar (no aparecen en la lista). Las de pura mano de obra
    // (demoliciones, instalaciones) tienen costMaterial 0 y NO deben alertar:
    // no les falta nada, simplemente no compran materiales.
    itemsWithoutCatalog = countItemsWithoutMaterial(
      full?.obraItems || [],
      true
    );

    // La cantidad incluye la pérdida (merma) del material al que esté enganchada.
    // Las provisiones (porcelanato, palmeta) SÍ se muestran en la lista —
    // MJ las considera material a ver/comprar. Se marcan con isProvision para
    // distinguirlas de la ferretería normal (etiqueta "provisión" en la UI).
    const agg = aggregateShoppingItems(full?.obraItems || [], true);

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
        isProvision: a.isProvision,
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
        isProvision: false,
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
