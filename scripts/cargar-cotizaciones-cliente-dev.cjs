/**
 * Carga a DEV los 15 artefactos de las cotizaciones A CLIENTE (Matías Herrera + Pauline Dumay).
 * Estas cotizaciones tienen precios VIEJOS → se identificó cada producto en la web
 * y se carga el PRECIO WEB DE HOY como precio a cliente. SIN "mi costo" (no lo tenemos).
 *   - MK (mk.cl): listPrice=lista web, discountPercent=dcto web → total = precio web.
 *   - Kitchen House (Teka, Shopify): un solo precio web → listPrice=precio, sin dcto.
 * Fotos: KH directas (cdn.shopify); MK se completan después con fotos-mk-dev.cjs (por VTEX).
 */
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const disc = (list, price) => 1 - price / list;
const MK = "https://www.mk.cl/";
const SHOP = "https://cdn.shopify.com/s/files/1/0035/7695/4978/";

const items = [
  // ───── COCINA · Kitchen House (Teka) · un precio web, sin dcto, sin costo ─────
  { name: "MICROONDAS ML 825 TFL", detail: "Microondas ML 825 TFL Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 329990, imageUrl: SHOP+"files/12000003-ML-825-TFL-3_Vigente.webp?v=1756932594" },
  { name: "HORNO ELECTRICO MAESTRO HLB 8300 BK", detail: "Horno eléctrico Maestro HLB 8300 BK Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 699990, imageUrl: SHOP+"files/111000053.jpg?v=1763647735" },
  { name: "ENCIMERA GAS GSC 95330 SBA IX", detail: "Encimera a gas GSC 95330 SBA IX Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 389990, imageUrl: SHOP+"files/112610066.jpg?v=1756932121" },
  { name: "CAMPANA ISLA CC 485 INOX", detail: "Campana isla CC 485 Inoxidable Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 1099990, imageUrl: SHOP+"files/40480330.jpg?v=1756932831" },
  { name: "LAVAPLATOS BAJO ENCIMERA BE 74.43 TEKA", detail: "Lavaplatos bajo encimera BE 74.43 Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 154990, imageUrl: SHOP+"products/417-10125121_1.jpg?v=1756932806" },
  { name: "GRIFO LAVAPLATOS ARES ARK 938 EXTRAIBLE TEKA", detail: "Grifo lavaplatos Ares ARK 938 extraíble Teka", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 124990, imageUrl: SHOP+"products/ark_web_photo_copia.jpg?v=1756932765" },
  { name: "GRIFO LAVADERO IN 915 CUELLO CISNE ECO TEKA", detail: "Grifo lavadero IN 915 cuello cisne ECO Teka (logia)", brand: "Teka", supplier: "Kitchen House", subcategory: "cocina", tag: null,
    referenceLink: null, listPrice: 46990, imageUrl: SHOP+"products/in-915_cr_-_web_1.jpg?v=1756932785" },

  // ───── COCINA · MK ─────
  { name: "GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO", detail: "Grifería cocina Brizo extraíble 1 jet cromado", brand: "KLIPEN", supplier: "MK", subcategory: "cocina", tag: null,
    referenceLink: MK+"gkl030289-griferia-cocina-brizo-extraible-1-jet-cromo-griferias-de-cocina/p", listPrice: 155890, discountPercent: disc(155890,99990) },
  { name: "LAVADERO LN50 ACERO INOX C/DESAGUE Y SIFON", detail: "Lavadero LN50 acero inoxidable 304, 500x400x250mm, con desagüe y sifón (logia)", brand: "Johnson", supplier: "MK", subcategory: "cocina", tag: null,
    referenceLink: MK+"joh320156-lavadero-ln50-cdesague-y-sifon-lavaplatos-y-lavaderos/p", listPrice: 218370, discountPercent: disc(218370,135370) },

  // ───── SANITARIO · MK ─────
  { name: "COLUMNA DUCHA URBAN 25 CM CROMO", detail: "Columna ducha Urban 250mm cromado", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: "Duchas",
    referenceLink: MK+"gkl030081-columna-ducha-urban-25-cm-cromo-griferias-de-ducha-y-tina/p", listPrice: 309890, discountPercent: disc(309890,179990) },
  { name: "MAMPARA STYLE CORREDERA CENTRAL RECEP 150", detail: "Mampara ducha Style corredera central, receptáculo 150 (1500), vidrio templado", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: "Mamparas",
    referenceLink: MK+"hid360037-mampara-style-corredera-central-recep-150-mamparas/p", listPrice: 353090, discountPercent: disc(353090,211890) },
  { name: "GRIFERIA DUCHA-TINA URBAN EXPUESTA CROMO", detail: "Grifería ducha-tina Urban expuesta cromado", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: "Griferías",
    referenceLink: MK+"gkl030058-griferia-ducha-tina-urban-expuesta-cromo-griferias-de-ducha-y-tina/p", listPrice: 130590, discountPercent: disc(130590,103990) },
  { name: "GRIFERIA DUCHA EXPUESTA NIZA CON DUCHA FONO CROMO", detail: "Grifería ducha expuesta Niza con ducha fono cromo", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: "Duchas",
    referenceLink: MK+"gkl030863-griferia-ducha-expuesta-niza-con-ducha-fono-cromo-griferias-de-ducha-y-tina/p", listPrice: 49890, discountPercent: disc(49890,40390) },
  { name: "LAVAMANOS MURAL AMANTIA BLANCO SIN REBALSE 450X260", detail: "Lavamanos mural Amantia blanco sin rebalse 450x260x100mm", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: null,
    referenceLink: MK+"lav010042-lamantia-srebalse-lavamanos/p", listPrice: 72190, discountPercent: disc(72190,44290) },
  { name: "PERCHA ASIS DOBLE CROMO", detail: "Percha Asis doble acero inoxidable 304 cromado", brand: "KLIPEN", supplier: "MK", subcategory: "sanitario", tag: "Accesorios",
    referenceLink: MK+"acc080030-per-asis-doble-cr-accesorios/p", listPrice: 8590, discountPercent: disc(8590,7490) },
];

async function main(){
  const maxBy = {};
  for(const sub of ["sanitario","cocina","iluminacion"]){
    const last = await prisma.artefactoCatalog.findFirst({ where:{subcategory:sub}, orderBy:{sortOrder:"desc"}, select:{sortOrder:true} });
    maxBy[sub] = last?.sortOrder ?? 0;
  }
  let creados=0, saltados=0;
  for(const it of items){
    const existe = await prisma.artefactoCatalog.findFirst({ where:{ name: it.name }, select:{id:true} });
    if(existe){ console.log(`  ~ ya existe, salto: ${it.name}`); saltados++; continue; }
    maxBy[it.subcategory] += 1;
    await prisma.artefactoCatalog.create({ data:{
      name:it.name, detail:it.detail??null, brand:it.brand??null,
      subcategory:it.subcategory, tag:it.tag??null, supplier:it.supplier??null,
      referenceLink:it.referenceLink??null, imageUrl:it.imageUrl??null,
      listPrice:it.listPrice??0, discountPercent:it.discountPercent??null,
      clientPrice:null, realCostBlarq:null, // sin "mi costo"
      isStandard:false, sortOrder:maxBy[it.subcategory], lastPriceCheck:new Date(),
    }});
    creados++;
  }
  console.log(`\nCargados a DEV: ${creados} · saltados (ya existían): ${saltados}`);
  const total = await prisma.artefactoCatalog.count();
  console.log(`Total dev ahora: ${total}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
