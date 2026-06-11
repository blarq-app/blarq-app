require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

// slug "gkl030674-..." → RefId "GKL-03-0674"
function refIdFromLink(link) {
  const m = link.match(/mk\.cl\/([a-z]{3})(\d{2})(\d{4})-/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}-${m[3]}`;
}

async function imgFor(refId) {
  const url = `https://www.mk.cl/api/catalog_system/pub/products/search?fq=alternateIds_RefId:${refId}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const a = await r.json();
  if (!a.length) return null;
  const imgs = a[0].items?.[0]?.images;
  return imgs?.[0]?.imageUrl ?? null;
}

async function main() {
  const rows = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { contains: "mk.cl" }, imageUrl: null },
    select: { id: true, name: true, referenceLink: true },
  });
  console.log(`MK sin foto: ${rows.length}`);
  let ok = 0, fail = 0;
  for (const it of rows) {
    const refId = refIdFromLink(it.referenceLink);
    if (!refId) { console.log(`  ? no pude derivar RefId: ${it.name}`); fail++; continue; }
    let img = null;
    try { img = await imgFor(refId); } catch (e) {}
    if (!img) { console.log(`  ✗ ${refId}  ${it.name.slice(0,40)}  (sin imagen)`); fail++; continue; }
    await prisma.artefactoCatalog.update({ where: { id: it.id }, data: { imageUrl: img } });
    console.log(`  ✓ ${refId}  ${it.name.slice(0,40)}`);
    ok++;
  }
  console.log(`\nActualizados: ${ok} · fallaron: ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
