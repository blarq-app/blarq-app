// Diagnóstico SOLO LECTURA: artefactos del catálogo que tienen link pero no
// muestran foto. ¿Es que imageUrl está vacío, o está guardado y la URL ya no
// carga? Y si está vacío, ¿la web todavía publica la foto (o sea, "Extraer"
// la traería)?
//
// No escribe nada. Uso: npx tsx scripts/diag-132-artefactos-sin-foto.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  .trim();
if (!url) process.exit(1);
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== HOST:", url!.match(/@([^/.]+)/)?.[1], "===\n");

  const cat = await prisma.artefactoCatalog.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      referenceLink: true,
      imageUrl: true,
      lastPriceCheck: true,
    },
    orderBy: { name: "asc" },
  });

  const conLink = cat.filter((a) => a.referenceLink);
  const sinFoto = cat.filter((a) => !a.imageUrl);
  const sinFotoConLink = cat.filter((a) => !a.imageUrl && a.referenceLink);

  console.log(`Entradas del catálogo:          ${cat.length}`);
  console.log(`  con link:                     ${conLink.length}`);
  console.log(`  SIN foto guardada (imageUrl): ${sinFoto.length}`);
  console.log(`  sin foto PERO con link:       ${sinFotoConLink.length}`);
  console.log(
    `  (esos ${sinFotoConLink.length} son los que muestran el cuadrito vacío aunque tengan link)\n`
  );

  console.log("=".repeat(90));
  console.log("SIN FOTO PERO CON LINK — los primeros 40");
  console.log("=".repeat(90));
  for (const a of sinFotoConLink.slice(0, 40))
    console.log(
      `  ${a.name.slice(0, 48).padEnd(50)} ${(a.brand ?? "—").padEnd(
        10
      )} ${a.referenceLink!.slice(0, 45)}`
    );

  // El caso del pantallazo
  console.log(`\n\n${"=".repeat(90)}`);
  console.log("EL CASO DEL PANTALLAZO: TOALLERO 30CM CROMO");
  console.log("=".repeat(90));
  const toalleros = cat.filter((a) => /toallero/i.test(a.name));
  for (const a of toalleros)
    console.log(
      `  "${a.name}" (${a.brand ?? "—"})\n     foto: ${
        a.imageUrl ? a.imageUrl.slice(0, 70) : "NO TIENE (null)"
      }\n     link: ${a.referenceLink?.slice(0, 70) ?? "—"}`
    );

  // ¿Las fotos que SÍ están guardadas siguen cargando? Muestra de dominios.
  console.log(`\n\n${"=".repeat(90)}`);
  console.log("DE DÓNDE SALEN LAS FOTOS QUE SÍ ESTÁN GUARDADAS");
  console.log("=".repeat(90));
  const dominios = new Map<string, number>();
  for (const a of cat) {
    if (!a.imageUrl) continue;
    let d = "(dato raro)";
    try {
      d = a.imageUrl.startsWith("data:")
        ? "(imagen embebida data:)"
        : new URL(a.imageUrl).host;
    } catch {
      d = a.imageUrl.slice(0, 30);
    }
    dominios.set(d, (dominios.get(d) ?? 0) + 1);
  }
  for (const [d, n] of [...dominios].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${d}`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
