/**
 * Nota que explica por qué el "gastado" de una obra y lo que salió del banco
 * NO dan lo mismo.
 *
 * La diferencia es real y a propósito — son dos reglas de medición distintas:
 *
 *   - `src/lib/projects/metrics.ts` calcula el GASTADO sumando las facturas
 *     recibidas en NETO (sin IVA, porque ese IVA se recupera como crédito
 *     fiscal en el F29) y SIN filtrar por estado de pago: una factura que
 *     llegó pero todavía no se pagó ya suma.
 *
 *   - `src/lib/dashboard/estadoResultadoCaja.ts` calcula el EGRESO DE CAJA
 *     desde los movimientos del banco: solo lo que efectivamente salió, por
 *     el monto real transferido (o sea, CON IVA).
 *
 * Los dos números son correctos; miden cosas distintas. Como conviven en la
 * misma pantalla (dashboard y resumen de proyecto), sin esta nota parecen
 * contradecirse. El texto vive acá, en un solo lugar, para que las dos
 * pantallas digan exactamente lo mismo.
 *
 * Es presentacional puro (`<details>` nativo, sin estado de React), así que
 * sirve igual en un server component y dentro de uno "use client".
 */

export function NotaGastadoVsCaja({
  contexto,
  className = "",
}: {
  /** Ajusta solo el título; la explicación es la misma en las dos pantallas. */
  contexto: "proyecto" | "eerr";
  className?: string;
}) {
  const titulo =
    contexto === "proyecto"
      ? "¿Por qué el gastado no calza con lo que salió del banco?"
      : "¿Por qué Facturación y Caja no dan lo mismo?";

  return (
    <details
      className={`group rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-gray-500 hover:text-gray-900">
        {/* Icono monocromático SVG inline — el repo no usa lucide-react */}
        <svg
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {titulo}
      </summary>

      <div className="mt-3 space-y-2 pl-5 text-[11px] leading-relaxed text-gray-500">
        <p>Son dos formas de medir, y las dos están bien:</p>

        <p>
          <span className="font-medium text-gray-900">Gastado (facturas)</span> — suma
          las facturas que te llegaron, estén pagadas o no, y las cuenta{" "}
          <span className="text-gray-700">sin IVA</span> (ese IVA lo recuperás como
          crédito en el F29, no es costo tuyo).
        </p>

        <p>
          <span className="font-medium text-gray-900">Caja (banco)</span> — suma solo la
          plata que <span className="text-gray-700">efectivamente salió</span> de la
          cuenta, <span className="text-gray-700">con IVA</span> incluido.
        </p>

        <p className="border-t border-gray-200 pt-2">
          Ejemplo: una factura de{" "}
          <span className="tabular-nums text-gray-700">$119.000</span> (
          <span className="tabular-nums">$100.000</span> + IVA) que todavía no pagaste
          suma <span className="tabular-nums text-gray-900">$100.000</span> en Gastado y{" "}
          <span className="tabular-nums text-gray-900">$0</span> en Caja. Cuando la
          pagues, pasa a ser{" "}
          <span className="tabular-nums text-gray-900">$100.000</span> en Gastado y{" "}
          <span className="tabular-nums text-gray-900">$119.000</span> en Caja.
        </p>
      </div>
    </details>
  );
}
