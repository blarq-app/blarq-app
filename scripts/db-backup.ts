// Backup completo de la BD de BLARQ a un archivo JSON.gz local.
//
// Recorre todas las tablas del schema Prisma y serializa los rows a JSON. Los
// campos Bytes (Invoice.pdfContent) se codifican base64. El output queda en
// `backups/blarq-<env>-<YYYY-MM-DD-HHMM>.json.gz`.
//
// Uso:
//   npx tsx scripts/db-backup.ts                            # backup de la BD que apunta DATABASE_URL del .env
//   DATABASE_URL="<url-prod>" npx tsx scripts/db-backup.ts  # backup de prod (override)
//
// Restore (cuando haga falta):
//   npx tsx scripts/db-restore.ts backups/blarq-prod-2026-05-04-1632.json.gz
//   (script de restore se arma cuando MJ lo necesite — el JSON es legible y
//    importable a mano via Prisma si urge)
//
// Recomendación: correr 1 vez por mes y subir el .json.gz a Google Drive /
// 1Password vault. Es paranoia extra encima del PITR automático de Neon
// (7 días en plan free, 30 en plan paid).

import "dotenv/config";
import { gzipSync } from "zlib";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";

// Las "tablas" a backupear (en camelCase como las expone Prisma client).
// Mantener sincronizado con `grep '^model ' prisma/schema.prisma`.
const MODELS = [
  "user",
  "project",
  "maestro",
  "estadoPago",
  "estadoPagoItem",
  "budgetVersion",
  "obraItem",
  "muebleChapter",
  "muebleItem",
  "muebleQuote",
  "muebleDetail",
  "artefactoItem",
  "paymentTerm",
  "partidaCatalog",
  "partidaComponent",
  "materialCatalog",
  "materialPriceOffer",
  "materialPriceHistory",
  "shoppingItem",
  "costCategory",
  "invoice",
  "invoiceCategorizationRule",
  "bankCategorizationRule",
  "invoicePayment",
  "bankAccount",
  "bankMovement",
] as const;

function inferEnv(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (/ep-shy-morning/.test(url)) return "prod";
  if (/ep-solitary-mud/.test(url)) return "dev";
  return "unknown";
}

function bytesReplacer(_key: string, value: unknown): unknown {
  // Buffers de Bytes (pdfContent) → base64 con marcador __bytes__.
  if (value instanceof Buffer) {
    return { __bytes__: value.toString("base64") };
  }
  // Uint8Array (cuando Prisma devuelve Bytes en algunos drivers) → idem
  if (value instanceof Uint8Array && !(value instanceof Buffer)) {
    return { __bytes__: Buffer.from(value).toString("base64") };
  }
  // BigInt no es JSON-serializable nativo
  if (typeof value === "bigint") return { __bigint__: value.toString() };
  return value;
}

async function main() {
  const env = inferEnv();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const dir = join(process.cwd(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `blarq-${env}-${ts}.json.gz`;
  const fullPath = join(dir, filename);

  console.log(`Backup BLARQ — entorno=${env}, archivo=${filename}`);
  // No imprimir el DATABASE_URL: contiene la contraseña antes del '@'.
  // Solo el host (ver ADR 2026-05-29-credenciales-en-console-logs).
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—";
  console.log(`(BD host: ${host})\n`);

  const data: Record<string, unknown[]> = {};
  let totalRows = 0;

  for (const model of MODELS) {
    try {
      const rows = await (prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[model].findMany();
      data[model] = rows;
      totalRows += rows.length;
      console.log(`  ${model.padEnd(30)} ${String(rows.length).padStart(6)} rows`);
    } catch (e) {
      console.warn(`  ${model.padEnd(30)} ⚠️  error: ${(e as Error).message}`);
    }
  }

  const json = JSON.stringify(
    {
      meta: {
        env,
        generatedAt: new Date().toISOString(),
        databaseUrlHash: hashStr(process.env.DATABASE_URL ?? ""),
        totalRows,
        models: MODELS,
      },
      data,
    },
    bytesReplacer
  );

  console.log(`\nComprimiendo (${(json.length / 1024 / 1024).toFixed(1)} MB JSON crudo)…`);
  const gz = gzipSync(Buffer.from(json, "utf8"));
  writeFileSync(fullPath, gz);
  console.log(`✅ Backup escrito: ${fullPath} (${(gz.length / 1024 / 1024).toFixed(1)} MB comprimido, ${totalRows} rows totales)`);
  console.log(`\nSubilo a Google Drive / 1Password vault para que sobreviva si tu mac se rompe.`);

  await prisma.$disconnect();
}

/** Hash chiquito del URL para identificar la BD sin exponer credenciales. */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
