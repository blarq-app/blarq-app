/**
 * Carga a DEV los 27 artefactos NUEVOS de las cotizaciones grandes:
 *   - JNC (cot. 2275784, obra Depto JNC Vitacura)        → 11 nuevos
 *   - Paseo del Sena (cot. 2325676, obra V. Villarroel)  → 16 nuevos
 *
 * Reglas aplicadas:
 *   - Todo sanitario, tag por tipo (WC/Griferías/Duchas/Muebles/Mamparas/Accesorios).
 *   - Costos del PDF son NETOS → se cargan CON IVA (×1.19, redondeado).
 *   - MK con web: listPrice = lista web, discountPercent = dcto web → total = precio web.
 *   - MK sin web: listPrice 0, cliente en blanco (MJ lo edita a mano).
 *   - WC: aunque el desglose (kit completo) deja margen fino vs el web (WC two-piece),
 *     se pone el precio web igual; MJ lo ajusta si lo necesita.
 *   - Provisiones (porcelanatos/cerámicas) y fittings sueltos (sifones, desagües,
 *     uniones, manguitos) NO se cargan. Duplicados (catálogo o entre PDFs) NO se cargan.
 *
 * Muebles/WC se cargan como un único artefacto con el costo = suma del desglose del PDF.
 */
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Descuento decimal a partir de lista y precio web (sin redondear → total = precio web exacto).
const disc = (list, price) => 1 - price / list;
// Neto del PDF → con IVA, redondeado al peso.
const iva = (neto) => Math.round(neto * 1.19);
const MK = "https://www.mk.cl/";

