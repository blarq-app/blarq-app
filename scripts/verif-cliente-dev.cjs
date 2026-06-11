require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const nombres = ["MICROONDAS ML 825 TFL","HORNO ELECTRICO MAESTRO HLB 8300 BK","ENCIMERA GAS GSC 95330 SBA IX","CAMPANA ISLA CC 485 INOX","LAVAPLATOS BAJO ENCIMERA BE 74.43 TEKA","GRIFO LAVAPLATOS ARES ARK 938 EXTRAIBLE TEKA","GRIFO LAVADERO IN 915 CUELLO CISNE ECO TEKA","GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO","LAVADERO LN50 ACERO INOX C/DESAGUE Y SIFON","COLUMNA DUCHA URBAN 25 CM CROMO","MAMPARA STYLE CORREDERA CENTRAL RECEP 150","GRIFERIA DUCHA-TINA URBAN EXPUESTA CROMO","GRIFERIA DUCHA EXPUESTA NIZA CON DUCHA FONO CROMO","LAVAMANOS MURAL AMANTIA BLANCO SIN REBALSE 450X260","PERCHA ASIS DOBLE CROMO"];
const tot = (l,d)=> Math.round(l*(1-(d||0)));
async function main(){
  let okFoto=0, costoNull=0;
  for(const n of nombres){
    const r = await prisma.artefactoCatalog.findFirst({ where:{name:n}, select:{name:true,subcategory:true,tag:true,listPrice:true,discountPercent:true,realCostBlarq:true,imageUrl:true} });
    if(!r){ console.log("  ✗ NO ESTÁ:", n); continue; }
    if(r.imageUrl) okFoto++; if(r.realCostBlarq==null) costoNull++;
    console.log(`  ${r.imageUrl?"📷":"  "} [${r.subcategory.slice(0,4)}/${(r.tag||"-").slice(0,9).padEnd(9)}] ${r.name.slice(0,40).padEnd(42)} cliente $${tot(r.listPrice,r.discountPercent)}  costo:${r.realCostBlarq??"—"}`);
  }
  console.log(`\nCon foto: ${okFoto}/15 · sin costo (correcto): ${costoNull}/15`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
