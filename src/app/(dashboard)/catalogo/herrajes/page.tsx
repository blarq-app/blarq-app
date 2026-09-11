import { prisma } from "@/lib/prisma";
import HerrajesCatalogClient, {
  type HerrajeItem,
} from "@/components/catalogo/HerrajesCatalogClient";
import {
  normalizarProveedor,
  proveedoresDe,
} from "@/lib/presupuesto/herrajeProveedores";

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
  // Conteo por proveedor en el orden de las pestañas: DPH, HBT y los demás
  // que existan (los proveedores ya no son dos fijos, ver herrajeProveedores).
  const proveedores = proveedoresDe(items);
  const conteo = proveedores
    .map((s) => `${items.filter((i) => normalizarProveedor(i.supplier) === s).length} ${s}`)
    .join(" · ");

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Catálogo de herrajes
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} herrajes · {conteo}
          </p>
        </div>
      </div>

      {/* supplier/category son String en la BD (MJ agrega categorías después);
          el componente los tipa como uniones estrechas para su lógica interna. */}
      <HerrajesCatalogClient initialItems={items as HerrajeItem[]} />
    </div>
  );
}
