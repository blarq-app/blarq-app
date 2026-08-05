// Diagnóstico SOLO LECTURA: ¿cuántas fotos del catálogo de artefactos están
// rotas? Guardamos la URL de la imagen del proveedor (VTEX/Shopify) y esa URL
// puede morir cuando el proveedor reemplaza la foto → el catálogo muestra el
// cuadrito vacío aunque el campo tenga dato.
//
// No escribe nada (solo consulta la web). Uso:
//   npx tsx scripts/diag-132-fotos-rotas-catalogo.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) process.exit(1);
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function probar(u: string): Promise<number | string> {
  try {
    const r = await fetch(u, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
      signal: AbortSignal.timeout(15000),
    });
    // Una foto viva responde 200 y con content-type de imagen. VTEX devuelve
    // 404 con JSON cuando el id de la imagen ya no existe.
    const ct = r.headers.get("content-type") ?? "";
    if (r.ok && ct.startsWith("image/")) return 200;
    return r.ok ? `ok pero ${ct}` : r.status;
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 40)}`;
  }
}

async function main() {
  console.log("=== HOST:", url!.match(/@([^/.]+)/)?.[1], "===\n");

  const cat = await prisma.artefactoCatalog.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      imageUrl: true,
      referenceLink: true,
    },
    orderBy: { name: "asc" },
  });

  const conFoto = cat.filter(
    (a) => a.imageUrl && !a.imageUrl.startsWith("data:")
  );
  console.log(
    `Entradas: ${cat.length} · con foto por URL: ${conFoto.length} · con foto embebida (data:): ${
      cat.filter((a) => a.imageUrl?.startsWith("data:")).length
    } · sin foto: ${cat.filter((a) => !a.imageUrl).length}\n`
  );
  console.log(`Probando ${conFoto.length} URLs…\n`);

  const rotas: { name: string; brand: string | null; estado: string; link: string | null }[] = [];
  let vivas = 0;
  // De a 8 para no golpear el CDN de golpe.
  for (let i = 0; i < conFoto.length; i += 8) {
    const lote = conFoto.slice(i, i + 8);
    const res = await Promise.all(lote.map((a) => probar(a.imageUrl!)));
    res.forEach((r, j) => {
      if (r === 200) vivas++;
      else
        rotas.push({
          name: lote[j].name,
          brand: lote[j].brand,
          estado: String(r),
          link: lote[j].referenceLink,
        });
    });
    process.stdout.write(`  ${Math.min(i + 8, conFoto.length)}/${conFoto.length}\r`);
  }

  console.log(`\n\n${"=".repeat(90)}`);
  console.log(`RESULTADO: ${vivas} fotos cargan bien · ${rotas.length} ROTAS`);
  console.log("=".repeat(90));
  for (const r of rotas)
    console.log(
      `  [${r.estado}] ${r.name.slice(0, 50).padEnd(52)} ${(r.brand ?? "—").padEnd(
        10
      )} ${r.link ? "tiene link → se puede recuperar" : "SIN LINK → hay que subirla a mano"}`
    );

  const recuperables = rotas.filter((r) => r.link).length;
  console.log(
    `\n  De las ${rotas.length} rotas, ${recuperables} tienen link (la foto se puede volver a bajar del proveedor) y ${
      rotas.length - recuperables
    } no.`
  );
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
