import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ObraEditor from "@/components/presupuesto/ObraEditor";
import MueblesEditor from "@/components/presupuesto/MueblesEditor";
import ArtefactosEditor from "@/components/presupuesto/ArtefactosEditor";

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
            },
          },
        },
      },
      artefactoItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!budget) notFound();

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
        <a
          href={`/api/presupuestos/${budget.id}/pdf`}
          target="_blank"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700"
        >
          Descargar PDF
        </a>
      </div>

      {budget.type === "obra" && (
        <ObraEditor budget={budget} projectId={project.id} />
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
