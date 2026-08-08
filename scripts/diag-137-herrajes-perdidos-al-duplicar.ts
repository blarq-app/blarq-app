/**
 * Pendiente 137 — partidas de HERRAJES que perdieron su listado al duplicar
 * la versión de muebles.
 *
 * El duplicador de muebles (src/app/api/presupuestos/route.ts) nunca copió ni
 * el `kind` ni las líneas MuebleHerraje. Efecto: la partida quedó como
 * kind="mueble" con 0 líneas, pero conservó el costDistributor — o sea, el
 * monto está bien y lo que falta es el listado.
 *
 * Este script BUSCA los casos y (con --aplicar) los repara: restaura
 * kind="herrajes" y clona las líneas desde la partida equivalente de la
 * versión ORIGEN (parentVersionId), emparejando por capítulo + nombre de
 * partida.
 *
 * GUARDA DE SEGURIDAD: solo repara si Σ(costNet × cantidad) de las líneas del
 * origen coincide EXACTO con el costDistributor guardado en la partida rota.
 * Si no calza, no toca nada y lo reporta — significa que el monto se editó a
 * mano después de duplicar y clonar las líneas lo movería.
 *
 * Uso (§4.9 — NO usa dotenv/config, lee el DATABASE_URL del archivo que le
 * pasás, para no leer la base equivocada):
 *   npx tsx scripts/diag-137-herrajes-perdidos-al-duplicar.ts ../../../.env.prod
 *   npx tsx scripts/diag-137-herrajes-perdidos-al-duplicar.ts ../../../.env.prod --aplicar
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const rutaEnv = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
if (!rutaEnv) {
  console.error("Falta la ruta al archivo .env (ej: ../../../.env.prod)");
  process.exit(1);
}

// Leemos el DATABASE_URL a mano del archivo indicado. Si dejáramos que Prisma
// auto-cargue `.env`, terminaríamos en la base VIEJA (ep-solitary-mud).
function leerDatabaseUrl(ruta: string): string {
  const txt = readFileSync(resolve(ruta), "utf8");
  for (const linea of txt.split("\n")) {
    const m = linea.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/);
    if (m) return m[1];
  }
  throw new Error(`No encontré DATABASE_URL en ${ruta}`);
}

const url = leerDatabaseUrl(rutaEnv);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  // ── Marcador de base viva (§4.9) ────────────────────────────────────────
  const host = url.match(/@([^/]+)\//)?.[1] ?? "?";
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Host: ${host}`);
  console.log(`Proyecto #64: ${p64?.name ?? "(no existe)"}`);
  const esViva = host.includes("ep-shy-morning") && p64?.name === "Paseo del Sena";
  console.log(esViva ? "→ BASE VIVA confirmada\n" : "→ OJO: NO parece la base viva\n");
  if (aplicar && !esViva) {
    console.error("Me niego a escribir: no confirmé que sea la base viva.");
    return;
  }

  // ── Buscar candidatos ───────────────────────────────────────────────────
  // Partidas de muebles con 0 líneas de herraje que NO son kind="herrajes",
  // en versiones que tienen versión padre (o sea, nacieron de un duplicado).
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "muebles", parentVersionId: { not: null } },
    select: {
      id: true,
      version: true,
      createdAt: true,
      parentVersionId: true,
      project: { select: { numeroProyecto: true, name: true } },
    },
  });

  type Caso = {
    proyecto: string;
    version: string;
    fecha: string;
    capitulo: string;
    partida: string;
    itemId: string;
    costGuardado: number;
    versionOrigen: string;
    lineas: {
      catalogId: string | null; sector: string; supplier: string; name: string;
      measure: string | null; finish: string | null; sku: string | null;
      quantity: number; costNet: number; sortOrder: number;
    }[];
    sumaOrigen: number;
    calza: boolean;
  };
  const casos: Caso[] = [];
  const sinOrigen: string[] = [];

  for (const v of versiones) {
    // Partidas de esta versión, con su capítulo y sus líneas.
    const items = await prisma.muebleItem.findMany({
      where: { budgetVersionId: v.id },
      include: {
        chapter: { select: { name: true } },
        herrajes: { orderBy: { sortOrder: "asc" } },
      },
    });
    // Solo miramos las que están vacías de líneas y NO marcadas como herrajes:
    // esas son las candidatas a haber perdido el listado.
    const sospechosas = items.filter(
      (i) => i.kind !== "herrajes" && i.herrajes.length === 0,
    );
    if (sospechosas.length === 0) continue;

    // Partidas de la versión ORIGEN que SÍ son herrajes itemizados.
    const origen = await prisma.muebleItem.findMany({
      where: { budgetVersionId: v.parentVersionId!, kind: "herrajes" },
      include: {
        chapter: { select: { name: true } },
        herrajes: { orderBy: { sortOrder: "asc" } },
      },
    });
    const versionOrigen = await prisma.budgetVersion.findUnique({
      where: { id: v.parentVersionId! },
      select: { version: true },
    });

    for (const s of sospechosas) {
      // Emparejamos por capítulo + nombre de partida (normalizados).
      const norm = (t: string) => t.trim().toUpperCase();
      const match = origen.find(
        (o) =>
          norm(o.chapter.name) === norm(s.chapter.name) &&
          norm(o.name) === norm(s.name),
      );
      if (!match) {
        // Si la partida sospechosa se llama HERRAJES pero no hay origen
        // itemizado, lo anotamos aparte (ej: Sena V1, anterior a la feature).
        if (norm(s.name).includes("HERRAJE")) {
          sinOrigen.push(
            `#${v.project.numeroProyecto} ${v.project.name} · ${v.version} · ` +
              `${s.chapter.name} · ${s.name} — sin partida de herrajes equivalente en ${versionOrigen?.version}`,
          );
        }
        continue;
      }
      if (match.herrajes.length === 0) continue;

      const suma = Math.round(
        match.herrajes.reduce((a, h) => a + h.costNet * h.quantity, 0),
      );
      casos.push({
        proyecto: `#${v.project.numeroProyecto} ${v.project.name}`,
        version: v.version,
        fecha: v.createdAt.toISOString().slice(0, 10),
        capitulo: s.chapter.name,
        partida: s.name,
        itemId: s.id,
        costGuardado: Math.round(s.costDistributor),
        versionOrigen: versionOrigen?.version ?? "?",
        lineas: match.herrajes.map((h) => ({
          catalogId: h.catalogId, sector: h.sector, supplier: h.supplier,
          name: h.name, measure: h.measure, finish: h.finish, sku: h.sku,
          quantity: h.quantity, costNet: h.costNet, sortOrder: h.sortOrder,
        })),
        sumaOrigen: suma,
        calza: suma === Math.round(s.costDistributor),
      });
    }
  }

  // ── Reporte ─────────────────────────────────────────────────────────────
  console.log(`Partidas de herrajes rotas por el duplicador: ${casos.length}\n`);
  for (const c of casos) {
    console.log(`${c.proyecto} · ${c.version} (${c.fecha}) · ${c.capitulo} · ${c.partida}`);
    console.log(`   origen: ${c.versionOrigen} · ${c.lineas.length} líneas`);
    console.log(
      `   monto guardado ${clp(c.costGuardado)} vs suma del origen ${clp(c.sumaOrigen)} → ${c.calza ? "CALZA" : "NO CALZA — no se toca"}`,
    );
    for (const l of c.lineas) {
      console.log(
        `      · ${l.sector ? `[${l.sector}] ` : ""}${l.name}${l.measure ? " " + l.measure : ""} · ${l.supplier} · ${l.quantity} × ${clp(l.costNet)}`,
      );
    }
    console.log("");
  }

  if (sinOrigen.length > 0) {
    console.log("Partidas llamadas HERRAJES sin origen itemizado (NO se tocan):");
    for (const s of sinOrigen) console.log(`   · ${s}`);
    console.log("");
  }

  const reparables = casos.filter((c) => c.calza);
  const bloqueadas = casos.filter((c) => !c.calza);
  if (bloqueadas.length > 0) {
    console.log(
      `PARÁ: ${bloqueadas.length} partida(s) con monto que no calza con la suma del origen. No se reparan.`,
    );
  }

  if (!aplicar) {
    console.log(
      `DRY-RUN. Reparables: ${reparables.length}. Corré con --aplicar para escribir.`,
    );
    return;
  }

  // ── Aplicar ─────────────────────────────────────────────────────────────
  for (const c of reparables) {
    await prisma.$transaction(async (tx) => {
      for (const l of c.lineas) {
        await tx.muebleHerraje.create({ data: { itemId: c.itemId, ...l } });
      }
      // El monto NO se mueve: escribimos exactamente el que ya estaba, que es
      // el mismo que la suma de las líneas (verificado arriba).
      await tx.muebleItem.update({
        where: { id: c.itemId },
        data: { kind: "herrajes", quantity: 1 },
      });
    });
    const despues = await prisma.muebleItem.findUnique({
      where: { id: c.itemId },
      select: { kind: true, costDistributor: true, clientPriceIva: true, herrajes: true },
    });
    console.log(
      `OK ${c.proyecto} · ${c.version} · ${c.partida} → kind=${despues?.kind} · ${despues?.herrajes.length} líneas · costo ${clp(despues?.costDistributor ?? 0)} · cliente c/IVA ${clp(despues?.clientPriceIva ?? 0)}`,
    );
  }
  console.log(`\nListo. Reparadas: ${reparables.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
