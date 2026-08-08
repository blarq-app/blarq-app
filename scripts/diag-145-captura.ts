// Captura del Cuadro Resumen de Paseo del Sena para revisar el pendiente 145.
// Acuña una cookie de sesión (sin password, ver reference_preview_worktree_y_db_dev),
// abre la página de resumen y saca dos fotos: la tabla en pantalla y la copia
// prolija que se exporta a PNG (la que MJ le manda al cliente).
//
// Uso: npx tsx scripts/diag-145-captura.ts <sufijo>   (ej. "antes" / "despues")
import "dotenv/config";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PORT = process.env.CAPTURA_PORT ?? "3045";
const sufijo = process.argv[2] ?? "captura";

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true, name: true, role: true } });
  if (!user) throw new Error("No hay usuario en la base");
  const proyecto = await prisma.project.findFirst({
    where: { name: { contains: "Sena" } },
    select: { id: true, name: true },
  });
  if (!proyecto) throw new Error("No encontré Paseo del Sena");

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Falta NEXTAUTH_SECRET");
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret,
    salt: "authjs.session-token",
    maxAge: 60 * 60,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  // El tilde "Comparar con V2" guarda la preferencia en la base. Como esto
  // corre contra la base VIVA, bloqueamos ese PUT: la fila se prende en
  // pantalla para la foto, pero no se le escribe nada al proyecto real.
  await page.route("**/avance-objetivos", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue()
  );
  await page.goto(`http://localhost:${PORT}/proyectos/${proyecto.id}/resumen`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  // El cuadro es un client component: esperamos a que pinte la tabla.
  await page.getByText("Cuadro Resumen", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  // Con CAPTURA_COMPARAR=1 se prende el tilde de comparación con la versión
  // anterior (pendiente 141), para confirmar que esa fila sigue funcionando.
  if (process.env.CAPTURA_COMPARAR === "1") {
    await page.getByRole("checkbox").first().check();
    await page.waitForTimeout(600);
  }

  // 1) La tabla como se ve en pantalla (la tarjeta completa).
  const tarjeta = page
    .locator("div.bg-white.rounded-xl")
    .filter({ has: page.getByRole("heading", { name: "Cuadro Resumen" }) })
    .first();
  await tarjeta.screenshot({ path: `scripts/_capturas/145-pantalla-${sufijo}.png` });

  // 2) La copia prolija que se exporta a PNG. Vive fuera de pantalla
  //    (left:-10000px), así que la traemos a la vista SOLO para fotografiarla.
  await page.evaluate(() => {
    const nodo = document.querySelector("[data-export-cuadro]") as HTMLElement | null;
    const caja = nodo?.parentElement;
    if (caja) caja.setAttribute("style", "position:static");
  });
  await page.waitForTimeout(400);
  await page.locator("[data-export-cuadro]").screenshot({ path: `scripts/_capturas/145-imagen-${sufijo}.png` });

  console.log(`OK — capturas 145-pantalla-${sufijo}.png y 145-imagen-${sufijo}.png`);
  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