const items = [
  // ─────────────────────────── JNC (11) ───────────────────────────
  { name: "WC ATENAS MURO-N RIMLESS", detail: "WC Atenas muro-n rimless: vaso + estanque doble descarga + asiento slow close + manguito + flexible + llave angular", brand: "KLIPEN", supplier: "MK", tag: "WC",
    referenceLink: MK+"wcs300008-wc-atenas-muron-rimless-sanitarios/p", listPrice: 198840, discountPercent: disc(198840,158240), realCostBlarq: iva(133018) },
  { name: "GRIFERIA LAVAMANOS STELLAR 22 CM BRUSHED", detail: "Grifería lavamanos Stellar alta 22cm s/desagüe brushed", brand: "KLIPEN", supplier: "MK", tag: "Griferías",
    referenceLink: MK+"gkl030674-griferia-lavamanos-stellar-22-cm-sdesague-brushed-griferias-de-lavamanos/p", listPrice: 70390, discountPercent: disc(70390,59890), realCostBlarq: iva(46210) },
  { name: "GRIFERIA DUCHA-TINA STELLAR EXPUESTA BRUSHED", detail: "Grifería ducha-tina Stellar expuesta brushed", brand: "KLIPEN", supplier: "MK", tag: "Griferías",
    referenceLink: MK+"gkl030676-griferia-ducha-tina-stellar-expuesta-brushed-griferias-de-ducha-y-tina/p", listPrice: 110490, discountPercent: disc(110490,79990), realCostBlarq: iva(58815) },
  { name: "GRIFERIA DUCHA STELLAR EXPUESTA BRUSHED", detail: "Grifería ducha Stellar expuesta (monomando) brushed", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"gkl030675-griferia-ducha-stellar-expuesta-brushed-griferias-de-ducha-y-tina/p", listPrice: 92390, discountPercent: disc(92390,64990), realCostBlarq: iva(46210) },
  { name: "MUEBLE QUEEN 700 2 PUERTAS SOFT C/LAVAMANOS", detail: "Mueble baño Queen 700 2 puertas soft touch con lavamanos (base+cubierta+sifón+goma)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: MK+"mdb260857-mueble-queen-700-2-puertas-soft-clavamanos-muebles-de-bano/p", listPrice: 239760, discountPercent: disc(239760,184060), realCostBlarq: iva(105873) },
  { name: "MUEBLE QUEEN 700 1 CAJON Y REPISA C/LAVAMANOS", detail: "Mueble baño Queen 700 1 cajón y repisa soft con lavamanos (base+cubierta+sifón+goma+desagüe click)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(109235) },
  { name: "RECEPTACULO ZEN C/REJILLA 1400X700", detail: "Receptáculo de ducha Zen con rejilla a 16cm, 1400x700", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"hid050226-receptaculo-zen-con-rejilla-a-16cm-1400x700-receptaculos/p", listPrice: 311890, discountPercent: disc(311890,169990), realCostBlarq: iva(109235) },
  { name: "RECEPTACULO ZEN C/REJILLA 1500X700", detail: "Receptáculo de ducha Zen con rejilla a 16cm, 1500x700", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"hid050228-receptaculo-zen-con-rejilla-a-16cm-1500x700-receptaculos/p", listPrice: 335790, discountPercent: disc(335790,218290), realCostBlarq: iva(142849) },
  { name: "RECEPTACULO ZEN C/REJILLA 1300X700", detail: "Receptáculo de ducha Zen con rejilla a 16cm, 1300x700", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"hid050230-receptaculo-zen-con-rejilla-a-16cm-1300x700-receptaculos/p", listPrice: 298490, discountPercent: disc(298490,199990), realCostBlarq: iva(126042) },
  { name: "MAMPARA STYLE FIJA RECEP 80", detail: "Mampara Style fija recep 80, vidrio templado", brand: "KLIPEN", supplier: "MK", tag: "Mamparas",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(100832) },
  { name: "MAMPARA STYLE FIJA 70X198", detail: "Mampara Style fija 70x198, vidrio templado", brand: "KLIPEN", supplier: "MK", tag: "Mamparas",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(96630) },

  // ──────────────────────── Paseo del Sena (16) ────────────────────────
  { name: "WC ATENAS PISO-N RIMLESS", detail: "WC Atenas piso-n rimless: vaso descarga a piso + estanque doble descarga 3/6L + asiento slow close + flexible + llave + sello", brand: "KLIPEN", supplier: "MK", tag: "WC",
    referenceLink: MK+"wcs300257-wc-atenas-pison-rimless-sanitarios/p", listPrice: 233540, discountPercent: disc(233540,165040), realCostBlarq: iva(131966) },
  { name: "MEZCLADOR TINA STELLAR EMPOTRADO 2 VIAS BRUSHED", detail: "Mezclador tina Stellar empotrado 2 vías brushed", brand: "KLIPEN", supplier: "MK", tag: "Griferías",
    referenceLink: MK+"gkl030678-mezclador-tina-stellar-empotrado-2-vias-brushed-griferias-de-ducha-y-tina/p", listPrice: 91890, discountPercent: disc(91890,78190), realCostBlarq: iva(54053) },
  { name: "PLATO DUCHA NEW HOME REDONDO 25 CM C/BRAZO BRUSHED", detail: "Plato ducha New Home redondo 25cm 1 jet con brazo brushed", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"gkl030704-plato-ducha-new-home-redondo-25-cm-1-jet-cbrazo-brushed-griferias-de-ducha-y-tina/p", listPrice: 65390, discountPercent: disc(65390,55590), realCostBlarq: iva(38464) },
  { name: "MUEBLE NEW DELFOS 1200 2 CAJONES RUSTIC OAK C/LAVAMANOS", detail: "Mueble New Delfos 1200 2 cajones Rustic Oak con lavamanos Delfos-N 120 (base+lavamanos+sifón+goma+desagüe)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: MK+"mdb262563-mueble-de-bano-new-delfos-1200-2-cajones-rustic-oak-con-lavamanos-muebles-de-bano/p", listPrice: 502350, discountPercent: disc(502350,414650), realCostBlarq: iva(296729) },
  { name: "PERCHA ATLAS SIMPLE BRUSHED NICKEL", detail: "Percha simple modelo Atlas brushed nickel", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(10347) },
  { name: "TOALLERO BARRA ATLAS 60 BRUSHED NICKEL", detail: "Toallero de barra 60cm modelo Atlas brushed nickel", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(63759) },
  { name: "GRIFERIA LAVAMANOS URBAN 9 CM GUN GREY", detail: "Grifería lavamanos Urban baja 9cm s/desagüe gun grey", brand: "KLIPEN", supplier: "MK", tag: "Griferías",
    referenceLink: MK+"gkl030759-griferia-lavamanos-urban-9-cm-sdesague-gun-grey-griferias-de-lavamanos/p", listPrice: 137590, discountPercent: disc(137590,109590), realCostBlarq: iva(80935) },
  { name: "COLUMNA DUCHA URBAN CON SET SOPORTE GUN GREY", detail: "Columna ducha Urban con set soporte ducha gun grey", brand: "KLIPEN", supplier: "MK", tag: "Duchas",
    referenceLink: MK+"gkl030827-columna-ducha-urban-con-set-soporte-ducha-gun-grey-griferias-de-ducha-y-tina/p", listPrice: 538090, discountPercent: disc(538090,419990), realCostBlarq: iva(316523) },
  { name: "MAMPARA STYLE-N FIJA C/BRAZO 100 NEGRO MATE", detail: "Mampara fija Style-N c/brazo 100 negro mate, (985-1000)x1950 8mm", brand: "KLIPEN", supplier: "MK", tag: "Mamparas",
    referenceLink: MK+"hid361378-mampara-fija-stylen-cbrazo-100-negro-mate-mamparas/p", listPrice: 165390, discountPercent: disc(165390,140590), realCostBlarq: iva(97288) },
  { name: "MUEBLE NEW DELFOS 800 2 CAJONES MINK GREY MATT C/LAVAMANOS", detail: "Mueble New Delfos 800 2 cajones Mink Grey Matt con lavamanos Delfos-N 80 (base+lavamanos+sifón+goma+desagüe)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(201017) },
  { name: "MUEBLE ALBANY 800 2 CAJONES MOON GREY C/LAVAMANOS", detail: "Mueble Albany 800 2 cajones Moon Grey soft touch con lavamanos Delfos-N 80 (base+lavamanos+sifón+goma+desagüe)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: MK+"mdb262133-mueble-albany-800-2-cajones-moon-grey-muebles-de-bano/p", listPrice: 393950, discountPercent: disc(393950,304550), realCostBlarq: iva(231782) },
  { name: "TOALLERO BARRA ATLAS 30 GUN GREY", detail: "Toallero de barra 30cm modelo Atlas gun grey", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: MK+"acc080345-toallero-de-barra-atlas-30-cm-gun-grey-accesorios/p", listPrice: 72490, discountPercent: disc(72490,54990), realCostBlarq: iva(42641) },
  { name: "TOALLERO ATLAS 60 GUN GREY", detail: "Toallero de barra 60cm modelo Atlas gun grey", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: MK+"acc080337-toallero-atlas-60-cm-gun-grey-accesorios/p", listPrice: 116990, discountPercent: disc(116990,87990), realCostBlarq: iva(68817) },
  { name: "PERCHA ATLAS GUN GREY", detail: "Percha simple Atlas gun grey", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: MK+"acc080338-percha-atlas-gun-grey-accesorios/p", listPrice: 18990, discountPercent: disc(18990,13990), realCostBlarq: iva(11170) },
  { name: "PORTARROLLO SIN TAPA ATLAS GUN GREY", detail: "Portarrollo sin tapa Atlas gun grey", brand: "KLIPEN", supplier: "MK", tag: "Accesorios",
    referenceLink: MK+"acc080344-portarrollo-sin-tapa-atlas-gun-grey-accesorios/p", listPrice: 32990, discountPercent: disc(32990,24990), realCostBlarq: iva(19405) },
  { name: "MUEBLE NEW DELFOS 600 2 CAJONES WHITE OAK C/LAVAMANOS", detail: "Mueble New Delfos 600 2 cajones White Oak con lavamanos Delfos-N 60 (base+lavamanos+sifón+goma+desagüe)", brand: "KLIPEN", supplier: "MK", tag: "Muebles",
    referenceLink: null, listPrice: 0, realCostBlarq: iva(177430) },
];

async function main() {
  // sortOrder de sanitario: arrancamos del max actual.
  const last = await prisma.artefactoCatalog.findFirst({ where: { subcategory: "sanitario" }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  let order = last?.sortOrder ?? 0;

  let creados = 0;
  for (const it of items) {
    order += 1;
    await prisma.artefactoCatalog.create({
      data: {
        name: it.name, detail: it.detail ?? null, brand: it.brand ?? null,
        subcategory: "sanitario", tag: it.tag ?? null, supplier: it.supplier ?? null,
        referenceLink: it.referenceLink ?? null, imageUrl: null,
        listPrice: it.listPrice ?? 0, discountPercent: it.discountPercent ?? null,
        clientPrice: null, realCostBlarq: it.realCostBlarq ?? null,
        isStandard: false, sortOrder: order,
        lastPriceCheck: it.listPrice ? new Date() : null,
      },
    });
    creados++;
  }
  console.log(`Cargados a DEV: ${creados} artefactos (esperado 27)`);
  const n = await prisma.artefactoCatalog.count({ where: { subcategory: "sanitario" } });
  console.log(`Sanitario ahora en total: ${n}`);
  // Por tag
  const tags = ["WC","Griferías","Duchas","Muebles","Mamparas","Accesorios"];
  for (const t of tags) {
    const c = items.filter(i => i.tag === t).length;
    console.log(`  ${t}: +${c}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
