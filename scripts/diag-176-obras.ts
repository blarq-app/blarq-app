// Diagnóstico SOLO LECTURA (pendiente 176), lado OBRAS: componentes material
// con cantidad 0 en las versiones VIGENTES. Mide si isProvision (el campo que
// ya existe en MaterialCatalog) alcanza para separar las dos familias, o si
// hace falta mirar también la descripción.
// Uso: npx tsx scripts/diag-176-obras.ts <ruta-env-prod>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const esProvision = (d: string) => /^\s*PROVISI[OÓ]N/i.test(d);

async function main() {
  // Versión vigente = mismo criterio que selectVersion.ts (fuente única):
  // la más reciente enviada/aprobada por proyecto; si no hay
  // ninguna, la más reciente aunque sea borrador.
  const todas = await prisma.budgetVersion.findMany({
    where: { type: "obra" },
    select: {
      id: true,
      projectId: true,
      status: true,
      createdAt: true,
      project: { select: { name: true, numeroProyecto: true } },
    },
  });
  const porProyecto = new Map<string, typeof todas>();
  for (const v of todas) {
    const arr = porProyecto.get(v.projectId) ?? [];
    arr.push(v);
    porProyecto.set(v.projectId, arr);
  }
  const desc = (a: (typeof todas)[0], b: (typeof todas)[0]) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  const versiones = [...porProyecto.values()].map((arr) => {
    const pub = arr
      .filter((v) => v.status === "enviado" || v.status === "aprobado")
      .sort(desc);
    return pub[0] ?? [...arr].sort(desc)[0];
  });
  console.log("versiones vigentes:", versiones.length, "\n");

  const comps = await prisma.obraItemComponent.findMany({
    where: {
      type: "material",
      quantity: 0,
      obraItem: { budgetVersionId: { in: versiones.map((v) => v.id) } },
    },
    include: {
      material: { select: { isProvision: true } },
      obraItem: { select: { name: true, budgetVersionId: true } },
    },
  });

  const byVer = new Map(versiones.map((v) => [v.id, v]));
  let mismatch = 0;
  let avisables = 0;
  let plantillas = 0;
  let netoAvisable = 0;
  const filas: string[] = [];

  for (const c of comps) {
    const prov = esProvision(c.description);
    const flag = c.material?.isProvision ?? null;
    if (prov !== (flag === true)) mismatch++;
    const plantilla = (c.unitCost || 0) === 0;
    if (plantilla) plantillas++;
    // Criterio propuesto: avisar solo si NO es provisión y SÍ tiene precio.
    const avisar = !prov && flag !== true && !plantilla;
    if (avisar) {
      avisables++;
      netoAvisable += c.unitCost || 0;
    }
    const v = byVer.get(c.obraItem.budgetVersionId)!;
    filas.push(
      [
        avisar ? "AVISAR " : prov || flag === true ? "provis." : "vacía  ",
        `isProv=${flag === null ? "SIN-MAT" : flag}`.padEnd(15),
        prov !== (flag === true) ? "≠≠" : "  ",
        `$${Math.round(c.unitCost).toLocaleString("es-CL")}`.padStart(11),
        `| #${v.project.numeroProyecto ?? "-"} ${v.project.name.slice(0, 22)}`.padEnd(30),
        `| ${c.obraItem.name.slice(0, 34)}`.padEnd(37),
        `| ${c.description.slice(0, 46)}`,
      ].join(" ")
    );
  }
  filas.sort();
  console.log(filas.join("\n"));
  console.log(
    `\nTOTAL líneas material qty=0 en vigentes: ${comps.length}` +
      `\n  · a AVISAR (material real, con precio): ${avisables} — neto $${Math.round(netoAvisable).toLocaleString("es-CL")}` +
      `\n  · provisión (correctas, no avisar): ${comps.length - avisables - plantillas}` +
      `\n  · plantillas vacías (precio 0, no avisar): ${plantillas}` +
      `\n  · desacuerdo descripción-vs-isProvision: ${mismatch}`
  );
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
