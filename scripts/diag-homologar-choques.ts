// SOLO LECTURA sobre la viva. ¿Renombrar/fusionar categorías del catálogo
// chocaría con el @@unique([category, name])?
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const envProd = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const URL_VIVA = envProd.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: URL_VIVA } } });

// destino ← origen
const FUSIONES: Array<[string, string]> = [
  ["ASEO Y LIMPIEZA", "LIMPIEZA Y ASEO"],
];
const RENOMBRES: Array<[string, string]> = [
  ["INSTALACIONES ELECT.", "INSTALACIONES ELECTRICAS"],
  ["INSTALACIONES SANITARIAS", "INSTALACIONES SANITARIAS Y GASFITERIA"],
  ["ASEO Y LIMPIEZA", "LIMPIEZA Y ASEO"],
];

async function main() {
  if (!URL_VIVA.includes("shy-morning")) throw new Error("no es la viva");
  const todas = await prisma.partidaCatalog.findMany({
    select: { id: true, category: true, name: true },
  });
  const porCat = (c: string) => todas.filter((p) => p.category === c);

  console.log("FUSIONES — ¿mismo nombre a los dos lados?");
  for (const [destino, origen] of FUSIONES) {
    const a = new Set(porCat(destino).map((p) => p.name.trim().toUpperCase()));
    const choques = porCat(origen).filter((p) => a.has(p.name.trim().toUpperCase()));
    console.log(`  ${origen} → ${destino}: ${porCat(origen).length} partidas a mover · ${choques.length} choques`);
    for (const c of choques) console.log("     CHOCA:", c.name);
    console.log("     se mueven:", porCat(origen).map((p) => p.name).join(" | "));
    console.log("     ya estaban:", porCat(destino).map((p) => p.name).join(" | "));
  }

  console.log("\nRENOMBRES — ¿el nombre nuevo ya existe como categoría?");
  const cats = new Set(todas.map((p) => p.category));
  for (const [de, a] of RENOMBRES) {
    console.log(`  ${de} → ${a}: ${porCat(de).length} partidas · destino ya existe: ${cats.has(a)}`);
  }

  console.log("\n¿Hay partidas del catálogo con capítulo ADICIONALES?", cats.has("ADICIONALES"));
  console.log("\nCategorías del catálogo, todas:", [...cats].sort().join(" | "));
}
main().catch(console.error).finally(() => prisma.$disconnect());
