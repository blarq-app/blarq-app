// Prueba del lector de comprobantes de transferencia (readTransferPhoto).
//
// Verifica las dos cosas que tiene que hacer bien:
//   1. De un comprobante: sacar fecha y monto (lo que identifica el traspaso).
//   2. De algo que NO es un comprobante (una factura): decir que no lo es, para
//      que el bot avise en vez de anotar cualquier cosa.
//
// No toca la base de datos. Sí llama a la API de Claude (usa ANTHROPIC_API_KEY
// del .env que se le pase).
//
// Uso: npx tsx scripts/test-read-transfer-photo.ts <ruta-env> <comprobante.png> <factura.png>
import { readFileSync } from "fs";

const [envPath, comprobantePath, facturaPath] = process.argv.slice(2);
if (!envPath || !comprobantePath || !facturaPath) {
  console.error(
    "Uso: npx tsx scripts/test-read-transfer-photo.ts <env> <comprobante.png> <factura.png>"
  );
  process.exit(1);
}
const env = readFileSync(envPath, "utf8");
const key = env.match(/ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!key) {
  console.error("no ANTHROPIC_API_KEY en", envPath);
  process.exit(1);
}
process.env.ANTHROPIC_API_KEY = key;

let fallos = 0;
function chequear(nombre: string, ok: boolean, detalle = "") {
  console.log(`  ${ok ? "OK  " : "FALLA"} · ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const { readTransferPhoto } = await import("@/lib/telegram/readTransferPhoto");

  console.log("COMPROBANTE de transferencia:");
  const c = await readTransferPhoto(
    readFileSync(comprobantePath).toString("base64"),
    "image/png"
  );
  console.log("   leído:", JSON.stringify(c));
  chequear("lo reconoce como comprobante", c.esComprobante === true);
  chequear("saca la fecha", c.transferDate === "2026-08-13", `fecha=${c.transferDate}`);
  chequear("saca el monto", c.amount === 2_500_000, `monto=${c.amount}`);

  console.log("\nFACTURA (no debería entrar por el chat de traspasos):");
  const f = await readTransferPhoto(
    readFileSync(facturaPath).toString("base64"),
    "image/png"
  );
  console.log("   leído:", JSON.stringify(f));
  chequear("dice que NO es un comprobante", f.esComprobante === false);
  chequear("explica qué vio", !!f.queEs, `queEs=${f.queEs}`);

  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLA(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
