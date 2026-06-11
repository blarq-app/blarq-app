const fs=require("fs");
const { PrismaClient } = require("@prisma/client");
const esProd = process.argv.includes("--prod");
const url = esProd
  ? fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1]
  : fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if (esProd && !url.includes("shy-morning")) { console.error("no es prod, aborto"); process.exit(1); }
const prisma = new PrismaClient({ datasources:{ db:{ url } } });

// LÍNEA: se busca SOLO en el nombre (el detalle suele traer la línea de un
// componente, ej. mueble Albany con lavamanos "Delfos-N" → no queremos Delfos).
const LINES = [
  [/NEW DELFOS/, "New Delfos"], [/NEW HOME/, "New Home"], [/STYLE-?N|\bSTYLE\b/, "Style"],
  [/ASIS/, "Asis"], [/URBAN/, "Urban"], [/STELLAR/, "Stellar"], [/ATLAS/, "Atlas"],
  [/\bHOME\b/, "Home"], [/LUXOR/, "Luxor"], [/TRENTO/, "Trento"], [/\bZEN\b/, "Zen"],
  [/BROOKLIN/, "Brooklin"], [/NIZA/, "Niza"], [/BRIZO/, "Brizo"], [/ATENAS/, "Atenas"],
  [/ALBANY/, "Albany"], [/DELFOS/, "Delfos"], [/QUEEN/, "Queen"], [/NEPAL/, "Nepal"],
  [/AMANTIA/, "Amantia"], [/ARES/, "Ares"], [/ASTORIA/, "Astoria"],
];
// COLOR/TERMINACIÓN: nombre + detalle (más info de color).
const FINISHES = [
  [/BRUSHED NICKEL/, "Brushed Nickel"], [/GUN GREY/, "Gun Grey"], [/NEGRO MATE/, "Negro Mate"],
  [/RUSTIC OAK/, "Rustic Oak"], [/WHITE OAK/, "White Oak"], [/MINK GREY/, "Mink Grey"],
  [/MOON GREY/, "Moon Grey"], [/BRUSHED/, "Brushed"], [/CROMAD[OA]|CROMO/, "Cromo"],
  [/BLANCO/, "Blanco"], [/\bINOX|INOXIDABLE/, "Inox"],
];
const match = (txt, rules) => { for (const [re,v] of rules) if (re.test(txt)) return v; return null; };

async function main(){
  console.log(`Base: ${esProd?"PROD":"DEV"}`);
  const rows = await prisma.artefactoCatalog.findMany({ select:{id:true,name:true,detail:true,subcategory:true}, orderBy:[{subcategory:"asc"},{name:"asc"}] });
  let conLinea=0, conColor=0;
  const apply = process.argv.includes("--apply");
  for(const r of rows){
    const line = match(r.name.toUpperCase(), LINES);
    const finish = match(`${r.name} ${r.detail||""}`.toUpperCase(), FINISHES);
    if(line) conLinea++; if(finish) conColor++;
    if(apply) await prisma.artefactoCatalog.update({ where:{id:r.id}, data:{ line, finish } });
    if(r.subcategory==="sanitario") console.log(`  ${(line||"—").padEnd(11)} ${(finish||"—").padEnd(13)} ${r.name.slice(0,44)}`);
  }
  console.log(`\nTotal ${rows.length} · con línea ${conLinea} · con color ${conColor}  ${apply?"(APLICADO)":"(solo vista)"}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
