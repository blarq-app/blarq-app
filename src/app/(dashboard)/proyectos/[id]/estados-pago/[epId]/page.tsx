import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditorEP from "@/components/estadosPago/EditorEP";

export default async function EPDetailPage({
  params,
}: {
  params: Promise<{ id: string; epId: string }>;
}) {
  const { id: projectId, epId } = await params;

  const ep = await prisma.estadoPago.findUnique({
    where: { id: epId },
    include: {
      project: { include: { maestro: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!ep || ep.projectId !== projectId) notFound();

  // EPs previos del proyecto para calcular acumulado ya pagado por partida
  const prevEps = await prisma.estadoPago.findMany({
    where: { projectId, number: { lt: ep.number } },
    include: { items: true },
  });
  const prevPaidAccum: Record<string, number> = {};
  prevEps.forEach((p) =>
    p.items.forEach((i) => {
      prevPaidAccum[i.obraItemId] =
        Math.max(prevPaidAccum[i.obraItemId] || 0, i.pctAccumulated);
    })
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/proyectos/${projectId}`}
          className="text-gray-400 hover:text-gray-600"
        >
          {ep.project.name}
        </Link>
        <span className="text-gray-300">/</span>
        <Link
          href={`/proyectos/${projectId}/estados-pago`}
          className="text-gray-400 hover:text-gray-600"
        >
          Estados de Pago
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">EP #{ep.number}</h1>
      </div>

      <EditorEP
        ep={JSON.parse(JSON.stringify(ep))}
        prevPaidAccum={prevPaidAccum}
      />
    </div>
  );
}
