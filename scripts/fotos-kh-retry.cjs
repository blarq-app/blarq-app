require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";
async function suggest(q){const u=`https://kitchenhouse.cl/search/suggest.json?q=${encodeURIComponent(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=8`;const r=await fetch(u,{headers:{"User-Agent":UA}});if(!r.ok)return[];return (await r.json()).resources?.results?.products||[];}

// nombre parcial → SKU → varias queries a probar
const targets = [
  { match: "RSL-73385", sku: "113460011", queries: ["RSL-73385","refrigerador 73385","73385"] },
  { match: "RSF-73385", sku: "113500012", queries: ["RSF-73385","freezer 73385","73385"] },
  { match: "HBB 4460",  sku: "111020079", queries: ["HBB 4460","horno 4460","4460"] },
];

async function main(){
  for(const t of targets){
    const row = await prisma.artefactoCatalog.findFirst({ where:{ supplier:"Kitchen House", imageUrl:null, name:{ contains:t.match } }, select:{id:true,name:true} });
    if(!row){ console.log(`(ya tenía foto o no existe: ${t.match})`); continue; }
    let img=null, via="";
    for(const q of t.queries){
      const ps = await suggest(q);
      const hit = ps.find(p=>(p.image||"").includes(t.sku));
      if(hit){ img=hit.image; via=`q="${q}" (SKU en archivo)`; break; }
      // si ninguno coincide por SKU pero hay resultados con el código de modelo en el título
      const byTitle = ps.find(p=> p.title.toUpperCase().includes(t.match.toUpperCase().replace(/\s+/g," ")));
      if(byTitle && !img){ img=byTitle.image; via=`q="${q}" (título coincide: ${byTitle.title.slice(0,40)})`; }
      if(img && via.includes("SKU")) break;
    }
    if(!img){ console.log(`  ✗ ${t.match}: sigue sin encontrar`); continue; }
    await prisma.artefactoCatalog.update({ where:{id:row.id}, data:{ imageUrl: img } });
    console.log(`  ✓ ${row.name.slice(0,45).padEnd(47)} ← ${via}`);
    console.log(`      ${img}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
