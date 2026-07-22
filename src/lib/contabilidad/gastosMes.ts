import type { PrismaClient } from "@prisma/client";
import type { GastoPDFItem } from "@/lib/pdf/GastosMesPDF.html";

// Armado de la lista de gastos de un mes para el respaldo del F22.
//
// Vive acá y no dentro del endpoint para que la consulta sea UNA sola: la usa
// el PDF mensual y la puede usar cualquier script de verificación. El filtro
// es idéntico al de la pantalla /contabilidad/gastos (mismo where, mismos
// límites de mes) — si los dos no dan el mismo total, hay un bug.

// Normaliza un nombre para comparar la contraparte del banco contra el emisor
// del gasto (sin acentos, sin puntuación, en mayúsculas).
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// "Quién pagó" es la contraparte del movimiento bancario que cubrió el gasto:
// si le transferiste a una persona (Daniel, MJ, JT), esa persona puso la plata
// y se la estás devolviendo. Si el cargo salió directo de la cuenta al
// comercio — o sea, la contraparte del banco ES el mismo comercio del gasto —
// entonces pagó BLARQ.
export function quienPago(
  emisor: string | null,
  contraparte: string | null | undefined
): string {
  if (!contraparte) return "BLARQ";
  const a = norm(contraparte);
  const b = emisor ? norm(emisor) : "";
  if (!b) return "BLARQ";
  if (a === b || a.includes(b) || b.includes(a)) return "BLARQ";
  return contraparte;
}

// Prefijos de folio que genera la app al registrar un gasto desde el banco.
// Ese número es interno (viene del movimiento), no es el número impreso en la
// boleta, así que en el respaldo no se muestra.
const FOLIO_INTERNO = /^(BOL|INT)-/;

export async function listarGastosDelMes(
  db: PrismaClient,
  year: number,
  month: number // 0-11
): Promise<GastoPDFItem[]> {
  const inicio = new Date(year, month, 1);
  const finExclusivo = new Date(year, month + 1, 1);

  const gastos = await db.invoice.findMany({
    where: {
      type: "recibida",
      origin: { in: ["gasto_boleta", "gasto_internacional"] },
      issueDate: { gte: inicio, lt: finExclusivo },
    },
    // Del más viejo al más nuevo: el respaldo se lee como un diario del mes
    // (la pantalla los muestra al revés, del más nuevo primero).
    orderBy: { issueDate: "asc" },
    select: {
      issueDate: true,
      businessName: true,
      totalAmount: true,
      origin: true,
      folioNumber: true,
      attachmentUrl: true,
      payments: {
        select: { bankMovement: { select: { counterpartyName: true } } },
      },
    },
  });

  return gastos.map((g, i) => ({
    orden: i + 1,
    fecha: g.issueDate,
    tipo: g.origin === "gasto_boleta" ? "boleta" : "internacional",
    numeroDoc:
      g.folioNumber && !FOLIO_INTERNO.test(g.folioNumber) ? g.folioNumber : null,
    comercio: g.businessName,
    quienPago: quienPago(
      g.businessName,
      g.payments[0]?.bankMovement?.counterpartyName
    ),
    monto: g.totalAmount,
    foto: g.attachmentUrl,
  }));
}
