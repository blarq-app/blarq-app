import { prisma } from "@/lib/prisma";
import { PROJECT_STATUSES, ProjectStatus, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function ProyectosPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
        <Link
          href="/proyectos/nuevo"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + Nuevo Proyecto
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg mb-2">No hay proyectos</p>
          <Link
            href="/proyectos/nuevo"
            className="text-gray-900 underline text-sm"
          >
            Crear primer proyecto
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Proyecto
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cliente
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Version
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actualizado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((project) => {
                const status =
                  PROJECT_STATUSES[project.status as ProjectStatus];
                return (
                  <tr
                    key={project.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/proyectos/${project.id}/resumen`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.address && (
                        <p className="text-sm text-gray-500 mt-0.5">
                          {project.address}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {project.clientName}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {project.currentVersion}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(project.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
