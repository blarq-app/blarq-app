import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ObraEditor from "@/components/presupuesto/ObraEditor";
import MueblesEditor from "@/components/presupuesto/MueblesEditor";
import ArtefactosEditor from "@/components/presupuesto/ArtefactosEditor";
import CoverFields from "@/components/presupuesto/CoverFields";
import DescargasMaestro from "@/components/presupuesto/DescargasMaestro";
import { getObraBaselineItems } from "@/lib/presupuesto/versionDiff";
import {
  esTipoCondiciones,
  parseCondiciones,
} from "@/lib/presupuesto/condiciones";
import { getPlantillaCondiciones } from "@/lib/presupuesto/condicionesPlantilla";

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
        include: {
          components: {
            orderBy: { sortOrder: "asc" },
            // `isProvision` del material: lo necesita el aviso de "material
            // escrito pero no cobrado" para NO marcar las provisiones, que
            // están en cantidad 0 a propósito (ver materialSinCobrar.ts).
            include: { material: { select: { isProvision: true } } },
          },
        },
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

  // Las condiciones que se van a editar (y que salen en el PDF). Si la versión
  // es anterior al cambio no tiene propias: se muestran las de la plantilla,
  // que es exactamente el texto fijo que ese PDF venía imprimiendo. Así el
  // editor nunca arranca en blanco.
  const condiciones =
    parseCondiciones(budget.conditions) ??
    (esTipoCondiciones(budget.type)
      ? await getPlantillaCondiciones(budget.type)
      : []);
  const budgetConCondiciones = { ...budget, conditions: condiciones };

  // Base de comparación entre versiones: items de la foto de la última versión
  // enviada al cliente (o null si no hay). El editor calcula las marcas al
  // vuelo contra esto, así se actualizan mientras MJ edita. Solo obra.
  const baselineItems =
    budget.type === "obra" ? await getObraBaselineItems(budget) : null;

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
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
          {/* PDF y Excel del maestro. El tilde "con precios" decide si salen
              en blanco (para que cotice) o con la mano de obra acordada (trato
              cerrado) — por eso es un componente de cliente. */}
          {budget.type === "obra" && <DescargasMaestro budgetId={budget.id} />}
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
                title={`Orden de compra: listado de artefactos de ${s.label} SIN precios, para mandarle al proveedor`}
              >
                OC {s.label}
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
          budget={budgetConCondiciones}
          projectId={project.id}
          baselineItems={baselineItems}
        />
      )}
      {budget.type === "muebles" && (
        <MueblesEditor budget={budgetConCondiciones} projectId={project.id} />
      )}
      {budget.type === "artefactos" && (
        <ArtefactosEditor budget={budgetConCondiciones} projectId={project.id} />
      )}
    </div>
  );
}
