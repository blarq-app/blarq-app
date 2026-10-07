import type { PrismaClient } from "@prisma/client";
import { armarRendiciones, type DatosRendiciones, type Rendiciones } from "./rendiciones";

// Lectura de la base para las rendiciones de los socios (ver rendiciones.ts).
// SOLO LEE. La usan la pantalla Contabilidad → Rendiciones y el endpoint que
// baja el Excel / PDF.
//
// Trae las SALIDAS del período que tienen algo conciliado; cuáles son
// reembolsos a un socio lo decide el armado (por RUT, igual que la cartola).
// Período: un mes (`month` 1..12) o el año completo (`month` null), en UTC
// como el resto de Contabilidad.
export async function cargarDatosRendiciones(
  db: PrismaClient,
  year: number,
  month: number | null
): Promise<DatosRendiciones> {
  const inicio = new Date(Date.UTC(year, month == null ? 0 : month - 1, 1));
  const finExclusivo = new Date(Date.UTC(month == null ? year + 1 : year, month == null ? 0 : month, 1));

  const [movs, empleados] = await Promise.all([
    db.bankMovement.findMany({
      where: { date: { gte: inicio, lt: finExclusivo }, amount: { lt: 0 }, payments: { some: {} } },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        counterpartyRut: true,
        counterpartyName: true,
        notes: true,
        netZeroAmount: true,
        bankAccount: { select: { alias: true } },
        payments: {
          select: {
            amountApplied: true,
            invoice: {
              select: {
                id: true,
                type: true,
                tipoDoc: true,
                folioNumber: true,
                rutIssuer: true,
                businessName: true,
                totalAmount: true,
                origin: true,
                issueDate: true,
                project: { select: { name: true } },
                category: { select: { name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
    db.empleado.findMany({ select: { rut: true, nombre: true } }),
  ]);

  const documentos = new Map<string, DatosRendiciones["documentos"][number]>();
  for (const m of movs) {
    for (const p of m.payments) {
      const i = p.invoice;
      documentos.set(i.id, {
        id: i.id,
        type: i.type,
        tipoDoc: i.tipoDoc,
        folioNumber: i.folioNumber,
        rutIssuer: i.rutIssuer,
        businessName: i.businessName,
        totalAmount: i.totalAmount,
        origin: i.origin,
        issueDate: i.issueDate,
        obra: i.project?.name ?? null,
        // "Materiales" o "Gastos generales / Auto": el mismo rótulo que Facturas.
        categoria: i.category
          ? i.category.parent
            ? `${i.category.parent.name} / ${i.category.name}`
            : i.category.name
          : null,
      });
    }
  }

  return {
    year,
    month,
    movimientos: movs.map((m) => ({
      id: m.id,
      date: m.date,
      cuenta: m.bankAccount.alias,
      description: m.description,
      amount: m.amount,
      counterpartyRut: m.counterpartyRut,
      counterpartyName: m.counterpartyName,
      notes: m.notes,
      netZeroAmount: m.netZeroAmount,
      pagos: m.payments.map((p) => ({ invoiceId: p.invoice.id, amountApplied: p.amountApplied })),
    })),
    documentos: [...documentos.values()],
    empleados,
  };
}

export async function cargarRendiciones(
  db: PrismaClient,
  year: number,
  month: number | null
): Promise<Rendiciones> {
  return armarRendiciones(await cargarDatosRendiciones(db, year, month));
}
