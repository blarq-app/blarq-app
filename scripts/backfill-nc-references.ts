// Backfill de referenceFolioNumber + referenceTipoDoc para todas las NCs
// recibidas (tipoDoc=61) que están en BD sin referencia.
//
// Para cada NC:
//   1. Calcular el período (YYYYMM) desde issueDate
//   2. Listar el RCV del período (getRcvDetalle) → encontrar la NC por folio
//      y RUT emisor → tomar dhdrCodigo + detCodigo
//   3. Llamar getDteReferencias → obtener dataReferencias[0]
//   4. UPDATE Invoice con referenceFolioNumber + referenceTipoDoc
//
// Si la NC no aparece en el RCV del SII, se reporta y se deja como está.
// Si la NC aparece pero no tiene referencias en el SII, también se reporta.
//
// Modo dry-run por default. Pasar --apply para ejecutar.
//
// Uso: npx tsx scripts/backfill-nc-references.ts [--apply] [--month=YYYYMM]
//   --month=YYYYMM solo procesa NCs de ese mes (acelera testing).

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getRcvDetalle, getDteReferencias } from "../src/lib/sii/siiRcv";

const APPLY = process.argv.includes("--apply");
const monthArg = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];

const BLARQ = { rut: 77270733, dv: "9" };

interface NcRow {
  id: string;
  folioNumber: string | null;
  rutIssuer: string | null;
  issueDate: Date;
  businessName: string | null;
  totalAmount: number;
}

function periodOfDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeRut(rut: string): { rut: number; dv: string } {
  const clean = rut.replace(/[.\s]/g, "").toUpperCase();
  const m = clean.match(/^(\d+)-([\dK])$/);
  if (!m) throw new Error(`RUT inválido: ${rut}`);
  return { rut: parseInt(m[1], 10), dv: m[2] };
}

async function main() {
  console.log(APPLY ? "🚀 APPLY mode" : "🔍 DRY RUN — no se escriben cambios\n");

  const where: { tipoDoc: number; type: string; referenceFolioNumber: null; issueDate?: { gte: Date; lt: Date } } = {
    tipoDoc: 61,
    type: "recibida",
    referenceFolioNumber: null,
  };
  if (monthArg) {
    const year = parseInt(monthArg.slice(0, 4), 10);
    const month = parseInt(monthArg.slice(4, 6), 10);
    where.issueDate = {
      gte: new Date(year, month - 1, 1),
      lt: new Date(year, month, 1),
    };
  }

  const ncs = (await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      folioNumber: true,
      rutIssuer: true,
      issueDate: true,
      businessName: true,
      totalAmount: true,
    },
    orderBy: { issueDate: "desc" },
  })) as NcRow[];

  console.log(`Encontradas ${ncs.length} NCs sin referencia${monthArg ? ` en período ${monthArg}` : ""}`);
  if (ncs.length === 0) return;

  // Cachear el RCV detalle por (período, "61") para no llamarlo por cada NC.
  const rcvCache = new Map<string, Awaited<ReturnType<typeof getRcvDetalle>>>();

  let resolved = 0;
  let notFoundInRcv = 0;
  let noRefs = 0;
  let errors = 0;

  for (const nc of ncs) {
    if (!nc.folioNumber || !nc.rutIssuer) {
      console.log(`  ⊘ NC ${nc.id} sin folio/rutIssuer, skip`);
      continue;
    }
    const periodo = periodOfDate(nc.issueDate);
    const tag = `NC ${nc.folioNumber} de ${nc.businessName} (${nc.rutIssuer}) ${periodo}`;

    try {
      // 1. Cargar RCV del mes si no está cacheado
      let rcv = rcvCache.get(periodo);
      if (!rcv) {
        rcv = await getRcvDetalle(BLARQ, periodo, "61", "COMPRA");
        rcvCache.set(periodo, rcv);
      }

      // 2. Encontrar nuestra NC en el RCV
      const issuerNorm = normalizeRut(nc.rutIssuer);
      const folioNum = parseInt(nc.folioNumber, 10);
      const rcvNc = rcv.find(
        (r) => r.detRutDoc === issuerNorm.rut && r.detNroDoc === folioNum
      );
      if (!rcvNc) {
        console.log(`  ✗ ${tag} — no aparece en RCV del SII`);
        notFoundInRcv++;
        continue;
      }

      // 3. Pedir referencias
      const det = await getDteReferencias(BLARQ, {
        rcvPcarga: parseInt(periodo, 10),
        rutDoc: rcvNc.detRutDoc,
        dvDoc: rcvNc.detDvDoc,
        dcvNroDoc: rcvNc.detNroDoc,
        codTipoDoc: "61",
        dhdrCodigo: rcvNc.dhdrCodigo,
        detCodigo: rcvNc.detCodigo,
      });

      if (det.dataReferencias.length === 0) {
        console.log(`  ⊘ ${tag} — sin referencias en SII (probable nota de débito o caso especial)`);
        noRefs++;
        continue;
      }

      // 4. Tomar la primera referencia (típicamente única)
      const ref = det.dataReferencias[0];
      console.log(
        `  ✓ ${tag} → ref: F-${ref.dhdrFolio} tipo ${ref.dtdcCodigo} ($${ref.dhdrMntTotal.toLocaleString()})`
      );

      if (APPLY) {
        await prisma.invoice.update({
          where: { id: nc.id },
          data: {
            referenceFolioNumber: String(ref.dhdrFolio),
            referenceTipoDoc: ref.dtdcCodigo,
          },
        });
      }
      resolved++;
    } catch (e) {
      console.log(`  ⚠ ${tag} — error: ${(e as Error).message}`);
      errors++;
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Total NCs procesadas: ${ncs.length}`);
  console.log(`  ✓ Resueltas con referencia: ${resolved}`);
  console.log(`  ✗ No estaban en RCV del SII:  ${notFoundInRcv}`);
  console.log(`  ⊘ Sin referencias en SII:    ${noRefs}`);
  console.log(`  ⚠ Errores:                    ${errors}`);
  if (!APPLY && resolved > 0) {
    console.log("\nRe-correr con --apply para escribir cambios.");
  }
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
