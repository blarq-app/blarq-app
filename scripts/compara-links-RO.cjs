// SOLO LECTURA. Compara referenceLink (código MK) entre dev y prod.
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const devUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const prodUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const dev = new PrismaClient({ datasources:{ db:{ url: devUrl } } });
const prod = new PrismaClient({ datasources:{ db:{ url: prodUrl } } });
const code = l => (l||"").match(/mk\.cl\/([a-z]{3}\d{6})/i)?.[1]?.toLowerCase() || null;
async function main(){
  if(!prodUrl.includes("shy-morning")){console.log("prod url mal, aborto");return;}
  const d = await dev.artefactoCatalog.findMany({ select:{name:true,referenceLink:true} });
  const p = await prod.artefactoCatalog.findMany({ select:{name:true,referenceLink:true} });
  const prodCodes = new Map(); p.forEach(x=>{const c=code(x.referenceLink); if(c) prodCodes.set(c,x.name);});
  console.log(`dev: ${d.length} (con link ${d.filter(x=>code(x.referenceLink)).length}) · prod: ${p.length} (con link ${prodCodes.size})\n`);
  console.log("MIS ITEMS CUYO CÓDIGO MK YA ESTÁ EN PROD:");
  let hits=0;
  for(const x of d){ const c=code(x.referenceLink); if(c && prodCodes.has(c)){ hits++; console.log(`  • ${c}  "${x.name}"  ↔ prod "${prodCodes.get(c)}"`); } }
  if(!hits) console.log("  (ninguno — ningún código MK mío está ya en prod)");
  console.log(`\nTotal coincidencias por código: ${hits}`);
}
main().catch(e=>console.error("ERR",e.message)).finally(()=>{dev.$disconnect();prod.$disconnect();});
