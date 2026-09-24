// Pendiente 184 — detalle de productos de las facturas que podrían estar mal
// categorizadas en los proveedores cuya regla no calzaba. Lee el PDF oficial
// del SII guardado en Invoice.pdfContent. Solo lectura. Uso:
//   npx tsx scripts/diag-184-detalle-facturas-dudosas.ts <ruta-env> <salida.json> [--muestra]
import fs from "fs";
import zlib from "zlib";
import { PrismaClient } from "@prisma/client";
const url = fs.readFileSync(process.argv[2], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const OUT = process.argv[3];
const MUESTRA = process.argv.includes("--muestra");

// Proveedor → categorías que NO se revisan (la mayoritaria, que se da por
// buena). null = se revisan todas sus facturas.
const PROVEEDORES: { rut: string; nombre: string; noRevisar: string[] | null }[] = [
  { rut: "96792430-K", nombre: "Sodimac", noRevisar: ["Materiales"] },
  { rut: "77137860-9", nombre: "Comercial K", noRevisar: null },
  { rut: "77398220-1", nombre: "MercadoLibre", noRevisar: null },
  { rut: "77270733-9", nombre: "Nicolás Cuevas", noRevisar: ["Obra"] },
  { rut: "78401710-9", nombre: "Mobeli", noRevisar: null },
  { rut: "81201000-K", nombre: "Cencosud", noRevisar: null },
  { rut: "80565900-9", nombre: "Yolito Balart", noRevisar: ["Materiales"] },
];

function pdfTexto(raw: unknown): string[] {
  if (!raw) return [];
  const buf = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw)
    : Buffer.from(Object.keys(raw as object).sort((a, b) => +a - +b).map((k) => (raw as Record<string, number>)[k]));
  const s = buf.toString("latin1");
  const out: string[] = [];
  let i = 0;
  while ((i = s.indexOf("stream", i)) !== -1) {
    let a = i + 6;
    if (s[a] === "\r") a++;
    if (s[a] === "\n") a++;
    const b = s.indexOf("endstream", a);
    if (b === -1) break;
    try {
      const txt = zlib.inflateSync(buf.subarray(a, b)).toString("latin1");
      const re = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
      let m;
      while ((m = re.exec(txt))) {
        const partes = m[1] !== undefined ? [...m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((x) => x[1]) : [m[2]];
        const t = partes.join("").replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, "$1").trim();
        if (t) out.push(t);
      }
    } catch { /* stream no comprimido */ }
    i = b + 9;
  }
  const corte = out.findIndex((t) => /MONTO NETO|Timbre Electr/i.test(t));
  return corte > 0 ? out.slice(0, corte) : out;
}

(async () => {
  try {
    console.log("host:", new URL(url).host);
    const res: unknown[] = [];
    for (const p of PROVEEDORES) {
      const invs = await prisma.invoice.findMany({
        where: {
          rutIssuer: p.rut,
          type: "recibida",
          ...(p.noRevisar ? { NOT: { category: { name: { in: p.noRevisar } } } } : {}),
        },
        orderBy: { issueDate: "desc" },
        take: MUESTRA ? 1 : undefined,
        select: {
          id: true, folioNumber: true, tipoDoc: true, issueDate: true, netAmount: true, totalAmount: true,
          createdAt: true, updatedAt: true, notes: true,
          category: { select: { name: true, parent: { select: { name: true } } } },
          project: { select: { name: true } },
          pdfContent: true,
        },
      });
      for (const i of invs) {
        const texto = pdfTexto(i.pdfContent);
        res.push({
          proveedor: p.nombre, folio: i.folioNumber, tipoDoc: i.tipoDoc, fecha: i.issueDate.toISOString().slice(0, 10),
          neto: i.netAmount, total: i.totalAmount,
          categoria: i.category ? (i.category.parent ? `${i.category.parent.name} > ` : "") + i.category.name : null,
          proyecto: i.project?.name ?? null, notas: i.notes, tienePdf: !!i.pdfContent, texto,
        });
        if (MUESTRA) console.log(`\n== ${p.nombre} ${i.folioNumber} · ${i.category?.name}\n${texto.join(" | ")}`);
      }
      console.log(`${p.nombre}: ${invs.length} facturas a revisar`);
    }
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  } finally {
    await prisma.$disconnect();
  }
})();
