import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  proposeMovementInvoiceMatch,
  applyAutoMatchPayment,
  getInvoicePaidAmount,
  loadReembolsadores,
  loadCandidateInvoices,
} from "@/lib/banco/invoicePayments";
import { requireSession } from "@/lib/apiAuth";

// /api/banco/auto-conciliar-pendientes
//
// Los dos tiempos del gesto "Conciliar pendientes":
//
//   GET  → PROPONE. Corre el motor sobre todos los movimientos pendientes y
//          devuelve lo que ataría, sin escribir NADA en la base.
//   POST → APLICA. Recibe los pares (movimiento, factura) que MJ dejó
//          tildados y concilia solo esos.
//
// Antes esto era un solo POST que aplicaba todo de una y después ofrecía
// deshacer uno por uno. Se dio vuelta a pedido de MJ (26-07-2026) por dos
// razones: (a) es la misma regla conservadora del resto de la app —ante la
// duda no se ata solo—, y (b) las candidatas "probables" (monto calza, RUT
// no) antes quedaban pendientes en silencio y MJ nunca se enteraba de que
// existían. Ahora se las muestra rotuladas, con el motivo de la duda, y ella
// decide.
//
// Deshacer no se perdió: sigue en Resolver ▾ → Desasignar, en la fila y en
// lote. El motor de match tampoco cambió — se le pide la opinión sin que
// escriba (proposeMovementInvoiceMatch comparte núcleo con el auto-match).

// Una propuesta lista para pintar en pantalla.
interface Propuesta {
  movementId: string;
  movDate: string; // ISO
  movAmount: number;
  movDescription: string;
  counterpartyName: string | null;
  bankAccountAlias: string;
  invoiceId: string;
  folioNumber: string | null;
  businessName: string | null;
  // Fecha de emisión de la factura. Ya la teníamos a mano (es la misma que usa
  // el motor para decir "está a N días del pago"), pero no se mostraba: MJ
  // podía cruzar la propuesta solo por monto. Con las dos fechas en la fila
  // —emisión arriba, movimiento abajo— el cruce es doble.
  invoiceDate: string | null; // ISO
  invoiceTotal: number;
  invoiceRemaining: number;
  projectName: string | null;
  confianza: "segura" | "probable";
  motivo: string;
  hermanas: number;
}

