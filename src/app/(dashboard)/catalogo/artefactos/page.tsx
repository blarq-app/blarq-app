import { prisma } from "@/lib/prisma";
import ArtefactosCatalogClient from "@/components/catalogo/ArtefactosCatalogClient";

export const dynamic = "force-dynamic";

export default async function CatalogoArtefactosPage() {
  const [items, tipos] = await Promise.all([
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
      <div className="flex items-center justify-between mb-6">
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

      <ArtefactosCatalogClient initialItems={items} initialTipos={tipos} />
    </div>
  );
}
