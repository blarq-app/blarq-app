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
      obraItems: { orderBy: { sortOrder: "asc" } },
      muebleItems: { orderBy: { sortOrder: "asc" } },
      artefactoItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!budget) notFound();

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/proyectos/${project.id}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {project.name}
        </Link>
        <span className="text-gray-300">/</span>
        <Link
          href={`/proyectos/${project.id}/presupuesto`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          Presupuestos
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">
          {budget.type === "obra" ? "Obra" : budget.type === "muebles" ? "Muebles" : "Artefactos"}{" "}
          {budget.version}
        </h1>
        <a
          href={`/api/presupuestos/${budget.id}/pdf`}
          target="_blank"
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
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
