import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import MaterialSearch from "@/components/catalogo/MaterialSearch";

export default async function CatalogoMaterialesPage() {
  const categories = await prisma.materialCatalog.findMany({
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });

  const stats = await prisma.materialCatalog.count();

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Catalogo de Materiales
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats} materiales en {categories.length} categorias
          </p>
        </div>
      </div>

      <Suspense>
        <MaterialSearch categories={categories.map((c) => c.category)} />
      </Suspense>
    </div>
  );
}
