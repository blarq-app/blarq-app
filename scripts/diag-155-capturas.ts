/**
 * Pruebas visuales del pendiente 155 (condiciones editables del PDF).
 * Corre contra la base de DESARROLLO y el dev server de este worktree.
 *
 * Deja en scripts/_capturas-155/:
 *   editor-condiciones.png      el bloque nuevo dentro de la cotización
 *   configuracion-estandar.png  la pantalla de condiciones estándar
 *   obra-precargada.pdf         PDF con las condiciones tal como vienen
 *   obra-editada.pdf            PDF después de editar/agregar una condición
 *
 * Uso: npx tsx scripts/diag-155-capturas.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const PORT = process.env.CAPTURA_PORT ?? "3155";
const OUT = path.join(process.cwd(), "scripts", "_capturas-155");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const user = await prisma.user.findFirst({
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) throw new Error("No hay usuario en la base");

  const version = await prisma.budgetVersion.findFirst({
    where: {
      type: "obra",
      obraItems: { some: {} },
      project: { name: { contains: "Portofino" } },
    },
    select: { id: true, projectId: true, version: true, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!version) throw new Error("No encontré una cotización de obra con partidas");
  console.log(`cotización: ${version.project.name} · obra ${version.version}`);

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Falta NEXTAUTH_SECRET");
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret,
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
  const base = `http://localhost:${PORT}`;

  async function bajarPDF(nombre: string) {
    const res = await ctx.request.get(
      `${base}/api/presupuestos/${version!.id}/pdf`,
      { timeout: 180_000 }
    );
    if (!res.ok()) throw new Error(`PDF ${nombre}: HTTP ${res.status()}`);
    fs.writeFileSync(path.join(OUT, nombre), await res.body());
    console.log(`· ${nombre}`);
  }

  // 1. PDF con las condiciones tal como vienen precargadas.
  await bajarPDF("obra-precargada.pdf");

  // 2. El editor: bloque de condiciones dentro de la cotización.
  await page.goto(
    `${base}/proyectos/${version.projectId}/presupuesto/${version.id}`,
    { waitUntil: "networkidle", timeout: 180_000 }
  );
  await page.getByText("Salen en el PDF del cliente").first().waitFor({ timeout: 60_000 });
  const bloque = page
    .locator("div.bg-white.rounded-xl")
    .filter({ hasText: "Salen en el PDF del cliente" })
    .last();
  await bloque.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await bloque.screenshot({ path: path.join(OUT, "editor-condiciones.png") });
  console.log("· editor-condiciones.png");

  // 3. La pantalla de condiciones estándar.
  await page.goto(`${base}/configuracion/condiciones`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, "configuracion-estandar.png"),
    fullPage: false,
  });
  console.log("· configuracion-estandar.png");

  // 4. Editar las condiciones de ESA versión y volver a bajar el PDF: es la
  //    prueba de que ahora manda lo que está escrito en la cotización.
  const actuales = (await prisma.budgetVersion.findUnique({
    where: { id: version.id },
    select: { conditions: true },
  }))!.conditions as unknown as Array<{ lead?: string | null; text: string }>;

  const editadas = [
    ...actuales.slice(0, 3),
    {
      text: "PRUEBA 155: esta condición la escribió MJ dentro de la cotización y tiene que salir impresa acá.",
    },
    ...actuales.slice(3),
  ];
  editadas[0] = {
    text: "PRUEBA 155 (editada): " + actuales[0].text,
  };
  await prisma.budgetVersion.update({
    where: { id: version.id },
    data: { conditions: editadas as unknown as Prisma.InputJsonValue },
  });
  await bajarPDF("obra-editada.pdf");

  // Dejamos la versión como estaba para no ensuciar la base de desarrollo.
  await prisma.budgetVersion.update({
    where: { id: version.id },
    data: { conditions: actuales as unknown as Prisma.InputJsonValue },
  });

  await browser.close();
  console.log(`\nlisto → ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
