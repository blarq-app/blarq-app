import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import FacturaForm from "@/components/facturas/FacturaForm";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [invoice, projects, categories] = await Promise.all([
    prisma.invoice.findUnique({ where: { id } }),
    prisma.project.findMany({
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
  ]);

  if (!invoice) notFound();

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
        },
        take: 50,
      })
    : [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/facturas"
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
          className="ml-auto text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          title="Genera un PDF interno con los datos de esta factura"
        >
          ↓ PDF
        </a>
      </div>

      <FacturaForm
        mode="edit"
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
