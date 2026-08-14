// Prueba SOLO LECTURA del texto que MJ le escribe al bot junto al comprobante:
// que "Sena obra" resuelva a la obra correcta y al concepto correcto, contra
// los nombres de proyecto REALES.
//
// No escribe nada: matchProject solo lee la lista de proyectos.
// Uso: npx tsx scripts/test-parse-traspaso-texto.ts <ruta-env>
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Falta la ruta al .env");
  process.exit(1);
}
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
process.env.DATABASE_URL = url;
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

// Cada caso: lo que MJ escribe → qué obra y qué concepto se esperan.
// null en obra = se espera que el bot NO resuelva y pregunte.
const CASOS: { texto: string; obra: string | null; concepto: string | null; ambos?: boolean }[] = [
  { texto: "Sena obra", obra: "Paseo del Sena", concepto: "obra" },
  { texto: "Paseo del Sena muebles", obra: "Paseo del Sena", concepto: "muebles" },
  { texto: "sena OBRA", obra: "Paseo del Sena", concepto: "obra" },
  { texto: "Portofino obra", obra: "Portofino", concepto: "obra" },
  // Sin concepto: la obra sí se resuelve, el bot pregunta el concepto con botones.
  { texto: "Sena", obra: "Paseo del Sena", concepto: null },
  // Los dos conceptos a la vez: el bot corta y avisa que no puede partir un
  // movimiento en dos — ni siquiera llega a buscar la obra, por eso obra=null.
  { texto: "Sena obra y muebles", obra: null, concepto: null, ambos: true },
  // Obra que no existe: el bot lista las opciones en vez de adivinar.
  { texto: "Chirimoya obra", obra: null, concepto: "obra" },
];

let fallos = 0;

async function main() {
  console.log("=== HOST:", host, "===\n");
  const { parseTraspasoTexto } = await import("@/lib/telegram/parseTraspasoTexto");
  const { matchProject } = await import("@/lib/telegram/matchProjectCategory");
  const { prisma } = await import("@/lib/prisma");

  for (const caso of CASOS) {
    const { concepto, ambos, resto } = parseTraspasoTexto(caso.texto);
    const proj = ambos ? null : await matchProject(resto);
    const obraResuelta =
      proj && proj.kind === "exacto" && proj.match ? proj.match.name : null;

    const okObra = obraResuelta === caso.obra;
    const okConcepto = concepto === caso.concepto;
    const okAmbos = !!ambos === !!caso.ambos;
    const ok = okObra && okConcepto && okAmbos;
    if (!ok) fallos++;

    console.log(
      `  ${ok ? "OK  " : "FALLA"} · "${caso.texto}" → obra=${obraResuelta ?? "(pregunta)"} · concepto=${concepto ?? "(pregunta)"}${ambos ? " · dice que son los dos" : ""}`
    );
    if (!ok) {
      console.log(
        `        esperado: obra=${caso.obra ?? "(pregunta)"} · concepto=${caso.concepto ?? "(pregunta)"}`
      );
    }
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLA(S)`}`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
