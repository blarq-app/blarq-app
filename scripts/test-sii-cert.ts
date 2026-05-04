// Smoke test del cert digital. Solo verifica que:
//   - El archivo existe en SII_CERT_PATH
//   - SII_CERT_PASSWORD descrifra el PKCS#12
//   - Adentro hay private key + certificate
//   - Se puede extraer el RUT del subject
//
// No hace ninguna llamada de red. Si esto falla, todo lo de SII falla.
//
// Uso: npx tsx scripts/test-sii-cert.ts

import "dotenv/config";
import { loadCert } from "../src/lib/sii/cert";

try {
  const cert = loadCert();
  console.log("✓ Cert cargado correctamente");
  console.log(`  RUT del titular: ${cert.rutHolder}`);
  console.log(`  Common Name (CN): ${cert.certificate.subject.getField("CN")?.value}`);
  console.log(`  Issuer: ${cert.certificate.issuer.getField("CN")?.value}`);
  console.log(`  Vence: ${cert.certificate.validity.notAfter.toISOString().slice(0, 10)}`);
  const daysLeft = Math.floor(
    (cert.certificate.validity.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  console.log(`  Días hasta vencer: ${daysLeft}`);
  console.log(`  Private key bits: ${(cert.privateKey as { n?: { bitLength?: () => number } }).n?.bitLength?.() ?? "?"}`);
  console.log("\n✅ Cert válido. Listo para Fase B (auth con SII).");
} catch (e) {
  console.error("❌ Error cargando cert:", (e as Error).message);
  process.exit(1);
}
