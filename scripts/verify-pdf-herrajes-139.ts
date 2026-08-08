// Baja los dos PDF de la cotización de muebles de dev (el del cliente y el del
// mueblista) para verificar que los nombres de herraje salen homologados
// (pendiente 139). Solo lectura: no escribe en la base.
// Uso: npx tsx scripts/verify-pdf-herrajes-139.ts [url]
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3143";
const PRESUPUESTO = "cmot430wx007brtnrgmh4vmra";
const OUT = "scripts/_capturas";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf(
    "sha256",
    SECRET,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64,
  );
  return await new EncryptJWT({
    name: "MJ Blanco",
    email: "mjblanco@blarq.cl",
    sub: "verificacion",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-pdf")
    .encrypt(key);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const c = await cookie();
  const headers = { cookie: `authjs.session-token=${c}` };

  for (const [nombre, url] of [
    ["139-pdf-mueblista", `${BASE}/api/presupuestos/${PRESUPUESTO}/pdf?tipo=mueblista`],
    ["139-pdf-cliente", `${BASE}/api/presupuestos/${PRESUPUESTO}/pdf`],
  ] as const) {
    const res = await fetch(url, { headers });
    console.log(`${nombre}: ${res.status} ${res.headers.get("content-type")}`);
    if (!res.ok) {
      console.log("  ", (await res.text()).slice(0, 200));
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(`${OUT}/${nombre}.pdf`, buf);
    console.log(`  → ${OUT}/${nombre}.pdf (${Math.round(buf.length / 1024)} KB)`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
