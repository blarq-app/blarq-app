import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ObraEditor from "@/components/presupuesto/ObraEditor";
import MueblesEditor from "@/components/presupuesto/MueblesEditor";
import ArtefactosEditor from "@/components/presupuesto/ArtefactosEditor";
import CoverFields from "@/components/presupuesto/CoverFields";
import { getObraBaselineItems } from "@/lib/presupuesto/versionDiff";

// Subcategorías de artefactos que pueden salir como orden de compra al
// proveedor. El rótulo es el que usa MJ al hablar ("baño", no "sanitario").
const ORDEN_COMPRA_SUBCATS = [
  { key: "sanitario", label: "baño" },
  { key: "cocina", label: "cocina" },
  { key: "iluminacion", label: "iluminación" },
];

export default async function PresupuestoDetailPage({
  params,
}: {
  params: Promise<{ id: string; budgetId: string }>;
}) {
  const { id, budgetId } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
  });

  if (!project) notFound();

  const budget = await prisma.budgetVersion.findUnique({
    where: { id: budgetId },
    include: {
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: {
        orderBy: { sortOrder: "asc" },
        include: { components: { orderBy: { sortOrder: "asc" } } },
      },
      muebleChapters: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              details: { orderBy: { sortOrder: "asc" } },
              quotes: { orderBy: { sortOrder: "asc" } },
              herrajes: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      artefactoItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!budget) notFound();

  // Base de comparación entre versiones: items de la foto de la última versión
  // enviada al cliente (o null si no hay). El editor calcula las marcas al
  // vuelo contra esto, así se actualizan mientras MJ edita. Solo obra.
  const baselineItems =
    budget.type === "obra" ? await getObraBaselineItems(budget) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/proyectos/${project.id}/presupuesto`}
            className="text-gray-500 hover:text-gray-900"
          >
            ← Presupuestos
          </Link>
          <span className="text-gray-300">/</span>
          <span className="font-medium text-gray-900">
            {budget.type === "obra" ? "Obra" : budget.type === "muebles" ? "Muebles" : "Artefactos"}{" "}
            {budget.version}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {budget.type === "obra" && (
            <>
              <a
                href={`/api/presupuestos/${budget.id}/maestro?format=pdf`}
                target="_blank"
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                title="PDF con las partidas y cantidades, sin precios — para que el maestro cotice"
              >
                PDF maestro
              </a>
              <a
                href={`/api/presupuestos/${budget.id}/maestro?format=xlsx`}
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                title="Excel editable con fórmulas — el maestro completa P.U. y el TOTAL se calcula solo"
              >
                Excel maestro
              </a>
            </>
          )}
          {/* Listado de herrajes para el mueblista (sin precios), solo si la
              cotización de muebles tiene herrajes cargados. */}
          {budget.type === "muebles" &&
            budget.muebleChapters.some((ch) =>
              ch.items.some((i) => i.herrajes.length > 0),
            ) && (
              <a
                href={`/api/presupuestos/${budget.id}/pdf?tipo=mueblista`}
                target="_blank"
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                title="Listado de herrajes por sector SIN precios, para pasarle al mueblista"
              >
                PDF mueblista
              </a>
            )}
          {/* Órdenes de compra al proveedor: los mismos artefactos SIN precios,
              una por subcategoría (cada una se le compra a una empresa
              distinta). Solo se muestra el botón de las subcategorías que la
              cotización realmente tiene cargadas. */}
          {budget.type === "artefactos" &&
            ORDEN_COMPRA_SUBCATS.filter((s) =>
              budget.artefactoItems.some(
                (i) => (i.subcategory || "sanitario") === s.key,
              ),
            ).map((s) => (
              <a
                key={s.key}
                href={`/api/presupuestos/${budget.id}/pdf?tipo=orden-compra&sub=${s.key}`}
                target="_blank"
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                title={`Listado de artefactos de ${s.label} SIN precios, para mandarle al proveedor`}
              >
                Orden {s.label}
              </a>
            ))}
          <a
            href={`/api/presupuestos/${budget.id}/pdf`}
            target="_blank"
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700"
          >
            Descargar PDF
          </a>
        </div>
      </div>

      <CoverFields
        budgetId={budget.id}
        type={budget.type}
        projectName={project.name}
        address={project.address}
        initialTitle={budget.coverTitle}
        initialSubtitle={budget.coverSubtitle}
        initialNote={budget.coverNote}
      />

      {budget.type === "obra" && (
        <ObraEditor
          budget={budget}
          projectId={project.id}
          baselineItems={baselineItems}
        />
      )}
      {budget.type === "muebles" && (
        <MueblesEditor budget={budget} projectId={project.id} />
      )}
      {budget.type === "artefactos" && (
        <ArtefactosEditor budget={budget} projectId={project.id} />
      )}
    </div>
  );
}
