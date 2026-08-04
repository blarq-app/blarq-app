import { ConfigGroup, ConfigRow } from "@/components/configuracion/ConfigRow";

/**
 * Cuerpo del hub de Configuración.
 *
 * Está separado de la página a propósito: la página va a la base a buscar los
 * contadores, y esto es solo el dibujo. Así se puede renderizar con números
 * inventados para sacar capturas / revisar el diseño sin necesitar la base
 * conectada.
 */
export default function ConfiguracionHub({
  nombreUsuario,
  reembolsadores,
  reglasFacturas,
  reglasBanco,
}: {
  nombreUsuario?: string;
  reembolsadores: number;
  reglasFacturas: number;
  reglasBanco: number;
}) {
  function contador(n: number, singular: string, plural: string) {
    return `${n} ${n === 1 ? singular : plural}`;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Tu cuenta y las reglas que hacen que la app clasifique sola.
        </p>
      </header>

      <div className="space-y-6">
        <ConfigGroup label="Cuenta">
          <ConfigRow
            href="/cuenta"
            icon="cuenta"
            title="Mi cuenta"
            description="Nombre, email y cambiar la contraseña."
            hint={nombreUsuario}
          />
        </ConfigGroup>

        <ConfigGroup label="Clasificación automática">
          <ConfigRow
            href="/facturas/reglas"
            icon="reglas"
            title="Reglas por proveedor"
            description="Qué categoría y centro de costo se le pone sola a cada factura del SII según quién la emite."
            hint={contador(reglasFacturas, "regla", "reglas")}
          />
          <ConfigRow
            href="/banco/reglas"
            icon="banco"
            title="Reglas del banco"
            description="Cómo se categorizan los movimientos de la cartola según su glosa."
            hint={contador(reglasBanco, "regla", "reglas")}
          />
          <ConfigRow
            href="/configuracion/reembolsadores"
            icon="reembolsadores"
            title="Reembolsadores"
            description="Personas que compran con su tarjeta y después se les transfiere."
            hint={contador(reembolsadores, "persona", "personas")}
          />
        </ConfigGroup>

        <ConfigGroup label="Mantención de datos">
          <ConfigRow
            href="/configuracion/auditoria-precios"
            icon="auditoria"
            title="Auditoría de precios"
            description="Presupuestos en borrador con precios distintos al catálogo de materiales."
          />
        </ConfigGroup>
      </div>
    </div>
  );
}
