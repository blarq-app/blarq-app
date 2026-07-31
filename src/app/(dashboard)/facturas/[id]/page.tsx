import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import FacturaForm from "@/components/facturas/FacturaForm";
import CompensacionNC from "@/components/facturas/CompensacionNC";
import RemovePaymentButton from "@/components/facturas/RemovePaymentButton";
import DesgloseCobro from "@/components/facturas/DesgloseCobro";
import { formatCLP } from "@/lib/utils";

const DTE_LABEL: Record<number, string> = {
  33: "Factura",
  34: "Factura exenta",
  39: "Boleta",
  41: "Boleta exenta",
  56: "Nota de débito",
  61: "Nota de crédito",
};

export default async function EditFacturaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;

  // `from` es la URL de la lista con el filtro que MJ tenía puesto al abrir
  // esta factura (ej. /facturas?q=brune, o la pestaña Facturas de un
  // proyecto). El botón "Volver" y el breadcrumb la usan para devolverla a
  // donde estaba. Solo aceptamos rutas internas a /facturas o /proyectos
  // para no abrir un redirect a sitios externos.
  const { from } = await searchParams;
  const returnTo =
    from && (from.startsWith("/facturas") || from.startsWith("/proyectos"))
      ? from
      : "/facturas";

  const [invoice, projects, categories, payments] = await Promise.all([
    // Carga todos los campos del Invoice — incluye `pdfContent` (Bytes
    // ~170KB) pero el page no lo pasa al client, solo lo accede el endpoint
    // /api/facturas/[id]/pdf. El overhead server-only es aceptable.
    // Se incluye la categoría (nombre) para resolver el concepto del cobro
    // (obra/muebles/artefactos) y decidir si mostramos el desglose de artefactos.
    prisma.invoice.findUnique({
      where: { id },
      include: { category: { select: { name: true } } },
    }),
    prisma.project.findMany({
      // Solo proyectos asignables al conciliar: se esconden las cotizaciones
      // no ganadas (status="cotizacion"). Los centros internos (BLARQ) se
      // mantienen siempre, aunque no sean obras numeradas.
      where: { NOT: { status: "cotizacion", isInternal: false } },
      orderBy: [{ numeroProyecto: "asc" }, { numeroCotizacion: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        numeroProyecto: true,
        numeroCotizacion: true,
      },
    }),
    prisma.costCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parent: { select: { id: true, name: true } },
      },
    }),
    // Pagos imputados a esta factura — vienen de conciliacion bancaria.
    // Cada uno apunta a un BankMovement. Se renderizan en el historial.
    prisma.invoicePayment.findMany({
      where: { invoiceId: id },
      orderBy: { createdAt: "desc" },
      include: {
        bankMovement: {
          select: {
            id: true,
            date: true,
            amount: true,
            description: true,
            counterpartyName: true,
            bankAccount: { select: { alias: true } },
          },
        },
      },
    }),
  ]);

  if (!invoice) notFound();

  // Desglose del cobro: para CUALQUIER factura EMITIDA. Antes se mostraba solo
  // cuando el concepto era "artefactos", porque lo único que se podía repartir
  // eran sus tres sub-categorías. Ahora también sirve para la factura
  // COMBINADA — la clienta que pide un solo documento por obra + muebles +
  // artefactos (Portofino) — así que se ofrece siempre en las emitidas.
  // Sin desglose cargado, el Cuadro Resumen se comporta igual que antes.
  const mostrarDesgloseCobro = invoice.type === "emitida";

  // Para NC (61) / ND (56): facturas candidatas a referenciar.
  // Mismo type + mismo rutIssuer (SII recibidas) o rutReceiver (emitidas)
  // que sean factura/exenta (tipoDoc 33 o 34).
  const isNCorND = invoice.tipoDoc === 61 || invoice.tipoDoc === 56;
  const referenceCandidates = isNCorND
    ? await prisma.invoice.findMany({
        where: {
          type: invoice.type,
          tipoDoc: { in: [33, 34] },
          ...(invoice.type === "recibida"
            ? { rutIssuer: invoice.rutIssuer ?? undefined }
            : { rutReceiver: invoice.rutReceiver ?? undefined }),
          NOT: { id: invoice.id },
        },
        orderBy: { issueDate: "desc" },
        select: {
          id: true,
          folioNumber: true,
          tipoDoc: true,
          totalAmount: true,
          businessName: true,
          issueDate: true,
          status: true,
        },
        take: 50,
      })
    : [];

  // Para el panel de compensación de una NC: solo ofrecer facturas que
  // todavía tienen saldo (pendiente / parcial). Una NC se aplica a una
  // factura que aún debe plata; ofrecer las ya pagadas o anuladas confunde
  // (no son conciliables). El dropdown de "factura referenciada" del form,
  // en cambio, usa la lista completa (la referencia del SII puede apuntar a
  // una factura ya pagada).
  const compensableCandidates = referenceCandidates.filter(
    (c) => c.status === "pendiente" || c.status === "parcial"
  );

  // Para NCs (tipoDoc=61): si ya está compensada, traer datos de la
  // factura cubierta (caso DP) o del mov bancario (caso reembolso a cuenta)
  // para mostrar el link.
  const isNC = invoice.tipoDoc === 61;
  const appliedToInvoice =
    isNC && invoice.appliedToInvoiceId
      ? await prisma.invoice.findUnique({
          where: { id: invoice.appliedToInvoiceId },
          select: { id: true, folioNumber: true, totalAmount: true },
        })
      : null;
  const refundMov =
    isNC && invoice.refundBankMovementId
      ? await prisma.bankMovement.findUnique({
          where: { id: invoice.refundBankMovementId },
          select: {
            id: true,
            date: true,
            amount: true,
            bankAccount: { select: { alias: true } },
          },
        })
      : null;

  // Dirección inversa: NCs que aplicaron su crédito A esta factura (esta
  // factura RECIBIÓ el crédito). Se muestran como marca/bloque propio, aparte
  // del estado — bajan el saldo a pagar pero no convierten la factura en
  // "anulada". Solo aplica a facturas normales (una NC no recibe crédito de
  // otra NC).
  const ncsRecibidas = !isNC
    ? await prisma.invoice.findMany({
        where: {
          compensationType: "other_invoice",
          appliedToInvoiceId: invoice.id,
        },
        orderBy: { issueDate: "desc" },
        select: { id: true, folioNumber: true, totalAmount: true },
      })
    : [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={returnTo}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          Facturas
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">
          {DTE_LABEL[invoice.tipoDoc ?? 33] ?? "Factura"}
          {invoice.folioNumber ? ` ${invoice.folioNumber}` : ""}
        </h1>
        {invoice.origin === "sii_automatica" && (
          <span className="text-[10px] uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
            SII
          </span>
        )}
        <a
          href={`/api/facturas/${invoice.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={`ml-auto text-sm border px-3 py-1.5 rounded-lg ${
            invoice.siiCodigo
              ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
              : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
          title={
            invoice.siiCodigo
              ? "PDF oficial del SII (representación impresa del DTE)"
              : "PDF resumen interno (los oficiales se bajan vía sync local)"
          }
        >
          ↓ {invoice.siiCodigo ? "PDF oficial" : "PDF"}
        </a>
      </div>

      {isNC && (
        <CompensacionNC
          invoiceId={invoice.id}
          ncType={invoice.type as "emitida" | "recibida"}
          ncTotal={Math.abs(invoice.totalAmount)}
          initialCompensationType={invoice.compensationType}
          initialAppliedTo={appliedToInvoice}
          initialRefundMov={
            refundMov
              ? {
                  id: refundMov.id,
                  date: refundMov.date.toISOString(),
                  amount: refundMov.amount,
                  bankAccountAlias: refundMov.bankAccount?.alias ?? "",
                }
              : null
          }
          candidates={compensableCandidates.map((c) => ({
            ...c,
            issueDate: c.issueDate.toISOString(),
          }))}
        />
      )}

      {/* Historial de pagos — solo facturas que no son NC (las NC tienen
          su propio bloque de compensacion arriba). Si hay pagos imputados,
          se listan con monto, mov bancario y link. Tambien se muestra el
          total imputado vs total factura, con alerta si pasa del total. */}
      {!isNC && payments.length > 0 && (() => {
        const totalImputado = payments.reduce((s, p) => s + p.amountApplied, 0);
        const totalFactura = Math.abs(invoice.totalAmount);
        // ±$10 de tolerancia (redondeos IVA), igual que el resto del banco.
        const sobreSaldo = totalImputado - totalFactura > 10;
        const formatCLP = (n: number) =>
          "$" + Math.round(n).toLocaleString("es-CL");
        const formatDate = (d: Date) =>
          `${String(d.getUTCDate()).padStart(2, "0")}/${String(
            d.getUTCMonth() + 1
          ).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`;
        return (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Historial de pagos
              </h2>
              <div className="text-xs text-gray-600 tabular-nums">
                Imputado:{" "}
                <span
                  className={
                    sobreSaldo
                      ? "text-rose-700 font-semibold"
                      : "text-gray-900 font-medium"
                  }
                >
                  {formatCLP(totalImputado)}
                </span>
                <span className="text-gray-400"> / {formatCLP(totalFactura)}</span>
              </div>
            </div>
            {sobreSaldo && (
              <div className="mb-3 text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded px-3 py-2">
                ⚠ Esta factura tiene{" "}
                <span className="font-medium">
                  {formatCLP(totalImputado - totalFactura)}
                </span>{" "}
                imputados de más respecto a su monto total. Revisá las
                imputaciones bancarias.
              </div>
            )}
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 pr-3">Fecha</th>
                  <th className="text-left py-2 pr-3">Cuenta</th>
                  <th className="text-left py-2 pr-3">Detalle</th>
                  <th className="text-right py-2 pr-3">Monto</th>
                  <th className="py-2 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                      {formatDate(p.bankMovement.date)}
                    </td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                      {p.bankMovement.bankAccount?.alias ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 truncate max-w-[420px]">
                      {p.bankMovement.description}
                      {p.bankMovement.counterpartyName && (
                        <span className="text-gray-400">
                          {" · "}
                          {p.bankMovement.counterpartyName}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900">
                      {formatCLP(p.amountApplied)}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center gap-3 justify-end">
                        <Link
                          href={`/banco/movimientos?status=all&id=${p.bankMovement.id}`}
                          className="text-xs text-gray-500 hover:text-gray-900 underline"
                          title="Ver en /banco/movimientos"
                        >
                          ver
                        </Link>
                        <RemovePaymentButton
                          invoiceId={invoice.id}
                          paymentId={p.id}
                          amount={p.amountApplied}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Notas de crédito aplicadas a esta factura (la factura recibió el
          crédito). Marca propia, independiente del estado. */}
      {!isNC && ncsRecibidas.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-1">
            Notas de crédito aplicadas
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Estas NC aplicaron su crédito a esta factura. Bajan el saldo a pagar;
            no cambian el estado de la factura.
          </p>
          <ul className="divide-y divide-gray-100">
            {ncsRecibidas.map((nc) => (
              <li
                key={nc.id}
                className="text-xs flex items-center justify-between gap-3 py-2"
              >
                <Link
                  href={`/facturas/${nc.id}?from=${encodeURIComponent(returnTo)}`}
                  className="text-rose-700 hover:text-rose-900 hover:underline"
                >
                  ↳ NC F-{nc.folioNumber}
                </Link>
                <span className="tabular-nums text-gray-700">
                  {formatCLP(Math.abs(nc.totalAmount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mostrarDesgloseCobro && (
        <DesgloseCobro
          invoiceId={invoice.id}
          totalAmount={Math.abs(invoice.totalAmount)}
          initial={{
            montoObra: invoice.montoObra,
            montoMuebles: invoice.montoMuebles,
            artefactoCocina: invoice.artefactoCocina,
            artefactoSanitario: invoice.artefactoSanitario,
            artefactoIluminacion: invoice.artefactoIluminacion,
          }}
        />
      )}

      <FacturaForm
        mode="edit"
        returnTo={returnTo}
        projects={projects}
        categories={categories}
        tipoDoc={invoice.tipoDoc ?? null}
        referenceCandidates={referenceCandidates.map((c) => ({
          ...c,
          issueDate: c.issueDate.toISOString().split("T")[0],
        }))}
        initial={{
          id: invoice.id,
          type: invoice.type as "emitida" | "recibida",
          folioNumber: invoice.folioNumber ?? "",
          rutIssuer: invoice.rutIssuer ?? "",
          businessName: invoice.businessName ?? "",
          issueDate: invoice.issueDate.toISOString().split("T")[0],
          dueDate: invoice.dueDate?.toISOString().split("T")[0] ?? "",
          netAmount: invoice.netAmount,
          status: invoice.status as "pendiente" | "parcial" | "pagada" | "anulada",
          projectId: invoice.projectId ?? "",
          categoryId: invoice.categoryId ?? "",
          notes: invoice.notes ?? "",
          referenceFolioNumber: invoice.referenceFolioNumber ?? "",
          referenceTipoDoc: invoice.referenceTipoDoc ?? null,
        }}
      />
    </div>
  );
}
