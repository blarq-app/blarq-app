/**
 * Captura la tabla "Presupuesto vs Real — Por Categoría" del proyecto #60,
 * para ver el desglose recuperado. Solo navega y saca la foto.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3101";
const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
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
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/proyectos/${PROYECTO}/resumen`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  mkdirSync("scripts/_capturas", { recursive: true });
  await page.getByText("Presupuesto vs Real").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "scripts/_capturas/portofino-v7-desglose-categorias.png" });
  console.log("captura: scripts/_capturas/portofino-v7-desglose-categorias.png");
  await browser.close();
})().catch((e) => { console.error("ERROR:", e); process.exitCode = 1; });
