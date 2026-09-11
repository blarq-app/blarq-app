/**
 * Semilla de las plantillas de muebles a partir del itemizado REAL de Casa
 * Los Algarrobos (pedido de MJ, 2026-09-11): un capítulo tipo por cada
 * capítulo de la cotización, con sus partidas base y componentes.
 *
 *   npx tsx scripts/seed-plantillas-algarrobos.ts <env-origen> <env-destino> [--apply]
 *
 * Lee Los Algarrobos del ORIGEN (solo lectura; la viva) y escribe las
 * plantillas en el DESTINO (la base local para probar; la viva con OK de MJ).
 * Sin --apply solo muestra lo que crearía. Si ya existe una plantilla con el
 * mismo nombre, la reemplaza.
 *
 * Qué toma de cada capítulo: la versión más nueva donde ese capítulo tiene
 * componentes con texto (la V3 tiene CLOSET SECUNDARIOS con componentes en
 * blanco; ahí cae a la V1, "CLOSET C/PUERTAS", que sí los tiene). Solo las
 * partidas base (las alternativas para el cliente no van). Nunca precios.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const [envOrigen, envDestino] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
if (!envOrigen || !envDestino) throw new Error("uso: <env-origen> <env-destino> [--apply]");
const urlDe = (p: string) => readFileSync(p, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const src = new PrismaClient({ datasources: { db: { url: urlDe(envOrigen) } } });
const dst = new PrismaClient({ datasources: { db: { url: urlDe(envDestino) } } });
const host = (u: string) => u.match(/ep-[a-z-]+|localhost/)?.[0] ?? "?";

// Nombre de la plantilla por capítulo real (los nombres cortos los pone MJ
// después si quiere; acá se usan los del presupuesto, en Título).
const NOMBRE_PLANTILLA: Record<string, string> = {
  "COCINA Y LOGIA": "Cocina y logia",
  "BAÑO PRINCIPAL": "Baño",
  "WALKING CLOSET": "Walking closet",
  "CLOSET C/PUERTAS": "Closet con puertas",
  "CLOSET SECUNDARIOS": "Closet con puertas",
};

async function main() {
  console.log(`origen: ${host(urlDe(envOrigen))} (solo lectura) → destino: ${host(urlDe(envDestino))} ${apply ? "APLICAR" : "(solo mostrar)"}`);
  const versiones = await src.budgetVersion.findMany({
    where: { type: "muebles", project: { name: { contains: "Algarrobos" } } },
    include: {
      muebleChapters: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" }, include: { details: { orderBy: { sortOrder: "asc" } } } } },
      },
    },
    orderBy: { createdAt: "desc" }, // la más nueva primero
  });

  // Por nombre de plantilla, el capítulo más nuevo con componentes con texto.
  type Cap = (typeof versiones)[0]["muebleChapters"][0];
  const elegidos = new Map<string, { cap: Cap; version: string }>();
  for (const v of versiones) {
    for (const cap of v.muebleChapters) {
      const nombre = NOMBRE_PLANTILLA[cap.name.trim().toUpperCase()];
      if (!nombre || elegidos.has(nombre)) continue;
      const base = cap.items.filter((i) => !i.alternativeOfId);
      const tieneTexto = base.some((i) => i.details.some((d) => d.name.trim() && d.material.trim()));
      if (tieneTexto) elegidos.set(nombre, { cap, version: v.version });
    }
  }

  // Una plantilla es GENÉRICA: se le quita lo que era de ese proyecto —
  // "CUBIERTAS (ALTO - MINERALI)" → "CUBIERTAS", proveedor "CARLOS - BEIGE
  // ULTRAMATE" → "CARLOS".
  const generico = (s: string) => s.replace(/\s*\(.*\)\s*$/, "").trim();
  // El proveedor de referencia es la primera palabra ("CARLOS - BEIGE
  // ULTRAMATE" y "GIACOMO MINERALI RESP ALTO" llevan la melamina o la cubierta
  // de ese proyecto pegadas al nombre).
  const proveedorBase = (s: string | null) => (s ? s.trim().split(/\s+/)[0] || null : null);

  let orden = 0;
  for (const [nombre, { cap, version }] of elegidos) {
    const base = cap.items
      .filter((i) => !i.alternativeOfId)
      .map((i) => ({ ...i, name: generico(i.name), supplier: proveedorBase(i.supplier) }));
    console.log(`\n${nombre}  (de ${cap.name}, ${version})`);
    for (const it of base) {
      const comps = it.details.filter((d) => d.name.trim() || d.material.trim());
      console.log(`  ${it.name} · ${it.kind} · util ${it.utilityPercentage} · prov ${it.supplier ?? "-"} · "${it.descriptionGeneral ?? ""}"`);
      for (const d of comps) console.log(`      - ${d.name} | ${d.material}`);
    }
    if (!apply) continue;
    const existente = await dst.muebleChapterTemplate.findUnique({ where: { name: nombre } });
    await dst.$transaction(async (tx) => {
      if (existente) await tx.muebleChapterTemplate.delete({ where: { id: existente.id } });
      await tx.muebleChapterTemplate.create({
        data: {
          name: nombre,
          sortOrder: orden,
          items: {
            create: base.map((it, i) => ({
              name: it.name,
              kind: it.kind,
              descriptionGeneral: it.descriptionGeneral,
              supplier: it.supplier,
              utilityPercentage: it.utilityPercentage,
              sortOrder: i,
              details: {
                create: it.details
                  .filter((d) => d.name.trim() || d.material.trim())
                  .map((d, j) => ({ name: d.name, material: d.material, sortOrder: j })),
              },
            })),
          },
        },
      });
    });
    console.log(`  ✔ guardada${existente ? " (reemplazó la anterior)" : ""}`);
    orden++;
  }
  if (!apply) console.log("\n(sin --apply no se escribió nada)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await src.$disconnect(); await dst.$disconnect(); });
