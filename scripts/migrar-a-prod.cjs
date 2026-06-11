const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const devUrl  = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
const prodUrl = fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if(!prodUrl.includes("shy-morning")){ console.error("PROD URL no es shy-morning. ABORTO."); process.exit(1); }
const dev  = new PrismaClient({ datasources:{ db:{ url: devUrl } } });
const prod = new PrismaClient({ datasources:{ db:{ url: prodUrl } } });

// Los 7 a borrar: 5 por código MK, 2 por nombre exacto (sin link en prod).
const codesABorrar = ["gkl030678","gkl030704","mdb262563","gkl030759","gkl030827"];
const nombresABorrar = ["PERCHA ATLAS BRUSHED","TOALLERO ATLAS 60 BRUSHED"];

async function main(){
  // 1) RESPALDO de toda la tabla de prod.
  const backup = await prod.artefactoCatalog.findMany();
  const bpath = "/tmp/blarq-cargar-wt/backup-prod-artefactos.json";
  fs.writeFileSync(bpath, JSON.stringify(backup, null, 2));
  console.log(`Respaldo prod: ${backup.length} filas → ${bpath}`);

  // 2) Identificar las 7 a borrar (capturar ids reales).
  const aBorrar = backup.filter(r =>
    codesABorrar.some(c => (r.referenceLink||"").toLowerCase().includes(c)) ||
    nombresABorrar.includes(r.name)
  );
  console.log(`\nA borrar (${aBorrar.length}):`);
  aBorrar.forEach(r => console.log(`  - ${r.name}  (${r.id})`));
  if(aBorrar.length !== 7){ console.error(`\nEsperaba 7, encontré ${aBorrar.length}. ABORTO por seguridad.`); process.exit(1); }
  const idsBorrar = aBorrar.map(r => r.id);

  // 3) Leer los 50 de dev (todos los campos relevantes).
  const mios = await dev.artefactoCatalog.findMany({ orderBy:[{subcategory:"asc"},{sortOrder:"asc"}] });
  console.log(`\nA cargar desde dev: ${mios.length}`);
  if(mios.length !== 50){ console.error(`Esperaba 50 en dev, hay ${mios.length}. ABORTO.`); process.exit(1); }

  // 4) Transacción: borrar 7 + insertar 50 (sortOrder = max por subcat tras borrado).
  await prod.$transaction(async (tx) => {
    await tx.artefactoCatalog.deleteMany({ where:{ id:{ in: idsBorrar } } });
    const maxBy = {};
    for(const sub of ["sanitario","cocina","iluminacion"]){
      const last = await tx.artefactoCatalog.findFirst({ where:{subcategory:sub}, orderBy:{sortOrder:"desc"}, select:{sortOrder:true} });
      maxBy[sub] = last?.sortOrder ?? 0;
    }
    for(const m of mios){
      maxBy[m.subcategory] = (maxBy[m.subcategory] ?? 0) + 1;
      await tx.artefactoCatalog.create({ data:{
        name:m.name, detail:m.detail, brand:m.brand, subcategory:m.subcategory, tag:m.tag,
        supplier:m.supplier, referenceLink:m.referenceLink, imageUrl:m.imageUrl,
        listPrice:m.listPrice, discountPercent:m.discountPercent, clientPrice:m.clientPrice,
        realCostBlarq:m.realCostBlarq, isStandard:m.isStandard, sortOrder:maxBy[m.subcategory],
        lastPriceCheck:m.lastPriceCheck,
      }});
    }
  }, { timeout: 60000 });

  // 5) Conteo final.
  const total = await prod.artefactoCatalog.count();
  console.log(`\n✓ Listo. Prod ahora: ${total} artefactos (esperado 72)`);
  for(const sub of ["sanitario","cocina","iluminacion"]){
    const n = await prod.artefactoCatalog.count({ where:{subcategory:sub} });
    console.log(`  ${sub}: ${n}`);
  }
  const conFoto = await prod.artefactoCatalog.count({ where:{ imageUrl:{ not:null } } });
  console.log(`  con foto: ${conFoto}`);
}
main().catch(e=>{console.error("ERR",e);process.exit(1);}).finally(()=>{dev.$disconnect();prod.$disconnect();});
