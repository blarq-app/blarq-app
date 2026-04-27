import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import FacturaForm from "@/components/facturas/FacturaForm";

export default async function EditFacturaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [invoice, projects, categories] = await Promise.all([
    prisma.invoice.findUnique({ where: { id } }),
    prisma.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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
          {invoice.folioNumber ? `Folio ${invoice.folioNumber}` : "Factura"}
        </h1>
        {invoice.origin === "sii_automatica" && (
          <span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
            SII
          </span>
        )}
      </div>

      <FacturaForm
        mode="edit"
        projects={projects}
        categories={categories}
        initial={{
          id: invoice.id,
          type: invoice.type as "emitida" | "recibida",
          folioNumber: invoice.folioNumber ?? "",
          rutIssuer: invoice.rutIssuer ?? "",
          businessName: invoice.businessName ?? "",
          issueDate: invoice.issueDate.toISOString().split("T")[0],
          dueDate: invoice.dueDate?.toISOString().split("T")[0] ?? "",
          netAmount: invoice.netAmount,
          status: invoice.status as "pendiente" | "pagada" | "anulada",
          projectId: invoice.projectId ?? "",
          categoryId: invoice.categoryId ?? "",
          notes: invoice.notes ?? "",
        }}
      />
    </div>
  );
}
