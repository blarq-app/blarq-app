// SOLO LECTURA (pendiente 176): las líneas material-en-cero repartidas por
// ESTADO de la versión, para ver cuánto ruido saca la decisión de MJ de que el
// aviso solo aparezca en borradores.
// Uso: npx tsx scripts/diag-176-por-estado.ts <ruta-env-prod>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const esProvision = (d: string) => /^\s*PROVISI[OÓ]N/i.test(d);

async function main() {
  const comps = await prisma.obraItemComponent.findMany({
    where: { type: "material", quantity: 0 },
    include: {
      material: { select: { isProvision: true } },
      obraItem: {
        select: {
          name: true,
          quantity: true,
          budgetVersion: {
            select: {
              version: true,
              status: true,
              project: { select: { name: true, numeroProyecto: true } },
            },
          },
        },
      },
    },
  });

  const filas = comps
    .filter((c) => {
      const prov = esProvision(c.description) || c.material?.isProvision === true;
      return !prov && (c.unitCost || 0) > 0;
    })
    .map((c) => {
      const v = c.obraItem.budgetVersion;
      const noCobrado = (c.unitCost || 0) * (c.obraItem.quantity || 0);
      return {
        status: v.status,
        proj: `#${v.project.numeroProyecto ?? "-"} ${v.project.name}`,
        ver: v.version,
        item: c.obraItem.name,
        desc: c.description,
        noCobrado,
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status) || b.noCobrado - a.noCobrado);

  for (const f of filas) {
    console.log(
      [
        f.status.padEnd(10),
        `${f.proj} ${f.ver}`.slice(0, 30).padEnd(31),
        f.item.slice(0, 32).padEnd(34),
        f.desc.slice(0, 42).padEnd(44),
        `$${Math.round(f.noCobrado).toLocaleString("es-CL")}`.padStart(11),
      ].join(" ")
    );
  }
  const porEstado = new Map<string, { n: number; plata: number }>();
  for (const f of filas) {
    const a = porEstado.get(f.status) ?? { n: 0, plata: 0 };
    a.n++;
    a.plata += f.noCobrado;
    porEstado.set(f.status, a);
  }
  console.log("\n=== resumen por estado (TODAS las versiones, no solo vigentes) ===");
  for (const [k, v] of porEstado)
    console.log(`${k.padEnd(12)} ${String(v.n).padStart(3)} líneas · $${Math.round(v.plata).toLocaleString("es-CL")}`);
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
