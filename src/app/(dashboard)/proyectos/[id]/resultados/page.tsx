import { redirect } from "next/navigation";

// Redirect de la URL antigua /resultados → /resumen.
// La sección se renombró el 2026-04-27 como parte del rediseño de
// navegación A. Mantenemos el redirect para que cualquier link viejo
// (bookmark, tab abierta) siga funcionando.
export default async function LegacyResultadosRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/proyectos/${id}/resumen`);
}
