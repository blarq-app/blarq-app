require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36";
async function imgFor(refId){
  const u=`https://www.ledstudio.cl/api/catalog_system/pub/products/search?fq=alternateIds_RefId:${refId}`;
  const r=await fetch(u,{headers:{"User-Agent":UA}}); if(!r.ok)return null;
  const a=await r.json(); return a?.[0]?.items?.[0]?.images?.[0]?.imageUrl||null;
}
async function main(){
  const rows=await prisma.artefactoCatalog.findMany({where:{supplier:"LED Studio",imageUrl:null},select:{id:true,name:true,detail:true}});
  console.log(`LED Studio sin foto: ${rows.length}`);
  for(const it of rows){
    const sku=(it.detail||"").match(/SKU\s+(\w+)/)?.[1];
    if(!sku){console.log(`  ? sin SKU: ${it.name}`);continue;}
    const img=await imgFor(sku);
    if(!img){console.log(`  ✗ ${sku} ${it.name.slice(0,40)}`);continue;}
    await prisma.artefactoCatalog.update({where:{id:it.id},data:{imageUrl:img}});
    console.log(`  ✓ ${sku} ${it.name.slice(0,40).padEnd(42)} ${img.slice(0,62)}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
