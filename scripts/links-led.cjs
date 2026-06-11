const fs=require("fs");
const { PrismaClient } = require("@prisma/client");
const esProd = process.argv.includes("--prod");
const url = esProd
  ? fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1]
  : fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if (esProd && !url.includes("shy-morning")) { console.error("PROD no es shy-morning. ABORTO."); process.exit(1); }
const prisma = new PrismaClient({ datasources:{ db:{ url } } });
const links = {
  "C15400097": "https://www.ledstudio.cl/lampara-colgante-o-sobrepuesta-led-studio-40w-cct-luz-calida-a-neutra/p",
  "C22600007": "https://www.ledstudio.cl/foco-sobrepuesto-cielo--muro-led-studio-dirigible-triple/p",
  "C17900183": "https://www.ledstudio.cl/panel-slim-led-studio-alum-redondo-18w-luz-neutra/p",
};
async function main(){
  console.log(`Base: ${esProd?"PROD":"DEV"}`);
  const rows = await prisma.artefactoCatalog.findMany({ where:{ supplier:"LED Studio" }, select:{id:true,name:true,detail:true,referenceLink:true} });
  let n=0;
  for(const r of rows){
    const sku=(r.detail||"").match(/SKU\s+(\w+)/)?.[1];
    const link = sku && links[sku];
    if(!link){ console.log(`  ? sin link para ${r.name} (sku ${sku||"?"})`); continue; }
    if(r.referenceLink!==link){ await prisma.artefactoCatalog.update({ where:{id:r.id}, data:{ referenceLink: link } }); n++; }
    console.log(`  ✓ ${r.name.slice(0,42)}  → ${link.split("/").slice(-2,-1)[0]}`);
  }
  console.log(`\nActualizados: ${n}/${rows.length}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
