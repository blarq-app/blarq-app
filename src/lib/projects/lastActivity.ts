// Última actividad de un proyecto: la fecha más reciente entre sus
// movimientos relevantes. Sirve para la columna "Últ Mov" del listado
// y para ordenar/atenuar.

type ProjectShape = {
  updatedAt: Date;
  invoices: Array<{ issueDate: Date; syncedAt?: Date | null }>;
  estadosPago: Array<{ date: Date }>;
};

export function getLastActivity(project: ProjectShape): Date {
  let max = project.updatedAt.getTime();
  for (const inv of project.invoices) {
    const t = (inv.syncedAt ?? inv.issueDate).getTime();
    if (t > max) max = t;
  }
  for (const ep of project.estadosPago) {
    const t = ep.date.getTime();
    if (t > max) max = t;
  }
  return new Date(max);
}
