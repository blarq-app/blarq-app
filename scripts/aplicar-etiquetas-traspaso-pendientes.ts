// Reintenta las etiquetas de traspaso que quedaron "esperando" aunque el
// movimiento ya esté en la app.
//
// Por qué existe: la etiqueta se aplica sola en dos momentos —cuando MJ manda
// el comprobante (si el traspaso ya está) y cuando se importa la cartola (si
// todavía no estaba)—. Si en el primer momento el traspaso no se encontró por
// algo que después se corrigió, queda esperando un import que ya pasó y nadie
// la vuelve a mirar. Caso real: el bot buscaba con una ventana de ±1 día y el
// banco había asentado el traspaso 3 días después del comprobante.
//
// Dry-run por default: sin --aplicar solo muestra qué haría.
//
// Uso: npx tsx scripts/aplicar-etiquetas-traspaso-pendientes.ts <env> [--aplicar]
import { readFileSync } from "fs";

const envPath = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
if (!envPath) {
  console.error("Uso: npx tsx scripts/aplicar-etiquetas-traspaso-pendientes.ts <env> [--aplicar]");
  process.exit(1);
}
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
  ?.trim();
if (!url) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
process.env.DATABASE_URL = url;
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const fecha = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  console.log(`=== HOST: ${host} | modo: ${aplicar ? "APLICAR" : "dry-run"} ===\n`);
  const { prisma } = await import("@/lib/prisma");
  const { buscarTraspasosPorFechaMonto, aplicarEtiquetaACandidato } = await import(
    "@/lib/banco/pendingTransferTags"
  );

  const tags = await prisma.pendingTransferTag.findMany({
    where: { status: "esperando" },
    include: { project: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Etiquetas esperando: ${tags.length}\n`);

  let aplicadas = 0;
  for (const tag of tags) {
    const cab = `${fecha(tag.transferDate)} · ${clp(tag.amount)} · ${tag.project.name} · ${tag.concepto}`;
    const candidatos = await buscarTraspasosPorFechaMonto(tag.transferDate, tag.amount);

    if (candidatos.length === 0) {
      console.log(`  ESPERA  ${cab} — el traspaso todavía no está en la app`);
      continue;
    }
    if (candidatos.length > 1) {
      console.log(`  AMBIGUO ${cab} — ${candidatos.length} traspasos calzan, lo tiene que resolver MJ`);
      for (const c of candidatos) {
        console.log(`            · ${fecha(c.date)} ${clp(c.amount)} ${c.cuenta}`);
      }
      continue;
    }

    const c = candidatos[0];
    const dias = Math.round(
      (c.date.getTime() - tag.transferDate.getTime()) / (24 * 3600 * 1000)
    );
    const desfase = dias === 0 ? "mismo día" : `${Math.abs(dias)} día(s) ${dias > 0 ? "después" : "antes"}`;
    const yaTiene = c.projectId || c.internalConcepto
      ? ` (ya tenía ${c.projectName ?? "obra"}${c.internalConcepto ? ` / ${c.internalConcepto}` : ""} — no se pisa)`
      : "";

    if (!aplicar) {
      console.log(`  APLICA  ${cab} → movimiento del ${fecha(c.date)} (${desfase})${yaTiene}`);
      continue;
    }

    const r = await aplicarEtiquetaACandidato(tag.id, c);
    console.log(
      `  HECHO   ${cab} → movimiento del ${fecha(c.date)} (${desfase}) · obra=${r.setProject ? "puesta" : "ya estaba"} · concepto=${r.setConcepto ? "puesto" : "ya estaba"}`
    );
    aplicadas++;
  }

  if (!aplicar) {
    console.log("\n(dry-run — no se escribió nada. Agregá --aplicar para hacerlo)");
  } else {
    console.log(`\nEtiquetas aplicadas: ${aplicadas}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
