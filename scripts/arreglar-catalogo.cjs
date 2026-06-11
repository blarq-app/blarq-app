/**
 * Arregla el catálogo en una transacción + respaldo:
 *  1) Links de Kitchen House (20) — por foto (v2) + los 5 que faltaban (v1 targeted).
 *  2) Renombrar 8 nombres genéricos del catálogo viejo (match por nombre + detalle).
 * Uso: node arreglar-catalogo.cjs --prod   (o sin flag = dev)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const esProd = process.argv.includes("--prod");
const url = esProd
  ? fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1]
  : fs.readFileSync("/Users/mjblanco/Desktop/blarq-app/.env","utf8").match(/DATABASE_URL="?([^"\n]+)/)[1];
if (esProd && !url.includes("shy-morning")) { console.error("PROD no es shy-morning. ABORTO."); process.exit(1); }
const prisma = new PrismaClient({ datasources:{ db:{ url } } });

// Links: v2 (por foto, autoritativo) + v1 para los que no estén en v2.
const v2 = JSON.parse(fs.readFileSync("/tmp/blarq-cocina-wt/kh-links-v2.json","utf8"));
const v1 = JSON.parse(fs.readFileSync("/tmp/blarq-cocina-wt/kh-links.json","utf8"));
const linkByName = {};
for (const x of v1) linkByName[x.name] = x.link;
for (const x of v2) linkByName[x.name] = x.link; // v2 pisa a v1

// Renombres: [nombre actual exacto, (detalle incluye|null), nombre nuevo]
const renombres = [
  ["DESAGUE", null, "DESAGUE INFLOOR LINE 600MM"],
  ["MAMPARA", null, "MAMPARA FIJA BROOKLIN 100"],
  ["PLATO DUCHA", null, "PLATO DUCHA LUXOR REDONDO 25CM"],
  ["WC", null, "WC ATENAS TWO PIECE DESCARGA A MURO"],
  ["UNION MURO", "Trento", "UNION MURO TRENTO CROMO"],
  ["UNION MURO", "New home", "UNION MURO NEW HOME BRUSHED"],
  ["SET BARRA DUCHA", "Luxor", "SET BARRA DUCHA LUXOR CROMADA"],
  ["SET BARRA DUCHA", "New Home", "SET BARRA DUCHA NEW HOME BRUSHED"],
];

async function main(){
  console.log(`Base: ${esProd ? "PROD" : "DEV"}`);
  const all = await prisma.artefactoCatalog.findMany();
  if (esProd) fs.writeFileSync("/tmp/blarq-cocina-wt/backup-prod-arreglo.json", JSON.stringify(all,null,2));

  // 1) Links KH
  const kh = all.filter(r => r.supplier === "Kitchen House");
  const ops = [];
  let linksOk = 0, linksMiss = 0;
  for (const r of kh) {
    const link = linkByName[r.name];
    if (!link) { console.log(`  link? falta para: ${r.name}`); linksMiss++; continue; }
    if (r.referenceLink !== link) ops.push(prisma.artefactoCatalog.update({ where:{id:r.id}, data:{ referenceLink: link } }));
    linksOk++;
  }

  // 2) Renombres
  const renOps = [];
  for (const [actual, det, nuevo] of renombres) {
    const cands = all.filter(r => r.name === actual && (!det || (r.detail||"").toLowerCase().includes(det.toLowerCase())));
    if (cands.length !== 1) { console.log(`  ⚠ renombre "${actual}"${det?` (${det})`:""}: encontré ${cands.length}, esperaba 1 — lo salto`); continue; }
    renOps.push(prisma.artefactoCatalog.update({ where:{id:cands[0].id}, data:{ name: nuevo } }));
    console.log(`  renombrar: "${actual}"${det?` [${det}]`:""} → "${nuevo}"`);
  }

  await prisma.$transaction([...ops, ...renOps]);
  console.log(`\n✓ Links KH aplicados: ${linksOk}/${kh.length} (faltaron ${linksMiss}) · Renombres: ${renOps.length}/${renombres.length}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