// ─────────────────────────────────────────────────────────────────────────
// GET — propone (solo lectura)
// ─────────────────────────────────────────────────────────────────────────
export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  // Movimientos que entran a la corrida: pendientes de verdad (sin
  // imputaciones). Mismo universo que tenía el endpoint viejo.
  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      description: true,
      counterpartyRut: true,
      counterpartyName: true,
      date: true,
      category: true,
      payments: { select: { id: true } },
      bankAccount: { select: { alias: true } },
    },
    orderBy: { date: "desc" },
  });

  // Precargamos UNA sola vez reembolsadores y facturas candidatas: con 200+
  // movimientos, consultarlos por movimiento era el cuello de botella real
  // del endpoint viejo (~2 min). El match filtra en memoria.
  const reembolsadores = await loadReembolsadores();
  const candidateInvoices = await loadCandidateInvoices();

  // Una factura no puede quedar propuesta para dos movimientos distintos: la
  // lista en memoria no ve las propuestas que vamos armando, así que las
  // reservamos a mano a medida que avanzamos.
  const reservadas = new Set<string>();

  const propuestas: Propuesta[] = [];
  const sinPropuesta: { motivo: string }[] = [];

  for (const mov of movs) {
    const p = await proposeMovementInvoiceMatch(mov, reembolsadores, {
      invoices: candidateInvoices,
      excludeInvoiceIds: reservadas,
    });

    if (p.confianza === "ninguna" || !p.invoiceId) {
      sinPropuesta.push({ motivo: p.motivo });
      continue;
    }

    reservadas.add(p.invoiceId);
    const inv = candidateInvoices.find((c) => c.id === p.invoiceId);
    const pagado = inv ? inv.payments.reduce((s, x) => s + x.amountApplied, 0) : 0;

    propuestas.push({
      movementId: mov.id,
      movDate: mov.date.toISOString(),
      movAmount: mov.amount,
      movDescription: mov.description,
      counterpartyName: mov.counterpartyName,
      bankAccountAlias: mov.bankAccount.alias,
      invoiceId: p.invoiceId,
      // Folio, nombre y obra se completan abajo en UNA query: el loader
      // compartido (loadCandidateInvoices) no los trae y no lo tocamos, porque
      // también lo usa el camino que escribe.
      folioNumber: null,
      businessName: inv?.businessName ?? null,
      invoiceDate: inv ? new Date(inv.issueDate).toISOString() : null,
      invoiceTotal: inv?.totalAmount ?? 0,
      invoiceRemaining: inv ? inv.totalAmount - pagado : 0,
      projectName: null,
      confianza: p.confianza,
      motivo: p.motivo,
      hermanas: p.hermanas,
    });
  }

  // Folio + obra de cada factura propuesta — para que MJ vea qué factura es y
  // a qué obra va sin tener que abrirla.
  if (propuestas.length > 0) {
    const detalle = await prisma.invoice.findMany({
      where: { id: { in: propuestas.map((p) => p.invoiceId) } },
      select: {
        id: true,
        folioNumber: true,
        project: { select: { name: true } },
      },
    });
    const porId = new Map(detalle.map((i) => [i.id, i]));
    for (const p of propuestas) {
      const d = porId.get(p.invoiceId);
      p.folioNumber = d?.folioNumber ?? null;
      p.projectName = d?.project?.name ?? null;
    }
  }

  // Las seguras primero: son las que vienen tildadas por default.
  propuestas.sort((a, b) => {
    if (a.confianza !== b.confianza) return a.confianza === "segura" ? -1 : 1;
    return b.movDate.localeCompare(a.movDate);
  });

  return NextResponse.json({
    revisados: movs.length,
    seguras: propuestas.filter((p) => p.confianza === "segura").length,
    probables: propuestas.filter((p) => p.confianza === "probable").length,
    sinPropuesta: sinPropuesta.length,
    propuestas,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST — aplica los pares tildados
// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as {
    pares?: { movementId?: unknown; invoiceId?: unknown }[];
  } | null;
  const pares = body?.pares;
  if (!Array.isArray(pares) || pares.length === 0) {
    return NextResponse.json(
      { error: "Falta la lista de pares a conciliar" },
      { status: 400 }
    );
  }

  let conciliados = 0;
  const rechazados: { movementId: string; motivo: string }[] = [];

  for (const raw of pares) {
    const movementId = typeof raw?.movementId === "string" ? raw.movementId : null;
    const invoiceId = typeof raw?.invoiceId === "string" ? raw.invoiceId : null;
    if (!movementId || !invoiceId) {
      rechazados.push({ movementId: movementId ?? "?", motivo: "Par inválido" });
      continue;
    }

    // Re-validamos contra la base ANTES de escribir. Entre que se armó la
    // propuesta y que MJ confirmó pudo pasar cualquier cosa (otra sesión
    // conciliando, un sync del SII, la propia cartola importándose). Es plata:
    // preferimos rechazar el par y decirlo, antes que imputar sobre algo que
    // ya cambió.
    const mov = await prisma.bankMovement.findUnique({
      where: { id: movementId },
      select: {
        id: true,
        amount: true,
        status: true,
        category: true,
        description: true,
        payments: { select: { id: true } },
      },
    });
    if (!mov) {
      rechazados.push({ movementId, motivo: "El movimiento ya no existe" });
      continue;
    }
    if (mov.status === "interno") {
      rechazados.push({ movementId, motivo: "Quedó marcado como transferencia interna" });
      continue;
    }
    if (mov.payments.length > 0) {
      rechazados.push({ movementId, motivo: "Ya tiene una factura imputada" });
      continue;
    }

    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, totalAmount: true, folioNumber: true },
    });
    if (!inv) {
      rechazados.push({ movementId, motivo: "La factura ya no existe" });
      continue;
    }

    // El saldo tiene que seguir alcanzando (misma tolerancia ±$10 del motor).
    const pagado = await getInvoicePaidAmount(invoiceId);
    const saldo = inv.totalAmount - pagado;
    const absAmount = Math.abs(mov.amount);
    if (saldo < absAmount - 10) {
      rechazados.push({
        movementId,
        motivo: `La factura F-${inv.folioNumber ?? "?"} ya no tiene saldo suficiente`,
      });
      continue;
    }

    await applyAutoMatchPayment(mov, invoiceId);
    conciliados++;
  }

  return NextResponse.json({ conciliados, rechazados });
}
