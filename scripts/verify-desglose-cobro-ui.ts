/** Captura la ficha de la factura 183 con el desglose del cobro cargado. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";
const BASE = "http://localhost:3101";
const FACTURA = "cms7mgpl2000ll304hswnem3e";
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [error de página]", e.message));
  await page.goto(`${BASE}/facturas/${FACTURA}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  mkdirSync("scripts/_capturas", { recursive: true });
  await page.getByText("Desglose del cobro").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "scripts/_capturas/portofino-desglose-cobro-ui.png" });
  console.log("captura: desglose del cobro");
  await browser.close();
})().catch((e) => { console.error("ERROR:", e); process.exitCode = 1; });
