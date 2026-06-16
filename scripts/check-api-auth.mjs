// Guardián de autenticación de la API — "negar por defecto".
//
// Recorre TODOS los route handlers bajo src/app/api y verifica que cada uno
// llame a `requireSession()`. Si encuentra uno que no lo hace y que no está
// en la ALLOWLIST explícita, imprime los culpables y sale con código 1.
//
// Está enchufado al build (`package.json` → "build": "node scripts/check-api-auth.mjs && next build").
// Vercel corre el build en cada deploy, así que un endpoint nuevo sin chequeo
// de sesión HACE FALLAR EL DEPLOY y no llega a producción. Eso convierte
// "negar por defecto" en algo automático, no dependiente de la memoria de nadie.
//
// Alcance honesto: verifica que la LLAMADA a requireSession esté presente en
// el archivo (no hace análisis de flujo que confirme que está perfectamente
// cableada en cada método). Es una red barata y fuerte, en la línea de los
// scripts/test-* del repo. Para esos casos raros está la verificación manual.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_DIR = "src/app/api";

// ALLOWLIST — endpoints exentos de requireSession, con su motivo.
// Rutas relativas a src/app/api. Mantener esta lista corta y justificada:
// cada entrada es una puerta que responde SIN sesión de usuaria.
const ALLOWLIST = new Set([
  // El login mismo (NextAuth). Si pidiera sesión, no se podría loguear nunca.
  "auth/[...nextauth]/route.ts",
  // Webhook de Telegram: lo llama Telegram, no el navegador. Se autentica con
  // su secreto propio (x-telegram-bot-api-secret-token), obligatorio.
  "telegram/webhook/route.ts",
]);

// La marca que buscamos en el código del handler.
const REQUIRED_CALL = "requireSession";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

const files = walk(API_DIR);
const offenders = [];
const allowlistSeen = new Set();

for (const file of files) {
  const rel = relative(API_DIR, file).split("\\").join("/");
  if (ALLOWLIST.has(rel)) {
    allowlistSeen.add(rel);
    continue;
  }
  const src = readFileSync(file, "utf8");
  if (!src.includes(REQUIRED_CALL)) {
    offenders.push(rel);
  }
}

// Si una entrada de la allowlist ya no existe, avisar (la lista quedó vieja).
const staleAllowlist = [...ALLOWLIST].filter((p) => !allowlistSeen.has(p));

let failed = false;

if (offenders.length > 0) {
  failed = true;
  console.error(
    `\n[check-api-auth] ${offenders.length} endpoint(s) sin requireSession() y fuera de la allowlist:\n`
  );
  for (const o of offenders) console.error(`  ✗ ${o}`);
  console.error(
    `\nCada endpoint /api debe llamar a requireSession() (ver src/lib/apiAuth.ts),\n` +
      `o sumarse a la ALLOWLIST de este script con su motivo si es público a propósito.\n`
  );
}

if (staleAllowlist.length > 0) {
  failed = true;
  console.error(
    `\n[check-api-auth] La allowlist nombra endpoints que ya no existen (limpiar la lista):\n`
  );
  for (const p of staleAllowlist) console.error(`  ? ${p}`);
}

if (failed) {
  process.exit(1);
}

console.log(
  `[check-api-auth] OK — ${files.length} endpoints revisados, ${ALLOWLIST.size} en allowlist, todos los demás con requireSession().`
);
