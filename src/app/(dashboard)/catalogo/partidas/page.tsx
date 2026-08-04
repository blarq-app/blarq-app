import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { compareCatalogCategories } from "@/lib/utils";
import PartidaSearch from "@/components/catalogo/PartidaSearch";

export default async function CatalogoPartidasPage() {
  const rawCategories = await prisma.partidaCatalog.findMany({
    select: { category: true },
    distinct: ["category"],
  });
  const categories = rawCategories
    .map((c) => c.category)
    .sort(compareCatalogCategories);

  const stats = await prisma.partidaCatalog.count();
  const matStats = await prisma.materialCatalog.count();

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Catalogo de Partidas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats} partidas en {categories.length} categorias — {matStats}{" "}
            materiales
          </p>
        </div>
      </div>

      <Suspense>
        <PartidaSearch categories={categories} />
      </Suspense>
    </div>
  );
}
