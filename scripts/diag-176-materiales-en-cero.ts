// Diagnóstico SOLO LECTURA (pendiente 176): componentes tipo material con
// cantidad 0 en el catálogo de partidas y en las versiones vigentes de obra.
// Objetivo: ver si el campo YA EXISTENTE MaterialCatalog.isProvision separa
// solo la familia "PROVISION ..." (que está bien, BLARQ solo instala) de la
// que sí hay que avisar (material que BLARQ pone y no está cobrando).
// Uso: npx tsx scripts/diag-176-materiales-en-cero.ts <ruta-env-prod>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const esProvision = (d: string) => /^\s*PROVISI[OÓ]N/i.test(d);

async function main() {
  console.log("HOST:", host);
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador #64 =", p64?.name, "\n");

  const comps = await prisma.partidaComponent.findMany({
    where: { type: "material", quantity: 0 },
    include: {
      partida: { select: { name: true, category: true } },
      material: { select: { name: true, isProvision: true } },
    },
  });
  console.log("=== CATALOGO: componentes material con quantity=0 ===");
  console.log(
    "total:",
    comps.length,
    "| partidas distintas:",
    new Set(comps.map((c) => c.partidaId)).size,
    "\n"
  );

  let okProv = 0;
  let mismatch = 0;
  let sinPrecio = 0;
  for (const c of comps) {
    const prov = esProvision(c.description);
    const flag = c.material?.isProvision ?? null;
    const conc = prov === (flag === true);
    if ((c.unitCost || 0) === 0) sinPrecio++;
    if (prov) okProv++;
    if (!conc) mismatch++;
    console.log(
      [
        prov ? "PROV-desc" : "material ",
        `isProv=${flag === null ? "SIN-MATERIAL" : flag}`.padEnd(20),
        conc ? "  " : "≠≠",
        `$${Math.round(c.unitCost).toLocaleString("es-CL")}`.padStart(11),
        `| ${c.partida.name.slice(0, 40)}`.padEnd(43),
        `| ${c.description.slice(0, 50)}`,
      ].join(" ")
    );
  }
  console.log(
    `\nresumen catálogo: PROVISION-por-descripción=${okProv} · desacuerdo con isProvision=${mismatch} · con unitCost=0 (plantilla vacía)=${sinPrecio}`
  );
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
