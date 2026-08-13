/**
 * Pendiente 155 — prueba de punta a punta del flujo de la plantilla, contra el
 * dev server de este worktree y la base de DESARROLLO.
 *
 * Comprueba las tres cosas que MJ pidió ver:
 *   1. se puede agregar una condición a las estándar desde la app;
 *   2. una cotización NUEVA sale con esa condición adentro;
 *   3. una cotización VIEJA no se entera (queda igual que antes).
 *
 *   npx tsx scripts/diag-155-flujo-plantilla.ts
 */
import "dotenv/config";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { parseCondiciones } from "../src/lib/presupuesto/condiciones";

const prisma = new PrismaClient();
const BASE = `http://localhost:${process.env.CAPTURA_PORT ?? "3155"}`;
const FRASE = "PRUEBA 155: los escombros se retiran al final de cada semana.";

async function main() {
  const user = await prisma.user.findFirst({
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) throw new Error("No hay usuario en la base");
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Falta NEXTAUTH_SECRET");
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret,
    salt: "authjs.session-token",
    maxAge: 60 * 60,
  });
  const headers = {
    "Content-Type": "application/json",
    cookie: `authjs.session-token=${token}`,
  };

  const vieja = await prisma.budgetVersion.findFirst({
    where: { type: "obra", project: { name: { contains: "Portofino" } } },
    select: { id: true, version: true, conditions: true, project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!vieja) throw new Error("No encontré una cotización de obra");
  const antesVieja = JSON.stringify(vieja.conditions);
  console.log(
    `cotización vieja: ${vieja.project.name} obra ${vieja.version} → ${
      parseCondiciones(vieja.conditions)?.length
    } condiciones`
  );

  // 1. Agregar una condición a las estándar (lo que hace el tilde).
  const r1 = await fetch(`${BASE}/api/condiciones-estandar`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tipo: "obra", condicion: { text: FRASE } }),
  });
  const plantilla = await r1.json();
  console.log(
    `\n1. plantilla de obra: ${plantilla.items.length} condiciones · última: "${
      plantilla.items.at(-1).text
    }"`
  );

  // 2. Crear una cotización NUEVA de obra y ver con qué arranca.
  const r2 = await fetch(`${BASE}/api/presupuestos`, {
    method: "POST",
    headers,
    body: JSON.stringify({ projectId: vieja.project.id, type: "obra" }),
  });
  const nueva = await r2.json();
  const condsNueva = parseCondiciones(nueva.conditions) ?? [];
  console.log(
    `2. cotización nueva ${nueva.version}: ${condsNueva.length} condiciones · ` +
      `¿trae la nueva? ${condsNueva.some((c) => c.text === FRASE) ? "SÍ" : "NO"}`
  );

  // 3. La vieja no se movió.
  const releida = await prisma.budgetVersion.findUnique({
    where: { id: vieja.id },
    select: { conditions: true },
  });
  const igual = JSON.stringify(releida!.conditions) === antesVieja;
  console.log(`3. la cotización vieja quedó ${igual ? "IGUAL" : "CAMBIADA (mal)"}`);

  // Limpieza: sacar la condición de prueba de la plantilla y borrar la versión
  // que creamos.
  const limpia = plantilla.items.filter(
    (c: { text: string }) => c.text !== FRASE
  );
  await fetch(`${BASE}/api/condiciones-estandar`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ tipo: "obra", items: limpia }),
  });
  await prisma.budgetVersion.delete({ where: { id: nueva.id } });
  console.log("\n(limpieza hecha: plantilla restaurada y versión de prueba borrada)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
