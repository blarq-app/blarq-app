/** Captura los movimientos de la clienta en Banco, para ver el estado ya conciliado. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";
const BASE = "http://localhost:3101";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
(async () => {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  const token = await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("verificacion").encrypt(key);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [error de página]", e.message));
  await page.goto(`${BASE}/banco/movimientos`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const buscador = page.getByPlaceholder(/Buscar descripci/i).first();
  await buscador.fill("0105112904");
  await page.waitForTimeout(2500);
  mkdirSync("scripts/_capturas", { recursive: true });
  await page.screenshot({ path: "scripts/_capturas/portofino-banco-conciliados.png" });
  console.log("captura: banco");
  const txt = await page.evaluate(() => document.body.innerText);
  for (const pal of ["PENDIENTE", "CONCILIADO", "Conciliado", "Pendiente"]) {
    const n = (txt.match(new RegExp(pal, "g")) ?? []).length;
    console.log(`  "${pal}" aparece ${n} veces`);
  }
  await browser.close();
})().catch((e) => { console.error("ERROR:", e); process.exitCode = 1; });
