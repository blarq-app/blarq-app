const fs=require("fs");
const { PrismaClient } = require("@prisma/client");
const prodUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const prod = new PrismaClient({ datasources:{ db:{ url: prodUrl } } });
const code = l => (l||"").match(/[a-z]{3}\d{6}/i)?.[0]?.toLowerCase() || null;
const nombres = ["MICROONDAS ML 825 TFL","HORNO ELECTRICO MAESTRO HLB 8300 BK","ENCIMERA GAS GSC 95330 SBA IX","CAMPANA ISLA CC 485 INOX","LAVAPLATOS BAJO ENCIMERA BE 74.43 TEKA","GRIFO LAVAPLATOS ARES ARK 938 EXTRAIBLE TEKA","GRIFO LAVADERO IN 915 CUELLO CISNE ECO TEKA","GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO","LAVADERO LN50 ACERO INOX C/DESAGUE Y SIFON","COLUMNA DUCHA URBAN 25 CM CROMO","MAMPARA STYLE CORREDERA CENTRAL RECEP 150","GRIFERIA DUCHA-TINA URBAN EXPUESTA CROMO","GRIFERIA DUCHA EXPUESTA NIZA CON DUCHA FONO CROMO","LAVAMANOS MURAL AMANTIA BLANCO SIN REBALSE 450X260"];
async function main(){
  const all = await prod.artefactoCatalog.findMany();
  // dup codes
  const byCode={}; for(const r of all){const c=code(r.referenceLink); if(c)(byCode[c]=byCode[c]||[]).push(r.name);}
  const dups=Object.entries(byCode).filter(([c,ns])=>ns.length>1);
  console.log(`Códigos MK duplicados en prod: ${dups.length}`); dups.forEach(([c,ns])=>console.log(`  ⚠ ${c}: ${ns.join(" | ")}`));
  let con=0,falta=0;
  for(const n of nombres){ const r=all.find(x=>x.name===n); if(!r){console.log("  ✗ falta:",n);falta++;continue;} if(r.imageUrl)con++; }
  console.log(`\nLos 14 nuevos: con foto ${con}/14 · faltantes ${falta}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prod.$disconnect());
