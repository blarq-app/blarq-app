import { prisma } from "@/lib/prisma";
import Link from "next/link";
import ReembolsadoresEditor from "@/components/configuracion/ReembolsadoresEditor";
import { Glyph } from "@/components/ui/Glyph";

export const dynamic = "force-dynamic";

export default async function ReembolsadoresPage() {
  const items = await prisma.reembolsador.findMany({
    orderBy: { nombre: "asc" },
    include: { aliases: { orderBy: { createdAt: "asc" } } },
  });

  return (
    // Sin `p-6`: el <main> del layout ya pone p-4 en mobile y p-8 en desktop.
    // El p-6 de acá se sumaba a ese, y en un celular de 375px se comía unos
    // 40px de ancho útil a cada lado del contenido.
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 -ml-1 min-h-11 md:min-h-0 py-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <Glyph name="chevron-left" size={14} />
          Configuración
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Reembolsadores</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Personas que compran a nombre de BLARQ con su tarjeta personal y
          después se les transfiere para reembolsarles. Cuando un movimiento
          bancario tiene una glosa que matchea con la{" "}
          <span className="font-medium">glosa</span>{" "}
          de un reembolsador, el modal &quot;Asignar pagos&quot; apaga el filtro de mismo
          proveedor y ordena las facturas por monto match.
        </p>
      </div>

      <ReembolsadoresEditor initial={items} />
    </div>
  );
}
