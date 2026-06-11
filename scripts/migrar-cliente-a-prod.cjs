const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const devUrl  = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const prodUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if(!prodUrl.includes("shy-morning")){ console.error("PROD no es shy-morning. ABORTO."); process.exit(1); }
const dev  = new PrismaClient({ datasources:{ db:{ url: devUrl } } });
const prod = new PrismaClient({ datasources:{ db:{ url: prodUrl } } });
const code = l => (l||"").match(/[a-z]{3}\d{6}/i)?.[0]?.toLowerCase() || null;

const nombres = ["MICROONDAS ML 825 TFL","HORNO ELECTRICO MAESTRO HLB 8300 BK","ENCIMERA GAS GSC 95330 SBA IX","CAMPANA ISLA CC 485 INOX","LAVAPLATOS BAJO ENCIMERA BE 74.43 TEKA","GRIFO LAVAPLATOS ARES ARK 938 EXTRAIBLE TEKA","GRIFO LAVADERO IN 915 CUELLO CISNE ECO TEKA","GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO","LAVADERO LN50 ACERO INOX C/DESAGUE Y SIFON","COLUMNA DUCHA URBAN 25 CM CROMO","MAMPARA STYLE CORREDERA CENTRAL RECEP 150","GRIFERIA DUCHA-TINA URBAN EXPUESTA CROMO","GRIFERIA DUCHA EXPUESTA NIZA CON DUCHA FONO CROMO","LAVAMANOS MURAL AMANTIA BLANCO SIN REBALSE 450X260","PERCHA ASIS DOBLE CROMO"];

async function main(){
  // 1) Respaldo prod.
  const backup = await prod.artefactoCatalog.findMany();
  fs.writeFileSync("/tmp/blarq-cargar-wt/backup-prod-artefactos-2.json", JSON.stringify(backup,null,2));
  console.log(`Respaldo prod: ${backup.length} filas → backup-prod-artefactos-2.json`);
  const prodNames = new Set(backup.map(r=>r.name.trim().toUpperCase()));
  const prodCodes = new Set(backup.map(r=>code(r.referenceLink)).filter(Boolean));

  // 2) Leer los 15 de dev.
  const mios = await dev.artefactoCatalog.findMany({ where:{ name:{ in: nombres } } });
  if(mios.length !== 15){ console.error(`Esperaba 15 en dev, encontré ${mios.length}. ABORTO.`); process.exit(1); }

  // 3) Chequear colisiones contra prod (nombre o código MK).
  const colisiones = mios.filter(m => prodNames.has(m.name.trim().toUpperCase()) || (code(m.referenceLink) && prodCodes.has(code(m.referenceLink))));
  if(colisiones.length){
    console.log("\n⚠ COLISIONES con prod (no se cargarán):");
    colisiones.forEach(c=>console.log(`  - ${c.name}`));
  } else {
    console.log("\n✓ 0 colisiones con prod. Los 15 son nuevos.");
  }
  const aCargar = mios.filter(m => !colisiones.includes(m));

  // 4) Insertar.
  await prod.$transaction(async (tx)=>{
    const maxBy = {};
    for(const sub of ["sanitario","cocina","iluminacion"]){
      const last = await tx.artefactoCatalog.findFirst({ where:{subcategory:sub}, orderBy:{sortOrder:"desc"}, select:{sortOrder:true} });
      maxBy[sub] = last?.sortOrder ?? 0;
    }
    for(const m of aCargar){
      maxBy[m.subcategory] = (maxBy[m.subcategory]??0)+1;
      await tx.artefactoCatalog.create({ data:{
        name:m.name, detail:m.detail, brand:m.brand, subcategory:m.subcategory, tag:m.tag,
        supplier:m.supplier, referenceLink:m.referenceLink, imageUrl:m.imageUrl,
        listPrice:m.listPrice, discountPercent:m.discountPercent, clientPrice:m.clientPrice,
        realCostBlarq:m.realCostBlarq, isStandard:m.isStandard, sortOrder:maxBy[m.subcategory],
        lastPriceCheck:m.lastPriceCheck,
      }});
    }
  }, { timeout: 60000 });

  const total = await prod.artefactoCatalog.count();
  console.log(`\n✓ Cargados a prod: ${aCargar.length}. Prod ahora: ${total} (esperado 87)`);
  for(const sub of ["sanitario","cocina","iluminacion"]){
    const n = await prod.artefactoCatalog.count({ where:{subcategory:sub} });
    console.log(`  ${sub}: ${n}`);
  }
}
main().catch(e=>{console.error("ERR",e);process.exit(1);}).finally(()=>{dev.$disconnect();prod.$disconnect();});
