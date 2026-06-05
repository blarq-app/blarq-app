/**
 * SOLO LECTURA. Dump del estado actual de la cotización "Depto Colon" /
 * Constanza Bravo, versión V1, en PRODUCCIÓN, para compararla contra el PDF
 * enviado (08-05-26). NO escribe nada.
 *
 * Apunta explícitamente a .env.prod (ep-shy-morning). Correr desde la raíz
 * del worktree:
 *   npx tsx scripts/diag-depto-colon-v1.ts
 */
import { config } from "dotenv";
// override:true es CLAVE: si DATABASE_URL ya estaba en el entorno (apuntando
// a dev), dotenv NO la pisa por default y terminás leyendo dev sin darte
// cuenta. Forzamos prod.
config({ path: ".env.prod", override: true }); // prod, solo lectura
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Verificación dura: mostrar a qué host nos conectamos antes de nada.
const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "??";
console.log(`>>> DATABASE_URL host: ${host}`);
if (!host.includes("ep-shy-morning")) {
  console.error("ABORTO: no estoy en prod (ep-shy-morning). Host=" + host);
  process.exit(1);
}

async function main() {
  // Buscar el proyecto por nombre de cliente / obra
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { clientName: { contains: "Constanza", mode: "insensitive" } },
        { clientName: { contains: "Bravo", mode: "insensitive" } },
        { name: { contains: "Colon", mode: "insensitive" } },
        { name: { contains: "Colón", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, clientName: true, numeroProyecto: true, numeroCotizacion: true, status: true },
  });
  console.log("== PROYECTOS CANDIDATOS ==");
  console.dir(projects, { depth: null });

  // Listar todas las versiones de los proyectos candidatos (para ubicar la real en prod).
  for (const p of projects) {
    const vs = await prisma.budgetVersion.findMany({
      where: { projectId: p.id },
      select: { id: true, version: true, status: true, type: true, ggPercentage: true, utilityPercentage: true, discountPercentage: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\n-- versiones de ${p.name}:`);
    console.dir(vs, { depth: null });
  }

  // Versión a inspeccionar: por arg, o auto-detecta la obra "Sin ampliación".
  let VERSION_ID = process.argv[2];
  if (!VERSION_ID) {
    const v = await prisma.budgetVersion.findFirst({
      where: {
        project: { is: { OR: [{ clientName: { contains: "Bravo", mode: "insensitive" } }, { name: { contains: "Colon", mode: "insensitive" } }] } },
        type: "obra",
        version: { contains: "Sin ampli", mode: "insensitive" },
      },
      select: { id: true },
    });
    VERSION_ID = v?.id ?? "";
  }
  if (!VERSION_ID) {
    console.log("\n(no se resolvió VERSION_ID — pasá uno por arg)");
    return;
  }
  console.log(`\n>>> Inspeccionando VERSION_ID=${VERSION_ID}`);

  // Valores del PDF enviado (08-05-26), tal cual los dictó MJ.
  // [nombre, unidad, cantidad, P.U., total]
  const PDF: [string, string, number, number, number][] = [
    ["Retiro mobiliario cocina", "GL", 1, 195000, 195000],
    ["Retiro piso cerámico", "M2", 12.5, 9634, 120419],
    ["Retiro revestimiento cerámico", "M2", 28.11, 6469, 181849],
    ["Demolición tabique", "M2", 6.05, 15000, 90750],
    ["Enlucido de muros", "M2", 16.77, 12967, 217453],
    ["Instalación volcanita", "M2", 17.38, 16456, 285999],
    ["Construcción tabique interior", "M2", 1.44, 66356, 95553],
    ["Nuevo arranque eléctrico", "UN", 2, 55200, 110400],
    ["Enchufe/interruptor nuevo Sinthesi S33", "UN", 7, 53974, 377815],
    ["Cambio módulo eléctrico", "UN", 10, 9500, 95000],
    ["Instalación campana", "UN", 1, 48000, 48000],
    ["Instalación horno eléctrico", "UN", 1, 23150, 23150],
    ["Instalación microondas", "UN", 1, 30000, 30000],
    ["Modificaciones sanitarias cocina", "GL", 1, 152955, 152955],
    ["Instalación grifería lavaplatos", "UN", 1, 38500, 38500],
    ["Instalación encimera gas", "UN", 1, 46000, 46000],
    ["Llave de paso gas", "UN", 1, 79496, 79496],
    ["Modificación tubería gas", "GL", 1, 90276, 90276],
    ["Instalación desagüe lavaplatos/lavamanos", "UN", 1, 37092, 37092],
    ["Instalación lavadora y secadora", "UN", 1, 40000, 40000],
    ["Instalación pavimento porcelanato", "M2", 12.5, 36947, 461833],
    ["Pintura de muros", "M2", 28.11, 11175, 314131],
    ["Pintura de cielos baños/cocina", "M2", 12.5, 9144, 114295],
    ["Instalación guardapolvo porcelanato", "ML", 16.61, 16919, 281028],
    ["Puerta metálica con vidrio", "UN", 1, 714000, 714000],
    ["Limpieza y cuidado general de obra", "GL", 1, 408643, 408643],
    ["Retiro de escombros mediano", "UN", 2, 243136, 486272],
  ];

  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: VERSION_ID },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      itemNumber: true,
      name: true,
      unit: true,
      quantity: true,
      unitPrice: true,
      total: true,
      costMaterial: true,
      costLabor: true,
      costTools: true,
      costSubcontract: true,
      costMargin: true,
      costLoss: true,
      catalogPartidaId: true,
      isCustomized: true,
      components: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          type: true,
          description: true,
          unit: true,
          quantity: true,
          unitCost: true,
          totalCost: true,
          materialId: true,
          originComponentId: true,
          isCustomized: true,
          appliedToComponentId: true,
          appliedToType: true,
        },
      },
    },
  });

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

  console.log(`\n== COMPARATIVA PARTIDA POR PARTIDA (V1_Sin ampliación, aprobado) ==`);
  console.log(
    "match | item | nombre | un | cant(pdf/hoy) | PU(pdf/hoy) | total(pdf/hoy) | ΔPU"
  );
  let sumPdf = 0;
  let sumHoy = 0;
  const usados = new Set<string>();
  for (const [name, unit, qty, pu, total] of PDF) {
    sumPdf += total;
    const hit = items.find(
      (it) => !usados.has(it.id) && norm(it.name) === norm(name)
    );
    if (!hit) {
      console.log(`SIN-MATCH | — | ${name} | ${unit} | ${qty} | ${pu} | ${total} | (no encontrada por nombre exacto)`);
      continue;
    }
    usados.add(hit.id);
    sumHoy += hit.total;
    const dPU = Math.round(hit.unitPrice - pu);
    const flag = dPU === 0 ? "OK   " : "DRIFT";
    console.log(
      `${flag} | ${hit.itemNumber} | ${name} | ${unit}/${hit.unit} | ${qty}/${hit.quantity} | ${pu}/${Math.round(hit.unitPrice)} | ${total}/${Math.round(hit.total)} | ${dPU}`
    );
  }

  // Partidas en la base que NO matchearon ninguna línea del PDF
  const sinUsar = items.filter((it) => !usados.has(it.id));
  if (sinUsar.length) {
    console.log(`\n== PARTIDAS EN BASE SIN MATCH EN EL PDF (${sinUsar.length}) ==`);
    for (const it of sinUsar) {
      console.log(`  ${it.itemNumber} | ${it.name} | ${it.unit} | ${it.quantity} | PU ${Math.round(it.unitPrice)} | total ${Math.round(it.total)}`);
    }
  }

  console.log(`\n== TOTALES (costo directo = suma de partidas) ==`);
  console.log(`  PDF (dictado MJ): ${sumPdf}`);
  console.log(`  Base hoy        : ${Math.round(sumHoy)}`);
  console.log(`  Δ               : ${Math.round(sumHoy - sumPdf)}`);
  console.log(`  PDF costo directo declarado: 5135908`);

  // Detalle de componentes de las partidas que driftearon
  console.log(`\n== DETALLE DE COMPONENTES (todas las partidas) ==`);
  for (const it of items) {
    const sumComp = it.components.reduce((a, c) => a + c.totalCost, 0);
    const consistente = Math.abs(sumComp - it.unitPrice) < 1 ? "OK" : `DESCUADRE (suma comp=${Math.round(sumComp)} vs PU=${Math.round(it.unitPrice)})`;
    console.log(`\n[${it.itemNumber}] ${it.name} — PU hoy ${Math.round(it.unitPrice)} — total ${Math.round(it.total)} — cant=${it.quantity} — consistencia=${consistente} — catalogPartidaId=${it.catalogPartidaId ?? "—"} isCustomized=${it.isCustomized}`);
    console.log(`    cost: mat=${it.costMaterial} mo=${it.costLabor} herr=${it.costTools} sub=${it.costSubcontract} margen=${it.costMargin} perdida=${it.costLoss}`);
    for (const c of it.components) {
      console.log(`    - ${c.type} | "${c.description}" | ${c.unit} | q=${c.quantity} | uc=${c.unitCost} | tc=${c.totalCost} | mat=${c.materialId ? "sí" : "—"} origin=${c.originComponentId ? "sí" : "—"} cust=${c.isCustomized} appliedTo=${c.appliedToComponentId ?? "—"}/${c.appliedToType ?? "—"}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
