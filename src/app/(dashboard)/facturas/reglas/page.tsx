import { prisma } from "@/lib/prisma";
import Link from "next/link";
import InvoiceRulesTable from "@/components/facturas/InvoiceRulesTable";

export default async function FacturasReglasPage() {
  const [rules, categories] = await Promise.all([
    prisma.invoiceCategorizationRule.findMany({
      orderBy: [{ hits: "desc" }, { updatedAt: "desc" }],
      include: {
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
      },
    }),
    prisma.costCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parent: { select: { id: true, name: true } },
      },
    }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link href="/facturas" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a facturas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            Reglas de categorización por proveedor
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rules.length} regla{rules.length !== 1 ? "s" : ""} · ordenadas por uso
          </p>
        </div>
      </div>

      <div className="bg-blue-50/40 border border-blue-100 rounded-lg p-3 mb-4 text-xs text-gray-700 leading-relaxed">
        Cada vez que asignás categoría a una factura recibida (manual, edición o
        bulk en /facturas), se guarda una regla{" "}
        <span className="font-medium">RUT proveedor → categoría</span>. Las próximas facturas
        del mismo proveedor que entren por sync SII o creación manual heredan la
        categoría automáticamente. El centro de costo / proyecto NO se auto-asigna —
        siempre lo definís vos.
      </div>

      <InvoiceRulesTable
        rules={rules.map((r) => ({
          id: r.id,
          rutIssuer: r.rutIssuer,
          businessName: r.businessName,
          categoryId: r.categoryId,
          categoryLabel: r.category.parent
            ? `${r.category.parent.name} · ${r.category.name}`
            : r.category.name,
          hits: r.hits,
          createdAt: r.createdAt.toISOString(),
        }))}
        categories={categories}
      />
    </div>
  );
}
