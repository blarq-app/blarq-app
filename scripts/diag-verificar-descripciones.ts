/**
 * ¿El link de cada producto apunta REALMENTE a ese producto? SOLO LECTURA.
 *
 * Pedido de MJ (2026-08-03), después de encontrar que le habían puesto un
 * mezclador de 1 vía donde el suyo es de 2: "revisá bien que todas las
 * descripciones coincidan".
 *
 * Para cada producto con link se lee el NOMBRE REAL del producto en la tienda y
 * se compara con lo que dice el catálogo — usando el `detail` cuando existe,
 * que es la descripción completa, y no solo el nombre corto. Ahí estaba el
 * error: el nombre decía "MEZCLADOR STELLAR BRUSHED" y el detalle aclaraba
 * "tina, empotrado, 2 vías".
 *
 * Lo que se compara, por peso:
 *   - MEDIDAS y cantidades (25, 30, 700, "2 vías"): si difieren, es otro producto.
 *   - TIPO (mezclador, plato, toallero…) y si es de tina o de ducha.
 *   - COLOR / terminación (cromo, brushed nickel, gun grey…).
 *   - LÍNEA (Atlas, Luxor, Stellar…).
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Rasgos que, si están declarados en los dos lados y difieren, significan que
// son productos distintos.
function rasgos(s: string) {
  const t = norm(s);
  return {
    medidas: new Set((t.match(/\b\d{2,4}\b/g) ?? [])),
    vias: (t.match(/(\d)\s*vias?/) ?? [])[1] ?? null,
    tina: /\btina\b/.test(t),
    ducha: /\bducha\b/.test(t),
    // Los colores se agrupan por familia: "cromo", "cromado" y "cromada" son el
    // mismo acabado escrito distinto, y marcarlos como diferencia llenaba el
    // informe de falsos positivos.
    colores: new Set(
      (
        [
          [/crom[oa]d?[oa]?/, "cromo"],
          [/brushed|nickel/, "brushed"],
          [/gun\s*grey|gungrey/, "gun grey"],
          [/dorad[oa]|laton|oro/, "dorado"],
          [/bronce|bronze|antique/, "bronce"],
          [/negro|black|mate/, "negro"],
          [/blanc[oa]|white/, "blanco"],
          [/zinc|grafito/, "grafito"],
          [/oak|moon|vison|natural/, "madera"],
        ] as Array<[RegExp, string]>
      ).filter(([re]) => re.test(t)).map(([, nombre]) => nombre)
    ),
    lineas: new Set(
      ["atlas", "luxor", "urban", "delfos", "albany", "queen", "trend", "stellar",
       "asis", "home", "niza", "brizo", "atenas", "aura", "micenas", "trani",
       "ares", "astoria", "eta", "lota", "amantia", "keops", "soft", "moai",
       "trento", "level", "style"].filter((l) => new RegExp(`\\b${l}\\b`).test(t))
    ),
  };
}

async function nombreEnLaTienda(link: string): Promise<string | null> {
  try {
    const u = new URL(link);
    const slug = u.pathname.replace(/\/+$/, "").replace(/\/p$/i, "").split("/").filter(Boolean).pop();
    if (!slug) return null;
    if (/mk\.cl|ledstudio\.cl/.test(u.hostname)) {
      const api = `https://www.${u.hostname.replace(/^www\./, "")}/api/catalog_system/pub/products/search/${slug}/p`;
      const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (res.status !== 200 && res.status !== 206) return null;
      const d = (await res.json()) as Array<Record<string, unknown>>;
      return Array.isArray(d) && d[0] ? String(d[0]["productName"] ?? "") : null;
    }
    if (/kitchenhouse\.cl/.test(u.hostname)) {
      const m = u.pathname.match(/\/products\/([^/]+)/i);
      if (!m) return null;
      const res = await fetch(`${u.protocol}//${u.host}/products/${m[1]}.js`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const d = (await res.json()) as Record<string, unknown>;
      return String(d["title"] ?? "");
    }
    return null;
  } catch { return null; }
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { not: null } },
    select: { name: true, detail: true, referenceLink: true },
    orderBy: { name: "asc" },
  });
  console.log(`\nVerificando ${cats.length} productos con link…\n`);

  const chocan: string[] = [];
  const noSePudo: string[] = [];
  let ok = 0;

  for (const c of cats) {
    // MK deja de responder si se le pega muy seguido: la primera corrida dio 27
    // "no se pudo leer" que en realidad eran rate limiting, incluidos productos
    // que se habían leído bien minutos antes. Con una pausa corta y un
    // reintento, quedan solo los links de verdad caídos.
    let real = await nombreEnLaTienda(c.referenceLink!);
    if (!real) {
      await new Promise((r) => setTimeout(r, 1500));
      real = await nombreEnLaTienda(c.referenceLink!);
    }
    await new Promise((r) => setTimeout(r, 350));
    if (!real) { noSePudo.push(c.name); continue; }
    // El detalle es la descripción completa; el nombre corto solo o mezclado
    // pierde datos como "2 vías" o "tina".
    const mio = `${c.name} ${c.detail ?? ""}`;
    const a = rasgos(mio);
    const b = rasgos(real);

    const problemas: string[] = [];
    if (a.vias && b.vias && a.vias !== b.vias) problemas.push(`vías: tuyo ${a.vias}, la tienda ${b.vias}`);
    if (a.tina && !b.tina && b.ducha) problemas.push("el tuyo es de TINA y el de la tienda de DUCHA");
    if (a.ducha && !b.ducha && b.tina) problemas.push("el tuyo es de DUCHA y el de la tienda de TINA");
    const medidasA = [...a.medidas].filter((m) => m.length <= 3);
    const medidasB = [...b.medidas].filter((m) => m.length <= 3);
    if (medidasA.length && medidasB.length && !medidasA.some((m) => medidasB.includes(m)))
      problemas.push(`medidas: tuyo ${medidasA.join("/")}, la tienda ${medidasB.join("/")}`);
    const colA = [...a.colores], colB = [...b.colores];
    if (colA.length && colB.length && !colA.some((x) => colB.includes(x)))
      problemas.push(`color: tuyo ${colA.join("/")}, la tienda ${colB.join("/")}`);
    const linA = [...a.lineas], linB = [...b.lineas];
    if (linA.length && linB.length && !linA.some((x) => linB.includes(x)))
      problemas.push(`línea: tuyo ${linA.join("/")}, la tienda ${linB.join("/")}`);

    if (problemas.length) {
      chocan.push(`${c.name}\n      tu detalle:  ${c.detail || "(vacío)"}\n      en la tienda: ${real}\n      → ${problemas.join(" · ")}\n      ${c.referenceLink}`);
    } else ok++;
  }

  console.log("═══ EL LINK APUNTA A OTRO PRODUCTO ═══\n");
  if (!chocan.length) console.log("  (ninguno)");
  for (const l of chocan) console.log(`  · ${l}\n`);

  if (noSePudo.length) {
    console.log(`\n═══ NO SE PUDO LEER (${noSePudo.length}) — link caído o tienda sin API ═══`);
    for (const n of noSePudo) console.log(`  · ${n}`);
  }

  console.log(`\n\nRESUMEN: ${ok} coinciden · ${chocan.length} apuntan a otro producto · ${noSePudo.length} sin poder verificar`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
