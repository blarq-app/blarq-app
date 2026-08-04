import Link from "next/link";
import AuditoriaPreciosClient from "@/components/configuracion/AuditoriaPreciosClient";
import { Glyph } from "@/components/ui/Glyph";

export const dynamic = "force-dynamic";

export default function AuditoriaPreciosPage() {
  return (
    // Sin `p-6`: el <main> del layout ya pone su padding. Ver nota en la
    // pantalla de Reembolsadores.
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 -ml-1 min-h-11 md:min-h-0 py-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <Glyph name="chevron-left" size={14} />
          Configuración
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Auditoría de precios</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Presupuestos en <span className="font-medium">borrador</span>{" "}
          cuyos componentes tienen precio distinto al catálogo de materiales actual.
          Solo se listan presupuestos NO entregados — los que están en estado
          enviado / aprobado / rechazado quedan congelados como histórico.
          Componentes que vos editaste manualmente (marca{" "}
          <span className="font-medium">personalizado</span>) no aparecen acá,
          aunque tengan otro precio.
        </p>
      </div>

      <AuditoriaPreciosClient />
    </div>
  );
}
