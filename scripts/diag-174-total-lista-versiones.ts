// READ-ONLY. Mide el alcance de un problema de PANTALLA que apareció al
// reparar la V3 de Sena: la lista de versiones del presupuesto
// (src/app/(dashboard)/proyectos/[id]/presupuesto/page.tsx, calcObraTotal)
// suma TODAS las partidas, sin excluir las marcadas "no cobrado".
//
// El PDF del cliente (ObraPDF.html.ts), el editor (ObraEditor.tsx,
// `itemsCobrables`) y metrics.ts SÍ las excluyen. O sea: la columna
// "TOTAL C/IVA" de esa lista muestra de más en cualquier versión que tenga
// una partida no cobrada. No es plata mal calculada — el acordado del
// proyecto sale de metrics.ts y está bien; es solo ese número en pantalla.
//
// Este script NO arregla nada: cuenta a cuántas versiones les pasa.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

function urlViva(): string {
  const m = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8").match(/^DATABASE_URL=["']?(.+?)["']?$/m);
  if (!m || !/ep-shy-morning/.test(m[1])) throw new Error("ABORTO: no es la base viva");
  return m[1];
}
const prisma = new PrismaClient({ datasourceUrl: urlViva() });
const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "obra", obraItems: { some: { noCobrado: true } } },
    select: {
      id: true, version: true, status: true, ggPercentage: true, utilityPercentage: true,
      project: { select: { name: true, numeroProyecto: true } },
      obraItems: { select: { total: true, noCobrado: true, name: true } },
    },
  });

  console.log(`Versiones de obra con al menos una partida "no cobrado": ${versiones.length}\n`);
  for (const v of versiones) {
    const f = 1 + ((v.ggPercentage ?? 0) + (v.utilityPercentage ?? 0)) / 100;
    const conTodas = v.obraItems.reduce((s, i) => s + i.total, 0) * f * 1.19;
    const soloCobrables = v.obraItems.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0) * f * 1.19;
    const noCobradas = v.obraItems.filter((i) => i.noCobrado);
    console.log(`#${v.project.numeroProyecto ?? "-"} ${v.project.name} · ${v.version} (${v.status})`);
    console.log(`   la lista muestra : ${money(conTodas)}`);
    console.log(`   el PDF dice      : ${money(soloCobrables)}`);
    console.log(`   diferencia       : ${money(conTodas - soloCobrables)}`);
    console.log(`   no cobradas      : ${noCobradas.map((i) => `${i.name.replace(/\n/g, " ")} (${money(i.total)})`).join(", ")}\n`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
