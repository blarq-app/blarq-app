// FASE 0 — diagnóstico SOLO LECTURA de la selección de versiones por proyecto.
//
// Para cada proyecto lista sus BudgetVersion (obra/muebles/artefactos) con
// status, fechas y linaje (parentVersionId → raíz), y compara:
//   - selección de HOY (metrics.ts): obra = allApproved (todas las aprobadas;
//     si no hay, la más reciente); muebles/artefactos = bestVersion (aprobada
//     más reciente, si no la más reciente).
//   - selección PROPUESTA: agrupar por linaje; dentro de cada linaje tomar la
//     más reciente con status en {enviado, aprobado} (excluir borrador y
//     rechazado); sumar entre linajes. Si un linaje no tiene enviado/aprobado,
//     no aporta.
// Marca los proyectos donde la selección CAMBIARÍA (los que moverían totales).
//
// Uso: npx tsx scripts/diag-versiones-seleccion.ts <ruta-env>   (ej. .env.prod)
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

type V = {
  id: string;
  version: string;
  status: string;
  type: string;
  createdAt: Date;
  sentAt: Date | null;
  parentVersionId: string | null;
};

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");
const short = (id: string) => id.slice(-5);

// Raíz del linaje: subir por parentVersionId mientras el padre esté en el set.
function lineageRoot(v: V, byId: Map<string, V>): string {
  let cur = v;
  const seen = new Set<string>();
  while (cur.parentVersionId && byId.has(cur.parentVersionId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentVersionId)!;
  }
  return cur.id;
}

// HOY: obra = allApproved; muebles/artefactos = bestVersion.
function currentSelection(arr: V[], type: string): Set<string> {
  const sorted = [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (type === "obra") {
    const aprob = arr.filter((b) => b.status === "aprobado");
    if (aprob.length > 0) return new Set(aprob.map((b) => b.id));
    return sorted[0] ? new Set([sorted[0].id]) : new Set();
  }
  // bestVersion
  const aprob = arr
    .filter((b) => b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const pick = aprob ?? sorted[0];
  return pick ? new Set([pick.id]) : new Set();
}

// PROPUESTA (Opción A, robusta al linaje roto):
//   - 2+ aprobadas del tipo → ANEXO: sumar todas las aprobadas (como hoy).
//   - si no → la más reciente con status en {enviado, aprobado} (una nueva
//     enviada le gana a una aprobada más vieja; los borradores se excluyen).
//   - si NO hay ninguna enviada/aprobada → fallback a la más reciente (incl.
//     borrador), igual que hoy (para no dejar en blanco un proyecto que
//     recién está en borrador).
function proposedSelection(arr: V[], _byId: Map<string, V>): Set<string> {
  const aprobadas = arr.filter((b) => b.status === "aprobado");
  if (aprobadas.length >= 2) return new Set(aprobadas.map((b) => b.id));
  const pool = arr
    .filter((b) => b.status === "enviado" || b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (pool[0]) return new Set([pool[0].id]);
  const fallback = [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return fallback ? new Set([fallback.id]) : new Set();
}

const eqSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

async function main() {
  console.log(`=== ENV: ${envPath} | HOST: ${host} ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name} (viva = "Paseo del Sena")\n`);

  const projects = await prisma.project.findMany({
    orderBy: { numeroProyecto: "asc" },
    select: {
      id: true,
      name: true,
      numeroProyecto: true,
      budgetVersions: {
        select: { id: true, version: true, status: true, type: true, createdAt: true, sentAt: true, parentVersionId: true },
      },
    },
  });

  const conAnexo: string[] = [];
  const conMuebles: string[] = [];
  const cambian: string[] = [];

  for (const p of projects) {
    if (p.budgetVersions.length === 0) continue;
    const byId = new Map(p.budgetVersions.map((v) => [v.id, v as V]));
    const label = `#${p.numeroProyecto ?? "?"} ${p.name}`;

    let projChanges = false;
    const lines: string[] = [];
    for (const type of ["obra", "muebles", "artefactos"]) {
      const arr = p.budgetVersions.filter((v) => v.type === type) as V[];
      if (arr.length === 0) continue;
      const cur = currentSelection(arr, type);
      const prop = proposedSelection(arr, byId);
      const changed = !eqSet(cur, prop);
      if (changed) projChanges = true;

      // Linajes distintos con selección vigente → anexo (solo obra).
      const linajesVigentes = new Set(
        [...prop].map((id) => lineageRoot(byId.get(id)!, byId))
      );
      if (type === "obra" && linajesVigentes.size > 1) conAnexo.push(label);
      if (type === "muebles" && prop.size > 0) conMuebles.push(label);

      const detalle = [...arr]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((v) => {
          const flags = [
            cur.has(v.id) ? "HOY" : "",
            prop.has(v.id) ? "PROP" : "",
          ].filter(Boolean).join("+");
          return `${v.version}[${v.status}] cre ${d(v.createdAt)} env ${d(v.sentAt)} lin ${short(lineageRoot(v, byId))}${flags ? ` <${flags}>` : ""}`;
        })
        .join("  |  ");
      lines.push(`   ${type.padEnd(10)} ${changed ? "CAMBIA" : "igual "} :: ${detalle}`);
    }
    if (projChanges) cambian.push(label);
    console.log(`${label}${projChanges ? "   *** CAMBIA ***" : ""}`);
    lines.forEach((l) => console.log(l));
    console.log("");
  }

  console.log("──────── RESUMEN ────────");
  console.log(`Proyectos con ANEXO de obra (2+ linajes vigentes): ${[...new Set(conAnexo)].join(" | ") || "ninguno"}`);
  console.log(`Proyectos con muebles vigentes: ${[...new Set(conMuebles)].length}`);
  console.log(`Proyectos cuya SELECCIÓN cambiaría con la regla nueva: ${cambian.length}`);
  cambian.forEach((c) => console.log(`   - ${c}`));
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); }).finally(() => prisma.$disconnect());
