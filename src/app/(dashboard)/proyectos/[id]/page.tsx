import { redirect } from "next/navigation";

// Project Detail antiguo eliminado: redundante con /resumen.
// Esta ruta ahora redirige al Resumen del proyecto.
// Cualquier link/bookmark a /proyectos/[id] sigue funcionando.
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/proyectos/${id}/resumen`);
}
