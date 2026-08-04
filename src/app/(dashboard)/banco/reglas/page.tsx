import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteRuleButton from "@/components/banco/DeleteRuleButton";
import ApplyRulesButton from "@/components/banco/ApplyRulesButton";
// Las etiquetas salen de la lista única (src/lib/banco/categorias.ts). Antes
// esta pantalla tenía su propia copia, con dos etiquetas distintas de las de la
// tabla del banco para las MISMAS categorías ("Préstamo socio" vs "Préstamos
// socios", "Otro / sin factura" vs "Otro"). Ahora dicen lo mismo en los dos
// lados.
import { ETIQUETA_CATEGORIA } from "@/lib/banco/categorias";

export default async function ReglasPage() {
  const [rules, unassignedCount] = await Promise.all([
    prisma.bankCategorizationRule.findMany({
      orderBy: [{ hits: "desc" }, { createdAt: "desc" }],
    }),
    prisma.bankMovement.count({ where: { status: "sin_asignar" } }),
  ]);

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <Link href="/banco" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a cuentas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Reglas de categorización</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rules.length} regla{rules.length !== 1 ? "s" : ""} guardada
            {rules.length !== 1 ? "s" : ""}
          </p>
        </div>
        {rules.length > 0 && <ApplyRulesButton unassignedCount={unassignedCount} />}
      </div>

      {/* Gris, no celeste: docs/principles.md deja el color solo para los
          semánticos (rojo excedido, verde confirmado, ámbar atención) y el
          resto de los avisos de la app ya usan este mismo gris neutro. */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-xs text-gray-700">
        Cada vez que categorizás un movimiento manualmente (sueldo, Previred, etc.), se
        guarda una regla automática. Las cartolas siguientes aplican esa regla a los movimientos
        con descripción similar — sin que tengas que hacer nada.
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {rules.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">Aún no hay reglas guardadas.</p>
            <p className="text-xs text-gray-400 mt-1">
              Categorizá movimientos en{" "}
              <Link href="/banco/movimientos?status=sin_asignar" className="underline">
                /banco/movimientos
              </Link>{" "}
              y se irán creando solas.
            </p>
          </div>
        ) : (
          <>
          {/* Celular: una tarjeta por regla. La tabla mide ~500px y se cortaba
              justo en "Aplicada", que es el dato que dice si la regla sirve. */}
          <div className="sm:hidden divide-y divide-gray-100">
            {rules.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-gray-900 break-all">
                    {r.descriptionPattern}
                  </p>
                  <p className="text-sm text-gray-700 mt-1">
                    {ETIQUETA_CATEGORIA[r.category] ?? r.category}
                  </p>
                  <p className="text-[11px] text-gray-500 tabular-nums mt-1">
                    aplicada {r.hits}× · creada{" "}
                    {new Date(r.createdAt).toLocaleDateString("es-CL", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}
                  </p>
                </div>
                <div className="shrink-0 -mr-1">
                  <DeleteRuleButton ruleId={r.id} />
                </div>
              </div>
            ))}
          </div>

          <table className="hidden sm:table w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2">Patrón (descripción contiene)</th>
                <th className="text-left px-4 py-2 w-40">Categoría</th>
                <th className="text-right px-4 py-2 w-24">Aplicada</th>
                <th className="text-left px-4 py-2 w-32">Creada</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">
                    {r.descriptionPattern}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {ETIQUETA_CATEGORIA[r.category] ?? r.category}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                    {r.hits}× {r.hits === 0 && <span className="text-gray-300">·</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 tabular-nums">
                    {new Date(r.createdAt).toLocaleDateString("es-CL", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DeleteRuleButton ruleId={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
    </div>
  );
}
