// SOLO LECTURA. Carga .env.prod explícitamente.
require("dotenv").config({ path: "/Users/mjblanco/Desktop/blarq-app/.env.prod" });
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main(){
  const u = process.env.DATABASE_URL || "";
  const host = (u.match(/@([^/]*)/)||[])[1] || "?";
  console.log("Conectado a:", host);
  console.log("ES PROD (shy-morning)?", u.includes("shy-morning"));
  if(!u.includes("shy-morning")){ console.log("NO es prod — aborto lectura."); return; }
  const total = await prisma.artefactoCatalog.count();
  console.log(`\nArtefactos en PROD: ${total}`);
  for(const sub of ["sanitario","cocina","iluminacion"]){
    const n = await prisma.artefactoCatalog.count({ where:{ subcategory: sub } });
    console.log(`  ${sub}: ${n}`);
  }
  const rows = await prisma.artefactoCatalog.findMany({ select:{ name:true, subcategory:true, tag:true, supplier:true }, orderBy:[{subcategory:"asc"},{name:"asc"}] });
  console.log("\n--- LISTADO PROD ---");
  for(const r of rows) console.log(`  [${r.subcategory.slice(0,4)}/${(r.tag||"-").slice(0,10).padEnd(10)}] ${r.name}`);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);}).finally(()=>prisma.$disconnect());
