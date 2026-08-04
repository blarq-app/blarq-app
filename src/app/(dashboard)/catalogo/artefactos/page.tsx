import { prisma } from "@/lib/prisma";
import ArtefactosCatalogClient from "@/components/catalogo/ArtefactosCatalogClient";

export const dynamic = "force-dynamic";

export default async function CatalogoArtefactosPage() {
  const [items, tipos, subgroupOrders] = await Promise.all([
    prisma.artefactoCatalog.findMany({
      orderBy: [
        { subcategory: "asc" },
        { sortOrder: "asc" }, // orden manual dentro de la pestaña
        { name: "asc" }, // fallback estable cuando empatan en sortOrder
      ],
    }),
    // Tipos editables por MJ (antes vivían fijos en el código).
    prisma.artefactoTipo.findMany({
      orderBy: [{ subcategory: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    // Orden manual de los subgrupos (línea+color) dentro de cada tipo. Los que
    // no estén acá caen a orden alfabético en el cliente (fallback).
    prisma.artefactoSubgroupOrder.findMany({
      orderBy: [{ subcategory: "asc" }, { sortOrder: "asc" }],
    }),
  ]);

  const total = items.length;
  const bySubcat = {
    sanitario: items.filter((i) => i.subcategory === "sanitario").length,
    cocina: items.filter((i) => i.subcategory === "cocina").length,
    iluminacion: items.filter((i) => i.subcategory === "iluminacion").length,
  };
  const standardCount = items.filter((i) => i.isStandard).length;

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Catálogo de artefactos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} artefactos · {standardCount} en paleta estándar BLARQ ·{" "}
            {bySubcat.sanitario} sanitarios · {bySubcat.cocina} cocina ·{" "}
            {bySubcat.iluminacion} iluminación
          </p>
        </div>
      </div>

      <ArtefactosCatalogClient
        initialItems={items}
        initialTipos={tipos}
        initialSubgroupOrders={subgroupOrders}
      />
    </div>
  );
}
