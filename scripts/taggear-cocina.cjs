/**
 * Asigna el "tipo" (tag) a los artefactos de cocina para que se agrupen.
 * Match por nombre con PRIORIDAD (ej. "GRIFO LAVAPLATOS" → Griferías, no Lavaplatos;
 * "LAVAPLATOS BAJO ENCIMERA" → Lavaplatos, no Encimeras).
 * Uso: node taggear-cocina.cjs           (dev, por .env)
 *      node taggear-cocina.cjs --prod     (prod, por .env.prod)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const esProd = process.argv.includes("--prod");
const url = esProd
  ? fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1]
  : fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if (esProd && !url.includes("shy-morning")) { console.error("PROD no es shy-morning. ABORTO."); process.exit(1); }
const prisma = new PrismaClient({ datasources:{ db:{ url } } });

// Reglas en orden de prioridad (la primera que matchea gana).
const reglas = [
  [/MICROONDAS/, "Microondas"],
  [/LAVAVAJILLAS/, "Lavavajillas"],
  [/REFRIGERADOR|FREEZER/, "Refrigeración"],
  [/CAMPANA/, "Campanas"],
  [/HORNO/, "Hornos"],
  [/GRIFO|GRIFERIA|GRIFERÍA/, "Griferías"],   // antes que Lavaplatos/Encimeras
  [/LAVAPLATOS|LAVADERO/, "Lavaplatos"],       // antes que Encimeras
  [/ENCIMERA/, "Encimeras"],
];
const tipoDe = (name) => { const n = name.toUpperCase(); for (const [re,t] of reglas) if (re.test(n)) return t; return null; };

async function main(){
  console.log(`Base: ${esProd ? "PROD (shy-morning)" : "DEV"}`);
  const rows = await prisma.artefactoCatalog.findMany({ where:{ subcategory:"cocina" }, select:{id:true,name:true,tag:true} });
  const porTipo = {};
  let cambiados = 0, sinMatch = 0;
  for (const r of rows){
    const t = tipoDe(r.name);
    if (!t){ console.log(`  ? sin tipo (no matchea): ${r.name}`); sinMatch++; continue; }
    (porTipo[t]=porTipo[t]||[]).push(r.name);
    if (r.tag !== t){ await prisma.artefactoCatalog.update({ where:{id:r.id}, data:{ tag:t } }); cambiados++; }
  }
  console.log(`\nCocina: ${rows.length} · actualizados: ${cambiados} · sin match: ${sinMatch}`);
  console.log("\nAgrupación resultante:");
  for (const t of ["Lavaplatos","Griferías","Hornos","Encimeras","Campanas","Refrigeración","Lavavajillas","Microondas"]){
    const xs = porTipo[t]||[];
    console.log(`  ${t} (${xs.length}): ${xs.map(n=>n.slice(0,28)).join(" · ")}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
