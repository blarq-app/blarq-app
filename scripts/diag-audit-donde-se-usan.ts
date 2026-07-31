/**
 * ¿En qué proyectos se usan los artefactos que la limpieza tocaría?
 *
 * SOLO LECTURA. Para cada producto del catálogo candidato, lista las líneas de
 * cotización que lo usan, con proyecto, versión, estado y si la línea está
 * "despegada" (editada a mano, que el catálogo ya no toca).
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Los 5 del dry-run: 3 "seguros" + 2 "a revisar".
const NOMBRES = [
  "HORNO EMPOTRABLE 71 L",
  "PERCHA ATLAS SIMPLE LATÓN CROMADO 2.5X5.5X5 CM",
  "GRIFERÍA LAVAMANOS URBAN-N ALTA 22 CM ANTIQUE BRONZE",
  "DOWNLIGHT LED STUDIO SLIM 10W LUZ CÁLIDA NEUTRA Y FRÍA",
  "WC ATENAS A PISO 210 MM",
];

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  for (const nombre of NOMBRES) {
    const cat = await prisma.artefactoCatalog.findFirst({
      where: { name: nombre },
      select: { id: true, name: true, listPrice: true, discountPercent: true },
    });
    if (!cat) {
      console.log(`── ${nombre}\n   (no está en el catálogo)\n`);
      continue;
    }
    // Las líneas que apuntan a este producto del catálogo…
    const porCatalogo = await prisma.artefactoItem.findMany({
      where: { catalogId: cat.id },
      select: {
        room: true, quantity: true, listPrice: true, discountPercent: true,
        clientPrice: true, priceOverridden: true,
        budgetVersion: {
          select: {
            version: true, status: true, type: true,
            project: { select: { name: true, numeroProyecto: true } },
          },
        },
      },
    });
    // …y las que se llaman igual pero NO están linkeadas (no las alcanza nada).
    const porNombreSinLink = await prisma.artefactoItem.findMany({
      where: { name: nombre, catalogId: null },
      select: {
        budgetVersion: {
          select: { version: true, status: true, project: { select: { name: true } } },
        },
      },
    });

    console.log(`── ${cat.name}`);
    console.log(
      `   catálogo hoy: ${CLP(cat.listPrice)} · ${Math.round((cat.discountPercent ?? 0) * 100)}%`
    );
    if (porCatalogo.length === 0 && porNombreSinLink.length === 0) {
      console.log("   NO se usa en ninguna cotización.\n");
      continue;
    }
    for (const it of porCatalogo) {
      const bv = it.budgetVersion;
      const proy = bv?.project?.name ?? "?";
      const num = bv?.project?.numeroProyecto ? `#${bv.project.numeroProyecto} ` : "";
      const seActualiza =
        bv?.status === "borrador" && !it.priceOverridden
          ? "SE ACTUALIZARÍA"
          : it.priceOverridden
            ? "despegada (no se toca)"
            : `${bv?.status} (congelada)`;
      console.log(
        `   · ${num}${proy} ${bv?.version} [${bv?.status}] — ${it.room} x${it.quantity} — ` +
          `${CLP(it.listPrice)} · ${Math.round((it.discountPercent ?? 0) * 100)}% · cliente ${CLP(it.clientPrice)}  → ${seActualiza}`
      );
    }
    for (const it of porNombreSinLink) {
      const bv = it.budgetVersion;
      console.log(
        `   · ${bv?.project?.name} ${bv?.version} [${bv?.status}] — mismo nombre pero SIN vínculo al catálogo (no la alcanza nada)`
      );
    }
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
