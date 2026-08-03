/**
 * Lista de trabajo: los productos del catálogo que necesitan que MJ les ponga
 * link. SOLO LECTURA.
 *
 * Deja afuera los que tienen el link caído — esos NO necesitan que nadie haga
 * nada: la app guarda su última lectura y los reintenta sola cuando MK los
 * repone (ver el informe de la auditoría).
 *
 * Para cada uno: el precio guardado, en qué cotizaciones se usa (para saber si
 * urge) y el candidato de mk.cl si aparece alguno.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function buscar(texto: string) {
  const api = `https://www.mk.cl/api/catalog_system/pub/products/search?ft=${encodeURIComponent(texto)}&_from=0&_to=3`;
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (res.status !== 200 && res.status !== 206) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];
    return data.flatMap((p) => {
      const co = ((p["items"] as Array<Record<string, unknown>> | undefined)?.[0]?.["sellers"] as Array<Record<string, unknown>> | undefined)?.[0]?.["commertialOffer"] as Record<string, unknown> | undefined;
      if (!co) return [];
      return [{
        nombre: String(p["productName"] ?? ""),
        link: `https://www.mk.cl/${String(p["linkText"] ?? "")}/p`,
        lista: Math.round(Number(co["ListPrice"]) || 0),
        venta: Math.round(Number(co["Price"]) || 0),
      }];
    });
  } catch { return []; }
}

function terminos(nombre: string): string {
  return nombre.toLowerCase().replace(/[^\wáéíóúñ\s]/gi, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !["con", "sin", "para", "del", "los", "las"].includes(w))
    .slice(0, 5).join(" ");
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: null },
    select: { id: true, name: true, listPrice: true, discountPercent: true, subcategory: true },
    orderBy: { name: "asc" },
  });

  console.log(`\nProductos SIN link: ${cats.length}\n`);
  console.log("Los que tienen el link caído NO están acá: esos vuelven solos.");
  console.log("Van primero los que SE USAN en alguna cotización.\n");

  // Los que están en una cotización primero: son los únicos que afectan un
  // precio hoy.
  const conUso: Array<{ c: (typeof cats)[number]; usos: number }> = [];
  for (const c of cats) {
    conUso.push({ c, usos: await prisma.artefactoItem.count({ where: { catalogId: c.id } }) });
  }
  conUso.sort((a, b) => b.usos - a.usos);

  for (const { c } of conUso) {
    const usos = await prisma.artefactoItem.findMany({
      where: { catalogId: c.id },
      select: {
        quantity: true,
        budgetVersion: {
          select: { version: true, status: true, project: { select: { name: true } } },
        },
      },
    });
    const donde = usos.length
      ? usos.map((u) => `${u.budgetVersion?.project?.name} ${u.budgetVersion?.version} [${u.budgetVersion?.status}] x${u.quantity}`).join(" · ")
      : "no se usa en ninguna cotización";

    console.log(`── ${c.name}`);
    console.log(`   ${c.subcategory} · precio guardado ${CLP(c.listPrice)}${(c.discountPercent ?? 0) > 0 ? ` · ${Math.round((c.discountPercent ?? 0) * 100)}% dcto` : ""}`);
    console.log(`   se usa en: ${donde}`);
    const cands = await buscar(terminos(c.name));
    if (cands.length === 0) {
      console.log("   no aparece en mk.cl — puede ser de otra tienda\n");
      continue;
    }
    for (const cand of cands) {
      const calza = c.listPrice > 0 && (Math.abs(cand.venta - c.listPrice) <= 2 || Math.abs(cand.lista - c.listPrice) <= 2);
      console.log(`     ${calza ? "→" : " ·"} ${cand.nombre.slice(0, 60)}`);
      console.log(`       ${CLP(cand.lista)} lista · ${CLP(cand.venta)} venta${calza ? "   ← el precio calza con el guardado" : ""}`);
      console.log(`       ${cand.link}`);
    }
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
