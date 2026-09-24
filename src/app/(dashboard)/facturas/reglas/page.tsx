import { prisma } from "@/lib/prisma";
import Link from "next/link";
import InvoiceRulesTable from "@/components/facturas/InvoiceRulesTable";

export default async function FacturasReglasPage() {
  const [rules, categories, projects] = await Promise.all([
    prisma.invoiceCategorizationRule.findMany({
      orderBy: [{ hits: "desc" }, { updatedAt: "desc" }],
      include: {
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
        project: { select: { id: true, name: true } },
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
    prisma.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Reparto REAL de las facturas de cada proveedor por categoría (pendiente
  // 184). Sirve para ver de un vistazo qué reglas no calzan con lo que MJ
  // hace a mano: Sodimac tenía regla "Herramientas" con 539 de 580 facturas
  // en Materiales. Dos groupBy (por RUT y por nombre exacto de los
  // internacionales sin RUT), mismo criterio de proveedor que el motor
  // (providerInvoiceWhere). Las facturas sin categoría no cuentan.
  const ruts = rules.map((r) => r.rutIssuer).filter((x): x is string => !!x);
  const nombres = rules
    .filter((r) => !r.rutIssuer && r.providerName)
    .map((r) => r.providerName!);
  const [porRut, porNombre] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["rutIssuer", "categoryId"],
      where: { rutIssuer: { in: ruts }, categoryId: { not: null } },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ["businessName", "categoryId"],
      where: { rutIssuer: null, businessName: { in: nombres }, categoryId: { not: null } },
      _count: true,
    }),
  ]);
  const reparto = new Map<string, { categoryId: string; count: number }[]>();
  const sumar = (clave: string, categoryId: string, count: number) => {
    const lista = reparto.get(clave) ?? [];
    lista.push({ categoryId, count });
    reparto.set(clave, lista);
  };
  for (const g of porRut) sumar(`rut:${g.rutIssuer}`, g.categoryId!, g._count);
  for (const g of porNombre) sumar(`nom:${g.businessName}`, g.categoryId!, g._count);

  // En el reparto va el nombre corto ("Herrajes"): con la madre delante
  // ("Muebles · Herrajes 6 · Muebles 3") el separador se confunde con el de
  // la lista. El nombre completo queda en el tooltip.
  const catNombre = new Map(categories.map((c) => [c.id, c.name]));
  const catLabel = new Map(
    categories.map((c) => [c.id, c.parent ? `${c.parent.name} · ${c.name}` : c.name])
  );

  const filas = rules.map((r) => {
    const lista = (
      reparto.get(r.rutIssuer ? `rut:${r.rutIssuer}` : `nom:${r.providerName}`) ?? []
    )
      .sort((a, b) => b.count - a.count)
      .map((x) => ({
        ...x,
        label: catNombre.get(x.categoryId) ?? "—",
        fullLabel: catLabel.get(x.categoryId) ?? "—",
      }));
    const maxCount = lista[0]?.count ?? 0;
    const deLaRegla = lista.find((x) => x.categoryId === r.categoryId)?.count ?? 0;
    // Calza si la categoría de la regla es la mayoritaria (o empata con ella:
    // Salcobrand tiene 1 y 1, no hay mayoría que reclamar). Sin facturas
    // categorizadas no hay con qué comparar → no se marca.
    const noCalza = !!r.categoryId && lista.length > 0 && deLaRegla < maxCount;
    return {
      id: r.id,
      rutIssuer: r.rutIssuer,
      businessName: r.businessName,
      categoryId: r.categoryId,
      categoryLabel: r.category
        ? r.category.parent
          ? `${r.category.parent.name} · ${r.category.name}`
          : r.category.name
        : null,
      projectId: r.projectId,
      projectLabel: r.project?.name ?? null,
      hits: r.hits,
      createdAt: r.createdAt.toISOString(),
      reparto: lista,
      noCalza,
    };
  });
  // Las que no calzan, arriba: es lo que MJ viene a arreglar.
  filas.sort((a, b) => Number(b.noCalza) - Number(a.noCalza));

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
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
        Una regla <span className="font-medium">proveedor → categoría / proyecto</span>{" "}
        se guarda solo cuando la pedís: en /facturas, al asignar varias
        facturas, prendiendo "Guardar categoría en regla" o "Guardar centro de
        costo en regla". Cambiar la categoría de una factura suelta no toca la
        regla. Las próximas facturas del mismo proveedor que entren por sync
        SII heredan estos valores. El proveedor se reconoce por su RUT; los
        internacionales sin RUT (Google Workspace, Anthropic…) por su nombre
        exacto. Las marcadas en ámbar no coinciden con la categoría que tiene
        la mayoría de sus facturas.
      </div>

      <InvoiceRulesTable
        rules={filas}
        categories={categories}
        projects={projects}
      />
    </div>
  );
}
