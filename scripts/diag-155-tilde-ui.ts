/**
 * Pendiente 155 — prueba del tilde "dejarla también para las próximas" tal
 * como se usa: agregando la condición desde la pantalla, no por API.
 *
 * Deja scripts/_capturas-155/editor-tilde.png y verifica en la base que la
 * condición quedó en la cotización Y en la plantilla. Restaura todo al final.
 *
 *   npx tsx scripts/diag-155-tilde-ui.ts
 */
import "dotenv/config";
import path from "node:path";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseCondiciones } from "../src/lib/presupuesto/condiciones";

const prisma = new PrismaClient();
const PORT = process.env.CAPTURA_PORT ?? "3155";
const OUT = path.join(process.cwd(), "scripts", "_capturas-155");
const FRASE = "Los escombros se retiran al final de cada semana de trabajo.";

async function main() {
  const user = await prisma.user.findFirst({
    select: { id: true, email: true, name: true, role: true },
  });
  const v = await prisma.budgetVersion.findFirst({
    where: { type: "obra", project: { name: { contains: "Portofino" } } },
    select: { id: true, projectId: true, conditions: true },
    orderBy: { createdAt: "desc" },
  });
  if (!user || !v) throw new Error("Falta usuario o cotización");
  const condsAntes = v.conditions;
  const plantillaAntes = await prisma.conditionTemplate.findUnique({
    where: { type: "obra" },
  });

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret: secret!,
    salt: "authjs.session-token",
    maxAge: 60 * 60,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));

  await page.goto(
    `http://localhost:${PORT}/proyectos/${v.projectId}/presupuesto/${v.id}`,
    { waitUntil: "networkidle", timeout: 180_000 }
  );
  await page.getByText("Salen en el PDF del cliente").first().waitFor({ timeout: 60_000 });

  await page.getByRole("button", { name: "+ agregar condición" }).click();
  const nueva = page.getByPlaceholder("Escribí la condición…").last();
  await nueva.fill(FRASE);
  await page
    .getByText("Dejarla también para las próximas cotizaciones de obra")
    .click();

  const bloque = page
    .locator("div.bg-white.rounded-xl")
    .filter({ hasText: "Salen en el PDF del cliente" })
    .last();
  await bloque.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await bloque.screenshot({ path: path.join(OUT, "editor-tilde.png") });
  console.log("· editor-tilde.png");

  // Blur: es lo que dispara el guardado en la plantilla.
  await page.getByText("Condiciones", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await bloque.screenshot({ path: path.join(OUT, "editor-tilde-guardado.png") });
  console.log("· editor-tilde-guardado.png");

  const despues = await prisma.budgetVersion.findUnique({
    where: { id: v.id },
    select: { conditions: true },
  });
  const plantillaDespues = await prisma.conditionTemplate.findUnique({
    where: { type: "obra" },
  });
  const enVersion = (parseCondiciones(despues!.conditions) ?? []).some(
    (c) => c.text === FRASE
  );
  const enPlantilla = (parseCondiciones(plantillaDespues!.items) ?? []).some(
    (c) => c.text === FRASE
  );
  console.log(`\n¿quedó en la cotización? ${enVersion ? "SÍ" : "NO"}`);
  console.log(`¿quedó en la plantilla?   ${enPlantilla ? "SÍ" : "NO"}`);
  console.log(`errores de consola: ${errores.length ? errores.join(" | ") : "ninguno"}`);

  await browser.close();

  // Restaurar la base de desarrollo.
  await prisma.budgetVersion.update({
    where: { id: v.id },
    data: { conditions: condsAntes as Prisma.InputJsonValue },
  });
  if (plantillaAntes) {
    await prisma.conditionTemplate.update({
      where: { type: "obra" },
      data: { items: plantillaAntes.items as Prisma.InputJsonValue },
    });
  }
  console.log("(base restaurada)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
