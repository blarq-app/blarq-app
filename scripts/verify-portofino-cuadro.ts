/**
 * Capturas del Cuadro Resumen y del Fondo de Sueldos de Portofino después de
 * repartir las facturas por concepto e imputar los pagos. Solo navega.
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
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [error de página]", e.message));
  mkdirSync("scripts/_capturas", { recursive: true });

  await page.goto(`${BASE}/proyectos/${PROYECTO}/resumen`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByText("Cuadro Resumen").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "scripts/_capturas/portofino-cuadro-resumen-despues.png" });
  console.log("captura: cuadro resumen");

  await page.getByText("TOTAL PAGOS").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "scripts/_capturas/portofino-cuadro-total-pagos.png" });
  console.log("captura: total pagos");

  await page.getByText("Me paso a Sueldos").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "scripts/_capturas/portofino-sueldos-despues.png" });
  console.log("captura: me paso a sueldos");

  // La ficha de la factura 183, con el desglose nuevo.
  const f183 = await page.evaluate(async () => {
    const r = await fetch("/api/facturas?dummy=1").catch(() => null);
    return r ? "ok" : "no";
  });
  console.log("  (ping api:", f183, ")");
  await browser.close();
})().catch((e) => { console.error("ERROR:", e); process.exitCode = 1; });
