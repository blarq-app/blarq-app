import Link from "next/link";
import { Glyph } from "@/components/ui/Glyph";
import CondicionesEditor from "@/components/presupuesto/CondicionesEditor";
import { getPlantillaCondiciones } from "@/lib/presupuesto/condicionesPlantilla";

export const dynamic = "force-dynamic";

/**
 * Condiciones estándar por tipo de cotización.
 *
 * Antes este texto vivía hardcodeado en las tres plantillas de PDF: cambiar
 * una coma exigía una sesión de programación. Acá se edita y queda listo para
 * todas las cotizaciones NUEVAS. Las ya creadas no se tocan — cada una guarda
 * las condiciones que se le mandaron a ese cliente.
 */
export default async function CondicionesEstandarPage() {
  const [obra, muebles, artefactos] = await Promise.all([
    getPlantillaCondiciones("obra"),
    getPlantillaCondiciones("muebles"),
    getPlantillaCondiciones("artefactos"),
  ]);

  const bloques = [
    { tipo: "obra" as const, titulo: "Obra", items: obra },
    { tipo: "muebles" as const, titulo: "Muebles", items: muebles },
    { tipo: "artefactos" as const, titulo: "Artefactos", items: artefactos },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 -ml-1 min-h-11 md:min-h-0 py-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <Glyph name="chevron-left" size={14} />
          Configuración
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">
          Condiciones estándar
        </h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          El texto con el que arranca cada cotización nueva, y que sale impreso
          en el PDF del cliente bajo &quot;Observaciones generales&quot;. Cada
          tipo tiene su lista porque dicen cosas distintas. Lo que cambies acá
          no modifica ninguna cotización ya creada: dentro de cada una se editan
          por separado.
        </p>
      </div>

      <div className="space-y-6">
        {bloques.map((b) => (
          <section
            key={b.tipo}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-3">
              {b.titulo}
            </div>
            <CondicionesEditor
              modo="plantilla"
              tipo={b.tipo}
              inicial={b.items}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
