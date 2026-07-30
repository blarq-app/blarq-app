/**
 * Compara la obra V6 que YA está en la base viva contra lo parseado del Excel
 * V7. Sirve para saber exactamente qué cambia si V7 pasa a mandar: partidas
 * nuevas, partidas que se van, y diferencias de costo o de mano de obra.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const JSON_V7 =
  "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad/portofino-v7-partidas.json";

const url = readFileSync(ENV_PROD, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("HOST:", host);
  const v6 = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V6" },
    include: { obraItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!v6) throw new Error("no hay V6");

  const v7 = JSON.parse(readFileSync(JSON_V7, "utf8"));
  const partidasV7 = v7.partidas.filter((p: any) => p.tipo !== "subcapitulo");

  // Clave de emparejamiento: nombre + unidad (el itemNumber se repite en V6).
  const key = (n: string, u: string) => `${n.trim().toUpperCase()}|${u.trim().toUpperCase()}`;
  const mapV6 = new Map<string, any[]>();
  for (const i of v6.obraItems) {
    if (i.quantity === 0 && i.total === 0) continue; // encabezados COCINA/BAÑOS
    const k = key(i.name, i.unit);
    if (!mapV6.has(k)) mapV6.set(k, []);
    mapV6.get(k)!.push(i);
  }

  console.log("\n=== PARTIDAS V7 vs V6 ===");
  console.log("item | nombre | cant | costo V7 | costo V6 | Δcosto | MO V7 (unit) | MO V6 (unit) | ΔMO");
  const usadas = new Set<any>();
  let nuevas = 0,
    cambioCosto = 0,
    cambioMO = 0;
  for (const p of partidasV7) {
    if (p.noCobrado) continue;
    const cands = (mapV6.get(key(p.nombre, p.unidad)) ?? []).filter((c) => !usadas.has(c));
    const m = cands[0];
    if (m) usadas.add(m);
    const dCosto = m ? p.totalCosto - m.total : null;
    const dMO = m ? p.puMO - (m.costLabor ?? 0) : null;
    if (!m) nuevas++;
    if (dCosto !== null && Math.abs(dCosto) > 1) cambioCosto++;
    if (dMO !== null && Math.abs(dMO) > 1) cambioMO++;
    if (!m || (dCosto !== null && Math.abs(dCosto) > 1) || (dMO !== null && Math.abs(dMO) > 1)) {
      console.log(
        [
          p.item,
          p.nombre,
          p.cantidad,
          clp(p.totalCosto),
          m ? clp(m.total) : "— NUEVA",
          dCosto === null ? "—" : clp(dCosto),
          clp(p.puMO),
          m ? clp(m.costLabor ?? 0) : "—",
          dMO === null ? "—" : clp(dMO),
        ].join(" | ")
      );
    }
  }
  const sobrantes = v6.obraItems.filter(
    (i) => !usadas.has(i) && !(i.quantity === 0 && i.total === 0)
  );
  console.log("\nEn V6 y NO en V7:", sobrantes.length);
  for (const s of sobrantes) console.log("  ", s.itemNumber, s.name, clp(s.total));
  console.log(
    `\nresumen: ${nuevas} nuevas · ${cambioCosto} con costo distinto · ${cambioMO} con MO distinta · ${partidasV7.filter((p: any) => p.noCobrado).length} rojos nuevos`
  );

  const cdV6 = v6.obraItems.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0);
  const moV6 = v6.obraItems.reduce((s, i) => s + (i.costLabor ?? 0) * i.quantity, 0);
  console.log(`\nCD  V6=${clp(cdV6)}  V7=${clp(v7.control.costoDirecto)}  Δ=${clp(v7.control.costoDirecto - cdV6)}`);
  console.log(`MO  V6=${clp(moV6)}  V7=${clp(v7.control.moTotal)}  Δ=${clp(v7.control.moTotal - moV6)}`);
  console.log(
    `Total c/IVA  V6=${clp(cdV6 * 1.27 * 1.19)}  V7=${clp(v7.control.totalConIva)}  Δ=${clp(v7.control.totalConIva - cdV6 * 1.27 * 1.19)}`
  );
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
