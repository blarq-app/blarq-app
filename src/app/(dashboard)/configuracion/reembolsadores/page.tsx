import { prisma } from "@/lib/prisma";
import ReembolsadoresEditor from "@/components/configuracion/ReembolsadoresEditor";

export const dynamic = "force-dynamic";

export default async function ReembolsadoresPage() {
  const items = await prisma.reembolsador.findMany({
    orderBy: { nombre: "asc" },
    include: { aliases: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reembolsadores</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Personas que compran a nombre de BLARQ con su tarjeta personal y
          después se les transfiere para reembolsarles. Cuando un movimiento
          bancario tiene una glosa que matchea con la <span className="font-medium">glosa</span> de un
          reembolsador, el modal &quot;Asignar pagos&quot; apaga el filtro de mismo
          proveedor y ordena las facturas por monto match.
        </p>
      </div>

      <ReembolsadoresEditor initial={items} />
    </div>
  );
}
