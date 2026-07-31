/**
 * Verifica que "Revisar precios" del CATÁLOGO siga funcionando igual después
 * de migrarlo a la lectura única `leerPrecioWeb` (arreglo 2026-07-31).
 *
 * Es la pantalla que YA estaba bien: acá interesa que no haya regresión, y de
 * paso que las tiendas sin API vengan marcadas como `discountKnown: false`
 * para que aplicar no les mande el descuento a 0 (eso sí es nuevo).
 *
 * Pega directo al endpoint con una cookie de sesión firmada. Solo LEE.
 * Correr con el dev server arriba:
 *   npx tsx scripts/verify-catalogo-revisar-precios.ts [url]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3157";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-catalogo-precios")
    .encrypt(key);
}

async function main() {
  // Unos pocos artefactos con link, de tiendas distintas, para no castigar a
  // las tiendas ni tardar minutos.
  const items = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { not: null } },
    select: { id: true, name: true, referenceLink: true },
    take: 8,
  });
  console.log(`Revisando ${items.length} artefactos del catálogo de dev…`);

  const res = await fetch(`${BASE}/api/catalogo/artefactos/revisar-precios`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `authjs.session-token=${await cookieDeSesion()}`,
    },
    body: JSON.stringify({ ids: items.map((i) => i.id) }),
  });
  if (!res.ok) {
    console.log("FALLA | el endpoint respondió", res.status);
    process.exitCode = 1;
    return;
  }
  const data = (await res.json()) as {
    rows: Array<{
      name: string;
      referenceLink: string;
      storedListPrice: number;
      webListPrice: number | null;
      webDiscount: number | null;
      discountKnown: boolean;
      status: string;
      changed: boolean;
    }>;
    resumen: { conLink: number; cambiaron: number; noLeidos: number };
  };

  console.log("Resumen:", JSON.stringify(data.resumen));
  let fallas = 0;
  for (const r of data.rows) {
    const host = (() => {
      try { return new URL(r.referenceLink).hostname.replace(/^www\./, ""); } catch { return "?"; }
    })();
    const esperaApi = /mk\.cl|ledstudio\.cl|kitchenhouse\.cl/.test(host);
    const marca =
      r.status !== "ok"
        ? "(no se pudo leer)"
        : r.discountKnown
          ? `dcto ${(100 * (r.webDiscount ?? 0)).toFixed(1)}% (confiable)`
          : "dcto desconocido — no se pisa el guardado";
    console.log(`  ${host.padEnd(18)} ${r.name.slice(0, 42).padEnd(44)} ${marca}`);
    // La regla: una tienda con API SIEMPRE debe venir con discountKnown=true
    // cuando se pudo leer; una sin API, nunca.
    if (r.status === "ok" && esperaApi !== r.discountKnown) {
      console.log(`     FALLA | ${host} debía venir discountKnown=${esperaApi}`);
      fallas++;
    }
  }
  console.log(
    fallas === 0
      ? "\nTODO OK — el catálogo sigue leyendo bien y marca las tiendas sin API."
      : `\n${fallas} FALLA(S)`
  );
  if (fallas > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
