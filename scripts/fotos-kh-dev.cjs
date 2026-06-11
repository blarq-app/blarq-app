require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

async function suggest(q) {
  const url = `https://kitchenhouse.cl/search/suggest.json?q=${encodeURIComponent(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=6`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return j.resources?.results?.products || [];
}

async function main() {
  const rows = await prisma.artefactoCatalog.findMany({
    where: { supplier: "Kitchen House", imageUrl: null },
    select: { id: true, name: true, detail: true },
  });
  console.log(`Kitchen House sin foto: ${rows.length}`);
  let ok = 0, fail = 0;
  for (const it of rows) {
    const sku = (it.detail || "").match(/SKU\s+(\w+)/)?.[1];
    let img = null, via = "";
    // 1) por SKU: matchea si el archivo de imagen contiene el SKU.
    if (sku) {
      const ps = await suggest(sku);
      const exact = ps.find(p => (p.image || "").includes(sku)) || ps[0];
      if (exact?.image) { img = exact.image; via = `SKU ${sku}` + (exact.image.includes(sku) ? " (archivo coincide)" : " (1er resultado)"); }
    }
    // 2) fallback: por modelo (primeras palabras del nombre).
    if (!img) {
      const modelo = it.name.replace(/^(REFRIGERADOR|FREEZER|LAVAVAJILLAS|HORNO|ENCIMERA|CAMPANA|LAVAPLATOS|GRIFO)\s+(INTEGRABLE\s+|EMPOTRABLE\s+|BAJO CUBIERTA\s+|DE COCINA\s+)?/i, "").split(" ").slice(0,3).join(" ");
      const ps = await suggest(modelo);
      if (ps[0]?.image) { img = ps[0].image; via = `modelo "${modelo}"`; }
    }
    if (!img) { console.log(`  ✗ ${it.name.slice(0,45)}  (no encontrado)`); fail++; continue; }
    await prisma.artefactoCatalog.update({ where: { id: it.id }, data: { imageUrl: img } });
    console.log(`  ✓ ${it.name.slice(0,45).padEnd(47)} ← ${via}`);
    ok++;
  }
  console.log(`\nActualizados: ${ok} · fallaron: ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
