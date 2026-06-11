const fs=require("fs");
const { PrismaClient } = require("@prisma/client");
const prodUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const prod = new PrismaClient({ datasources:{ db:{ url: prodUrl } } });
async function main(){
  const rows = await prod.artefactoCatalog.findMany({ select:{name:true,subcategory:true,tag:true,referenceLink:true}, orderBy:[{subcategory:"asc"},{name:"asc"}] });
  const code = l => (l||"").match(/[a-z]{3}\d{6}|mk\.cl\/([a-z0-9-]+)/i)?.[0]||"";
  for(const r of rows) console.log(`[${r.subcategory.slice(0,4)}] ${r.name}`);
  console.log(`\nTOTAL: ${rows.length}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prod.$disconnect());
