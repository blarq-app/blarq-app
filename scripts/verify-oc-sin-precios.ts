// Verificación de la REGLA DURA de este PDF: no se puede colar ningún precio.
// Dos chequeos independientes sobre la orden de compra, contra la base VIVA:
//   1) estructural — el texto no puede tener signos de peso, montos con
//      separador de miles, ni los rótulos de plata (Dcto / P. lista / IVA);
//   2) por dato — ninguno de los montos REALES de cada ítem (precio lista,
//      precio cliente, costo BLARQ), formateados como los escribe la app,
//      puede aparecer en el texto.
// Es SOLO LECTURA. Uso: npx tsx scripts/verify-oc-sin-precios.ts <budgetId>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { renderOrdenCompraArtefactosHTML } from "../src/lib/pdf/OrdenCompraArtefactosPDF.html";

// DATABASE_URL leído DIRECTO del archivo (nada de dotenv, que carga la copia
// vieja ep-solitary-mud). CLAUDE.md §4.9.
const raw = readFileSync(".env.prod", "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Texto visible: sin las imágenes en base64 (que traen "IVA"/"Dcto" por azar
// dentro del blob) y sin etiquetas ni CSS.
function textoVisible(html: string): string {
  return html
    .replace(/src="data:[^"]*"/g, 'src="[img]"')
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const PATRONES: Array<[string, RegExp]> = [
  ["signo de peso con monto", /\$\s?\d/],
  ["monto con separador de miles", /\b\d{1,3}(\.\d{3})+\b/],
  ["rótulo Dcto", /\bDcto\b/i],
  ["rótulo P. lista", /P\.\s?lista/i],
  ["mención de IVA", /\bIVA\b/],
  ["mención de descuento", /\bdescuento/i],
];

async function main() {
  const budgetId = process.argv[2];
  console.log(`HOST: ${host}`);

  const budget = await prisma.budgetVersion.findUnique({
    where: { id: budgetId },
    include: { project: true, artefactoItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!budget) throw new Error("no existe ese presupuesto");
  console.log(`Presupuesto: ${budget.project.name} ${budget.version}`);

  let fallas = 0;
  let chequeos = 0;

  for (const sub of ["sanitario", "cocina", "iluminacion"]) {
    const items = budget.artefactoItems.filter(
      (it) => (it.subcategory || "sanitario") === sub
    );
    if (items.length === 0) continue;

    {
      const html = renderOrdenCompraArtefactosHTML({
        project: budget.project,
        budget: { version: budget.version, date: budget.date },
        subcategory: sub,
        items,
      });
      const texto = textoVisible(html);
      const etiqueta = sub;

      // 1) patrones genéricos de plata. La frase "sin precios" del pie es
      //    intencional y no matchea ninguno de los patrones (no lleva monto).
      for (const [nombre, re] of PATRONES) {
        chequeos++;
        const m = texto.match(re);
        if (m) {
          fallas++;
          console.log(`  FALLA ${etiqueta}: ${nombre} → "${m[0]}"`);
        }
      }

      // 2) los montos REALES de cada ítem, como los formatea la app.
      for (const it of items) {
        for (const [campo, valor] of [
          ["listPrice", it.listPrice],
          ["clientPrice", it.clientPrice],
          ["clientPrice×cant", it.clientPrice * it.quantity],
          ["realCostBlarq", it.realCostBlarq ?? 0],
        ] as Array<[string, number]>) {
          if (!valor) continue;
          const comoLoEscribeLaApp = Math.round(valor).toLocaleString("es-CL");
          chequeos++;
          if (texto.includes(comoLoEscribeLaApp)) {
            fallas++;
            console.log(
              `  FALLA ${etiqueta}: ${campo} de "${it.name}" = ${comoLoEscribeLaApp} aparece en el texto`
            );
          }
        }
      }
      console.log(`  OK ${etiqueta} (${items.length} ítems revisados)`);
    }
  }

  console.log(`\n${chequeos} chequeos · ${fallas} fallas`);
  if (fallas > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
