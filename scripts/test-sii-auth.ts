// Test del flow de autenticación SII end-to-end:
//   - Carga cert
//   - Pide seed
//   - Firma seed
//   - Obtiene token
//
// Si el token aparece, Fase A está cerrada.
//
// Uso: npx tsx scripts/test-sii-auth.ts

import "dotenv/config";
import { getSiiToken } from "../src/lib/sii/siiAuth";

async function main() {
  console.log("Pidiendo token al SII (palena.sii.cl)...");
  const start = Date.now();
  const token = await getSiiToken();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ Token obtenido en ${elapsed}s:`);
  console.log(`  ${token.slice(0, 30)}... (${token.length} chars)`);
  console.log("\n✅ Auth con SII OK. Listo para Fase B (consultar DTEs).");
}

main().catch((e) => {
  console.error("❌ Auth falló:", (e as Error).message);
  process.exit(1);
});
