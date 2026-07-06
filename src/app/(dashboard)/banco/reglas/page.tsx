import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteRuleButton from "@/components/banco/DeleteRuleButton";
import ApplyRulesButton from "@/components/banco/ApplyRulesButton";

const CATEGORY_LABEL: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro socio",
  bono_socio: "Bono socio",
  prestamo_socio: "Préstamo socio",
  deposito_efectivo: "Depósito efectivo",
  impuestos: "Impuestos",
  compra_tarjeta: "Compra tarjeta",
  transfer_interno: "Transfer interno",
  otro_sin_factura: "Otro / sin factura",
};

export default async function ReglasPage() {
  const [rules, unassignedCount] = await Promise.all([
    prisma.bankCategorizationRule.findMany({
      orderBy: [{ hits: "desc" }, { createdAt: "desc" }],
    }),
    prisma.bankMovement.count({ where: { status: "sin_asignar" } }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
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

      <div className="bg-blue-50/40 border border-blue-100 rounded-lg p-3 mb-4 text-xs text-gray-700">
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
          <table className="w-full text-sm">
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
                    {CATEGORY_LABEL[r.category] ?? r.category}
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
        )}
      </div>
    </div>
  );
}
