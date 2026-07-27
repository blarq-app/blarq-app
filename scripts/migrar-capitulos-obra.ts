/**
 * Migración de datos: pasa los capítulos de obra de "clave de enum" a filas
 * reales de ObraChapter.
 *
 * Qué hace, por cada versión de presupuesto que tenga partidas:
 *   1. Crea UNA fila de ObraChapter por cada capítulo que HOY tiene partidas.
 *      Los capítulos vacíos NO se crean — así no aparece nada que hoy no esté.
 *   2. El nombre es el nombre FORMAL (el que salía en el PDF del cliente), para
 *      que ningún PDF ya emitido cambie. El orden es el orden de siempre.
 *   3. Deja cada ObraItem apuntando a su capítulo (chapterId).
 *   4. Copia nombre + posición del capítulo a cada EstadoPagoItem.
 *
 * Capítulos "huérfanos" (partidas cuya clave no es ninguna de las 8 oficiales,
 * ej. Portofino V6): se les crea un capítulo con el nombre derivado de la clave
 * cruda y se los ubica al final del orden conocido. Hoy esas partidas son
 * INVISIBLES en el editor y en el PDF pero suman en los totales — después de
 * esta migración se ven, y el cuadro de capítulos cuadra con el total. MJ
 * puede renombrarlas o reordenarlas desde la pantalla.
 *
 * Idempotente y SE PUEDE VOLVER A CORRER: una versión ya migrada se saltea,
 * salvo que le hayan quedado partidas SUELTAS (sin capítulo) — esas se recogen
 * usando su clave vieja. Pasa si alguien agrega partidas con el código viejo
 * después de migrar la base: entre migrar y desplegar hay una ventana.
 *
 * Uso:
 *   npx tsx scripts/migrar-capitulos-obra.ts <ruta-env>            (dry-run)
 *   npx tsx scripts/migrar-capitulos-obra.ts <ruta-env> --apply    (escribe)
 *
 * NO usa dotenv: lee DATABASE_URL del archivo que se le pasa y arma el cliente
 * con datasource directo. Si se dejara a dotenv, Prisma carga `.env` por su
 * cuenta y termina escribiendo en la base equivocada (ver CLAUDE.md §4.9).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!envPath) {
  console.error("uso: npx tsx scripts/migrar-capitulos-obra.ts <ruta-env> [--apply]");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Los 8 capítulos históricos: clave → nombre formal (el que iba al PDF) y
// posición. Es la MISMA tabla que tenía lib/utils.ts > OBRA_CHAPTERS; se copia
// acá literal para que el script no dependa de código que va a cambiar.
const HISTORICOS: Record<string, { nombre: string; orden: number }> = {
  demoliciones: { nombre: "DEMOLICIONES", orden: 1 },
  obra_gruesa: { nombre: "OBRA GRUESA", orden: 2 },
  reparaciones: { nombre: "REPARACIONES", orden: 3 },
  sanitarias: { nombre: "INSTALACIONES SANITARIAS Y GASFITERIA", orden: 4 },
  electricas: { nombre: "INSTALACIONES ELECTRICAS", orden: 5 },
  terminaciones: { nombre: "TERMINACIONES", orden: 6 },
  limpieza: { nombre: "LIMPIEZA Y ASEO", orden: 7 },
  adicionales: { nombre: "ADICIONALES", orden: 8 },
};

// Una clave que no está en la tabla histórica (data vieja de import-budget).
// El nombre sale de la clave cruda: guiones bajos a espacios, en mayúsculas.
function nombreDeClaveCruda(clave: string): string {
  return clave.replace(/_/g, " ").toUpperCase().trim();
}

function infoCapitulo(clave: string): { nombre: string; orden: number } {
  return (
    HISTORICOS[clave] ?? { nombre: nombreDeClaveCruda(clave), orden: 90 }
  );
}

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log(`=== MIGRACIÓN CAPÍTULOS DE OBRA ===`);
  console.log(`ENV: ${envPath} | HOST: ${host}`);
  console.log(`MODO: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe nada)"}\n`);

  const versiones = await prisma.budgetVersion.findMany({
    where: { obraItems: { some: {} } },
    select: {
      id: true,
      version: true,
      status: true,
      type: true,
      project: { select: { numeroProyecto: true, name: true } },
      obraChapters: { select: { id: true, name: true, sortOrder: true } },
      obraItems: {
        select: { id: true, chapter: true, chapterId: true, total: true },
      },
    },
  });

  let versionesTocadas = 0;
  let capitulosCreados = 0;
  let partidasAsignadas = 0;
  let versionesSalteadas = 0;
  const huerfanos: string[] = [];

  for (const v of versiones) {
    const etiqueta = `#${v.project.numeroProyecto} ${v.project.name} · ${v.version} (${v.status})`;

    if (v.obraChapters.length > 0) {
      // Esta versión ya se migró. Puede haber quedado alguna partida SUELTA
      // (chapterId en null): pasa si alguien agregó partidas con el código
      // viejo después de correr la migración — entre que se migra la base y
      // se despliega el código nuevo hay una ventana. Las recogemos usando su
      // clave vieja, sin tocar nada de lo ya migrado.
      const sueltas = v.obraItems.filter((i) => !i.chapterId);
      if (sueltas.length === 0) {
        versionesSalteadas++;
        console.log(`SALTEADA  ${etiqueta} — ya migrada, sin partidas sueltas`);
        continue;
      }

      console.log(`\nRECOGIENDO  ${etiqueta} — ${sueltas.length} partidas sueltas`);
      const porNombre = new Map(
        v.obraChapters.map((c) => [c.name.trim().toUpperCase(), c.id])
      );
      let proximoOrden = v.obraChapters.length;
      const porClave = new Map<string, string[]>();
      for (const it of sueltas) {
        const arr = porClave.get(it.chapter) ?? [];
        arr.push(it.id);
        porClave.set(it.chapter, arr);
      }
      for (const [clave, ids] of porClave) {
        const info = infoCapitulo(clave);
        let capId = porNombre.get(info.nombre.toUpperCase());
        console.log(
          `    ${info.nombre.padEnd(42)} ${String(ids.length).padStart(3)} partidas` +
            (capId ? "  (al capítulo que ya existía)" : "  (capítulo nuevo, al final)")
        );
        if (APPLY) {
          if (!capId) {
            const cap = await prisma.obraChapter.create({
              data: {
                budgetVersionId: v.id,
                name: info.nombre,
                sortOrder: proximoOrden++,
              },
            });
            capId = cap.id;
            porNombre.set(info.nombre.toUpperCase(), capId);
            capitulosCreados++;
          }
          await prisma.obraItem.updateMany({
            where: { id: { in: ids } },
            data: { chapterId: capId },
          });
        }
        partidasAsignadas += ids.length;
      }
      versionesTocadas++;
      continue;
    }

    // Agrupar las partidas por su clave de capítulo actual.
    const porClave = new Map<string, { ids: string[]; total: number }>();
    for (const it of v.obraItems) {
      const g = porClave.get(it.chapter) ?? { ids: [], total: 0 };
      g.ids.push(it.id);
      g.total += it.total;
      porClave.set(it.chapter, g);
    }

    // Ordenar los capítulos como se ven HOY, para que nada se mueva de lugar.
    const claves = [...porClave.keys()].sort((a, b) => {
      const ia = infoCapitulo(a).orden;
      const ib = infoCapitulo(b).orden;
      if (ia !== ib) return ia - ib;
      return infoCapitulo(a).nombre.localeCompare(infoCapitulo(b).nombre, "es");
    });

    console.log(`\n${etiqueta} — ${v.obraItems.length} partidas, ${claves.length} capítulos`);
    for (let i = 0; i < claves.length; i++) {
      const clave = claves[i];
      const info = infoCapitulo(clave);
      const g = porClave.get(clave)!;
      const marca = HISTORICOS[clave] ? " " : "!";
      if (!HISTORICOS[clave]) huerfanos.push(`${etiqueta} → "${info.nombre}"`);
      console.log(
        `  ${marca} ${String(i + 1).padStart(2)}. ${info.nombre.padEnd(42)} ${String(g.ids.length).padStart(3)} partidas  ${fmt(g.total)}`
      );

      if (APPLY) {
        const cap = await prisma.obraChapter.create({
          data: { budgetVersionId: v.id, name: info.nombre, sortOrder: i },
        });
        await prisma.obraItem.updateMany({
          where: { id: { in: g.ids } },
          data: { chapterId: cap.id },
        });
      }
      capitulosCreados++;
      partidasAsignadas += g.ids.length;
    }
    versionesTocadas++;
  }

  // ── Estados de pago: copiar nombre + posición del capítulo ──────────────
  // El EP guarda su propia foto. La posición sale del orden de la versión a la
  // que está asociado el EP; si su capítulo ya no existe ahí (partida fuera de
  // alcance), cae al final con el nombre derivado de su clave.
  console.log(`\n--- Estados de pago ---`);
  const eps = await prisma.estadoPago.findMany({
    select: {
      id: true,
      number: true,
      budgetVersionId: true,
      project: { select: { numeroProyecto: true, name: true } },
      items: { select: { id: true, chapter: true, chapterName: true } },
    },
  });

  let epItemsTocados = 0;
  for (const ep of eps) {
    // Orden real de los capítulos de la versión del EP (ya migrados arriba).
    const ordenPorNombre = new Map<string, number>();
    if (ep.budgetVersionId) {
      const caps = await prisma.obraChapter.findMany({
        where: { budgetVersionId: ep.budgetVersionId },
        select: { name: true, sortOrder: true },
      });
      for (const c of caps) ordenPorNombre.set(c.name, c.sortOrder);
    }

    const pendientes = ep.items.filter((i) => !i.chapterName);
    if (pendientes.length === 0) continue;

    console.log(
      `  #${ep.project.numeroProyecto} ${ep.project.name} · EP ${ep.number} — ${pendientes.length} partidas`
    );
    for (const it of pendientes) {
      const nombre = infoCapitulo(it.chapter).nombre;
      const orden = ordenPorNombre.get(nombre) ?? 90;
      if (APPLY) {
        await prisma.estadoPagoItem.update({
          where: { id: it.id },
          data: { chapterName: nombre, chapterOrder: orden },
        });
      }
      epItemsTocados++;
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────────
  console.log(`\n=== RESUMEN ===`);
  console.log(`  Versiones migradas:        ${versionesTocadas}`);
  console.log(`  Versiones salteadas:       ${versionesSalteadas} (ya tenían capítulos)`);
  console.log(`  Capítulos creados:         ${capitulosCreados}`);
  console.log(`  Partidas asignadas:        ${partidasAsignadas}`);
  console.log(`  Partidas de EP con foto:   ${epItemsTocados}`);
  if (huerfanos.length > 0) {
    console.log(`\n  OJO — capítulos que hoy NO se ven en el editor ni en el PDF`);
    console.log(`  (clave fuera de las 8 oficiales) y que pasan a verse:`);
    for (const h of huerfanos) console.log(`    ${h}`);
  }

  // Control final: ninguna partida puede quedar sin capítulo.
  if (APPLY) {
    const sinCapitulo = await prisma.obraItem.count({ where: { chapterId: null } });
    console.log(`\n  Partidas sin capítulo después de migrar: ${sinCapitulo}`);
    if (sinCapitulo > 0) console.log(`  >>> REVISAR: deberían ser 0.`);
  }

  if (!APPLY) console.log(`\n(dry-run — no se escribió nada. Agregá --apply para aplicar.)`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
