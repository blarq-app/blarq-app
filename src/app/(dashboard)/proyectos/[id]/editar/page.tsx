import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProjectForm from "@/components/ProjectForm";
import Link from "next/link";

export default async function EditarProyectoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
  });

  if (!project) {
    notFound();
  }

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
        <h1 className="text-2xl font-bold text-gray-900">Editar Proyecto</h1>
      </div>
      <ProjectForm project={project} />
    </div>
  );
}
