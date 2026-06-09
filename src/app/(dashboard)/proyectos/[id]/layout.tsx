import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PROJECT_STATUSES, ProjectStatus } from "@/lib/utils";
import Link from "next/link";
import ProjectTabs from "@/components/proyecto/ProjectTabs";
import ProjectStatusMenu from "@/components/proyecto/ProjectStatusMenu";

// Layout compartido para todas las vistas dentro de un proyecto.
// Renderea el header con datos básicos + tabs de navegación entre secciones.
// Cada child page (resumen, presupuesto, EPs, facturas, lista-compra)
// hereda este layout — el usuario no pierde el contexto del proyecto al
// saltar entre secciones.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      clientName: true,
      address: true,
      status: true,
      isInternal: true,
    },
  });
  if (!project) notFound();

  const status = PROJECT_STATUSES[project.status as ProjectStatus];

  // La miga de pan se adapta al estado de la ficha: una ficha en estado
  // "cotizacion" vive bajo el menú Cotizaciones, no Proyectos. Aunque la URL
  // física es /proyectos/[id] (cotizaciones y proyectos comparten la misma
  // entidad y el mismo detalle), el link de vuelta tiene que apuntar a la
  // lista de donde realmente vino la usuaria, no llevarla siempre a Proyectos.
  const esCotizacion = project.status === "cotizacion";
  const volverHref = esCotizacion ? "/cotizaciones" : "/proyectos";
  const volverLabel = esCotizacion ? "Cotizaciones" : "Proyectos";

  return (
    <div>
      {/* Header sticky del proyecto */}
      <div className="sticky top-0 z-30 -mx-6 px-6 -mt-6 pt-6 pb-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <Link
                href={volverHref}
                className="hover:text-gray-900 transition-colors"
              >
                {volverLabel}
              </Link>
              <span className="text-gray-300">/</span>
              <span
                className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  status?.color || "bg-gray-100 text-gray-700"
                }`}
              >
                {status?.label || project.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {project.name}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {project.clientName}
              {project.address && ` · ${project.address}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href={`/proyectos/${project.id}/editar`}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-white hover:border-gray-400 transition-colors"
            >
              Editar datos
            </Link>
            {!project.isInternal && (
              <ProjectStatusMenu
                projectId={project.id}
                projectName={project.name}
                status={project.status}
              />
            )}
          </div>
        </div>

        <ProjectTabs projectId={project.id} isInternal={project.isInternal} />
      </div>

      {/* Contenido de la página activa */}
      <div className="mt-6">{children}</div>
    </div>
  );
}
