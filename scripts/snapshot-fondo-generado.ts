import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  computeFondoSueldos,
  PROJECT_FONDO_INCLUDE,
  type ProjectWithFondo,
} from "../src/lib/banco/fondoSueldos";

// Snapshot de control: imprime el "fondo generado" de cada proyecto con
// presupuesto. Se corre ANTES y DESPUÉS del cambio de transferencias para
// confirmar que el cálculo de lo GENERADO no se movió (el feature es
// aditivo: solo agrega "transferido/falta", no toca el generado).
async function main() {
  const projects = await prisma.project.findMany({
    where: { isInternal: false },
    include: PROJECT_FONDO_INCLUDE,
    orderBy: { numeroProyecto: { sort: "asc", nulls: "last" } },
  });

  const rows = projects
    .map((p) => {
      const f = computeFondoSueldos(p as unknown as ProjectWithFondo);
      return {
        num: p.numeroProyecto ?? "—",
        name: p.name.slice(0, 28),
        maximo: Math.round(f.totalFondoMaximo),
        generado: Math.round(f.fondoGenerado),
      };
    })
    .filter((r) => r.maximo > 0)
    .sort((a, b) => b.generado - a.generado);

  console.log("num\tgenerado\tmaximo\tnombre");
  for (const r of rows) {
    console.log(`${r.num}\t${r.generado}\t${r.maximo}\t${r.name}`);
  }
  const totGen = rows.reduce((s, r) => s + r.generado, 0);
  console.log(`---\nTOTAL generado: ${totGen}  (${rows.length} proyectos)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
