import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FacturaForm from "@/components/facturas/FacturaForm";

export default async function NuevaFacturaPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; type?: string }>;
}) {
  const sp = await searchParams;

  const [projects, categories] = await Promise.all([
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

  const today = new Date().toISOString().split("T")[0];

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
        <h1 className="text-2xl font-bold text-gray-900">Nueva factura</h1>
      </div>

      <FacturaForm
        mode="create"
        projects={projects}
        categories={categories}
        initial={{
          type: sp.type === "emitida" ? "emitida" : "recibida",
          folioNumber: "",
          rutIssuer: "",
          businessName: "",
          issueDate: today,
          dueDate: "",
          netAmount: 0,
          status: "pendiente",
          projectId: sp.projectId ?? "",
          categoryId: "",
          notes: "",
        }}
      />
    </div>
  );
}
