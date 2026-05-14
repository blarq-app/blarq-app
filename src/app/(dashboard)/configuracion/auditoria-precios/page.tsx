import AuditoriaPreciosClient from "@/components/configuracion/AuditoriaPreciosClient";

export const dynamic = "force-dynamic";

export default function AuditoriaPreciosPage() {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Auditoría de precios</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Presupuestos en <span className="font-medium">borrador</span> cuyos
          componentes tienen precio distinto al catálogo de materiales actual.
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
