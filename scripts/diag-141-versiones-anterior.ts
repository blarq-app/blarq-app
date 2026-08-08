// Diagnóstico solo-lectura (pendiente 141): qué versiones tiene cada proyecto
// por tipo, para ver cuál sería "la versión anterior" del Cuadro Resumen y en
// cuántas obras existe (o sea, dónde se va a poder ofrecer la comparación).
//
// Uso: npx tsx scripts/diag-141-versiones-anterior.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log(`=== ENV: ${envPath} | HOST: ${host} ===\n`);

  const proyectos = await prisma.project.findMany({
    where: { budgetVersions: { some: {} }, isInternal: false },
    select: {
      id: true,
      name: true,
      numeroProyecto: true,
      budgetVersions: {
        select: {
          version: true,
          type: true,
          status: true,
          createdAt: true,
          parentVersionId: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { numeroProyecto: "asc" },
  });

  let conAnterior = 0;
  for (const p of proyectos) {
    const lineas: string[] = [];
    let tieneAnterior = false;
    for (const tipo of ["obra", "muebles", "artefactos"]) {
      const delTipo = p.budgetVersions.filter((b) => b.type === tipo);
      if (delTipo.length === 0) continue;
      // Mismo criterio que selectVigentes: enviadas/aprobadas, más nueva primero.
      const publicadas = delTipo
        .filter((b) => b.status === "enviado" || b.status === "aprobado")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const vigente = publicadas[0] ?? [...delTipo].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const anterior = publicadas[1];
      if (anterior) tieneAnterior = true;
      const conLinaje = delTipo.filter((b) => b.parentVersionId).length;
      lineas.push(
        `    ${tipo.padEnd(10)} vigente=${vigente?.version ?? "-"}(${vigente?.status ?? "-"})` +
          `  anterior=${anterior ? `${anterior.version}(${anterior.status})` : "—"}` +
          `  [${delTipo.length} versiones, ${conLinaje} con papá]`
      );
    }
    if (tieneAnterior) conAnterior++;
    console.log(`#${p.numeroProyecto ?? "-"} ${p.name}`);
    lineas.forEach((l) => console.log(l));
  }

  console.log(
    `\nProyectos con al menos un concepto comparable: ${conAnterior} de ${proyectos.length}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
