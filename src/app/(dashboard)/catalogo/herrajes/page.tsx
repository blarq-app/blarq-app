import { prisma } from "@/lib/prisma";
import HerrajesCatalogClient, {
  type HerrajeItem,
} from "@/components/catalogo/HerrajesCatalogClient";

export const dynamic = "force-dynamic";

export default async function CatalogoHerrajesPage() {
  const items = await prisma.herrajeCatalog.findMany({
    orderBy: [
      { supplier: "asc" },
      { category: "asc" },
      { sortOrder: "asc" }, // orden manual dentro de proveedor+categoría
      { name: "asc" }, // fallback estable cuando empatan
    ],
  });

  const total = items.length;
  const bySupplier = {
    DPH: items.filter((i) => i.supplier === "DPH").length,
    HBT: items.filter((i) => i.supplier === "HBT").length,
  };

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Catálogo de herrajes
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} herrajes · {bySupplier.DPH} DPH · {bySupplier.HBT} HBT
          </p>
        </div>
      </div>

      {/* supplier/category son String en la BD (MJ agrega categorías después);
          el componente los tipa como uniones estrechas para su lógica interna. */}
      <HerrajesCatalogClient initialItems={items as HerrajeItem[]} />
    </div>
  );
}
