import Link from "next/link";
import { Glyph } from "@/components/ui/Glyph";

/**
 * Fila del hub de Configuración.
 *
 * Es un link de alto completo (no un texto clickeable adentro de una caja):
 * en el celular el dedo apunta mal, y un target de 64px de alto que ocupa todo
 * el ancho se acierta sin mirar. `min-h-16` es el piso — si la bajada ocupa dos
 * renglones la fila crece sola.
 *
 * El `hint` es el dato en vivo (cuántas reglas hay, cuántos reembolsadores).
 * Va a la derecha, gris y discreto: sirve para saber si vale la pena entrar,
 * no para competir con el título. Cuando es 0 se muestra igual pero apagado —
 * "el cero no ocupa espacio prominente" (docs/principles.md).
 */
export function ConfigRow({
  href,
  icon,
  title,
  description,
  hint,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 min-h-16 px-4 py-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <Glyph
        name={icon}
        size={20}
        className="text-gray-400 group-hover:text-gray-600"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">{title}</div>
        <div className="text-xs text-gray-500 leading-snug mt-0.5">
          {description}
        </div>
        {/* En el celular el dato en vivo va ABAJO, no a la derecha: al costado
            le robaba ancho a la bajada y la partía en un renglón más. */}
        {hint && (
          <div className="sm:hidden text-xs text-gray-400 tabular-nums mt-1">
            {hint}
          </div>
        )}
      </div>
      {hint && (
        <span className="hidden sm:block text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {hint}
        </span>
      )}
      <Glyph
        name="chevron-right"
        size={16}
        className="text-gray-300 group-hover:text-gray-500"
      />
    </Link>
  );
}

/** Bloque de filas con su rótulo. El rótulo va afuera de la caja, como en el resto de la app. */
export function ConfigGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[11px] font-medium uppercase tracking-widest text-gray-500 mb-2 px-1">
        {label}
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {children}
      </div>
    </section>
  );
}
