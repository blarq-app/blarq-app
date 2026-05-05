import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import MovementActionButton from "@/components/banco/MovementActionButton";
import MovementsSearch from "@/components/banco/MovementsSearch";
import MatchHintButton from "@/components/banco/MatchHintButton";
import MarkInternalButton from "@/components/banco/MarkInternalButton";
import MovementsAdvancedFilters from "@/components/banco/MovementsAdvancedFilters";

type SearchParams = {
  accountId?: string;
  status?: string;
  q?: string;
  showInternal?: string;
  // Filtros avanzados (panel expandible) — todos opcionales.
  rut?: string;
  name?: string;
  monto?: string;
  desc?: string;
  dateFrom?: string;
  dateTo?: string;
  estado?: string; // mismo dominio que status, pero del panel avanzado
  tipo?: string; // ingreso | egreso | interno
  limit?: string; // "100" | "200" | "500" | "all"
};

// Labels alineados con los de facturas — "pendiente / parcial / conciliado".
// El campo `status` en BD sigue siendo `sin_asignar` por compat, pero en UI
// MJ ve "Pendiente" para que el lenguaje coincida con el de facturas.
const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  sin_asignar: { label: "Pendiente", tone: "bg-amber-100 text-amber-800" },
  parcial: { label: "Parcial", tone: "bg-blue-100 text-blue-800" },
  conciliado: { label: "Conciliado", tone: "bg-green-100 text-green-800" },
  sin_factura: { label: "Sin factura", tone: "bg-gray-100 text-gray-700" },
  interno: { label: "Transfer interna", tone: "bg-gray-100 text-gray-500" },
};

const CATEGORY_LABEL: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro personal",
  deposito_efectivo: "Depósito efectivo",
  compra_tarjeta: "Compra tarjeta",
  transfer_interno: "Transfer interno",
  otro_sin_factura: "Otro",
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const showInternal = sp.showInternal === "1";
  const q = (sp.q ?? "").trim();
  // Si el panel avanzado fija "tipo=interno", queremos ver internas aunque
  // el toggle no esté activado.
  const tipoIsInterno = sp.tipo === "interno";

  // Filtro principal del listado.
  const where: Record<string, unknown> = {};
  const andFilters: Record<string, unknown>[] = [];
  if (sp.accountId) where.bankAccountId = sp.accountId;
  // Estado de asignación: el filtro avanzado (sp.estado) pisa al de las tabs.
  // "all" = elección explícita de "Todos" → sin filtro de status (lo que MJ
  // ve cuando hace click en la tab "Todos"). Sin filtro = vista por defecto:
  // pendientes (sin_asignar + parcial), porque MJ entra a /banco/movimientos
  // típicamente para conciliar.
  const effectiveStatus = sp.estado || sp.status;
  const isDefaultPendientes = !effectiveStatus;
  if (effectiveStatus === "all") {
    if (!showInternal && !tipoIsInterno) {
      where.status = { not: "interno" };
    }
  } else if (effectiveStatus) {
    where.status = effectiveStatus;
  } else {
    // Default: solo pendientes (sin_asignar + parcial).
    where.status = { in: ["sin_asignar", "parcial"] };
  }
  if (q) {
    // Búsqueda libre: descripción + nombre contraparte + RUT contraparte.
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { counterpartyName: { contains: q, mode: "insensitive" } },
      { counterpartyRut: { contains: q.replace(/\D/g, "") } },
    ];
  }

  // ── Filtros avanzados ──────────────────────────────────────────────────
  if (sp.rut) {
    const digits = sp.rut.replace(/\D/g, "");
    if (digits) andFilters.push({ counterpartyRut: { contains: digits } });
  }
  if (sp.name) {
    andFilters.push({ counterpartyName: { contains: sp.name, mode: "insensitive" } });
  }
  if (sp.desc) {
    andFilters.push({ description: { contains: sp.desc, mode: "insensitive" } });
  }
  if (sp.monto) {
    const n = Number(sp.monto.replace(/\D/g, ""));
    if (n > 0) {
      // Match exacto contra el monto absoluto (signo positivo o negativo).
      andFilters.push({ OR: [{ amount: n }, { amount: -n }] });
    }
  }
  if (sp.dateFrom || sp.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (sp.dateFrom) dateFilter.gte = new Date(sp.dateFrom);
    if (sp.dateTo) {
      const end = new Date(sp.dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    andFilters.push({ date: dateFilter });
  }
  if (sp.tipo === "ingreso") {
    andFilters.push({ amount: { gt: 0 } });
  } else if (sp.tipo === "egreso") {
    andFilters.push({ amount: { lt: 0 } });
  } else if (sp.tipo === "interno") {
    // pisa el status default; igual lo dejamos explícito por claridad
    where.status = "interno";
  }
  if (andFilters.length > 0) where.AND = andFilters;

  // Cantidad de registros (default 500). "all" = sin límite efectivo (usamos
  // 5000 como tope de seguridad para no traer toda la BD si MJ por error
  // saca todos los filtros).
  const limitParam = sp.limit;
  const take =
    limitParam === "100"
      ? 100
      : limitParam === "200"
        ? 200
        : limitParam === "all"
          ? 5000
          : 500;

  // Filtro para los aggregates de stats: respeta cuenta + búsqueda + filtros
  // avanzados (rut/nombre/monto/desc/fechas/tipo), pero NO el filtro de
  // status (los stats SON el desglose por status).
  const statsWhere: Record<string, unknown> = {};
  if (sp.accountId) statsWhere.bankAccountId = sp.accountId;
  if (q) statsWhere.OR = where.OR;
  if (andFilters.length > 0) statsWhere.AND = andFilters;

  const [movements, accounts, statusCounts, ingresos, egresos] = await Promise.all([
    prisma.bankMovement.findMany({
      where,
      orderBy: { date: "desc" },
      take,
      include: {
        bankAccount: { select: { alias: true } },
        payments: {
          include: {
            invoice: {
              select: { id: true, folioNumber: true, businessName: true, totalAmount: true },
            },
          },
        },
      },
    }),
    prisma.bankAccount.findMany({ orderBy: { role: "asc" } }),
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: statsWhere,
      _count: { _all: true },
    }),
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: { ...statsWhere, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: { ...statsWhere, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
  ]);

  const totalCount = statusCounts.reduce((s, x) => s + x._count._all, 0);
  const countByStatus: Record<string, number> = {};
  for (const c of statusCounts) countByStatus[c.status] = c._count._all;
  const ingresoByStatus: Record<string, number> = {};
  for (const r of ingresos) ingresoByStatus[r.status] = r._sum.amount ?? 0;
  const egresoByStatus: Record<string, number> = {};
  for (const r of egresos) egresoByStatus[r.status] = Math.abs(r._sum.amount ?? 0);

  const sinAsignar = (countByStatus.sin_asignar ?? 0) + (countByStatus.parcial ?? 0);
  const conciliados = countByStatus.conciliado ?? 0;
  const pctConciliado = totalCount > 0 ? Math.round((conciliados / totalCount) * 100) : 0;

  // Sumas para las cards: total = todo; conciliados = status conciliado;
  // pendientes = sin_asignar + parcial.
  const totalIngresos = Object.values(ingresoByStatus).reduce((s, v) => s + v, 0);
  const totalEgresos = Object.values(egresoByStatus).reduce((s, v) => s + v, 0);
  const conciliadosIngresos = ingresoByStatus.conciliado ?? 0;
  const conciliadosEgresos = egresoByStatus.conciliado ?? 0;
  const pendientesIngresos =
    (ingresoByStatus.sin_asignar ?? 0) + (ingresoByStatus.parcial ?? 0);
  const pendientesEgresos =
    (egresoByStatus.sin_asignar ?? 0) + (egresoByStatus.parcial ?? 0);

  // Match hints: para cada mov pendiente con counterparty RUT, buscamos si
  // hay UNA factura abierta con saldo restante = |amount| (±$10) y mismo
  // RUT. Si hay match único, el botón ✨ lo concilia con un click.
  const pendientes = movements.filter(
    (m) => (m.status === "sin_asignar" || m.status === "parcial") && m.counterpartyRut
  );
  const matchHints = new Map<string, { invoiceId: string; folio: string | null; remaining: number }>();
  if (pendientes.length > 0) {
    const candidateInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ["pendiente", "parcial"] },
        tipoDoc: { not: 61 },
      },
      select: {
        id: true,
        type: true,
        folioNumber: true,
        rutIssuer: true,
        rutReceiver: true,
        totalAmount: true,
        payments: { select: { amountApplied: true } },
      },
    });
    const enrichedCandidates = candidateInvoices.map((inv) => ({
      ...inv,
      remaining: inv.totalAmount - inv.payments.reduce((s, p) => s + p.amountApplied, 0),
    }));
    for (const m of pendientes) {
      const isCargo = m.amount < 0;
      const targetType = isCargo ? "recibida" : "emitida";
      const counterpartyDigits = (m.counterpartyRut ?? "").replace(/\D/g, "");
      if (counterpartyDigits.length < 7) continue;
      const movRemaining = Math.abs(m.amount) - m.payments.reduce((s, p) => s + p.amountApplied, 0);
      const matches = enrichedCandidates.filter((inv) => {
        if (inv.type !== targetType) return false;
        const counterField = targetType === "emitida" ? inv.rutReceiver : inv.rutIssuer;
        const counterDigits = (counterField ?? "").replace(/\D/g, "");
        if (!counterDigits.includes(counterpartyDigits.slice(-8))) return false;
        return Math.abs(inv.remaining - movRemaining) <= 10;
      });
      if (matches.length === 1) {
        matchHints.set(m.id, {
          invoiceId: matches[0].id,
          folio: matches[0].folioNumber,
          remaining: matches[0].remaining,
        });
      }
    }
  }

  // RUT BLARQ — necesario para el botón "↔ Interna" inline.
  const BLARQ_RUT_DIGITS = "077270733";

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link href="/banco" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a cuentas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Movimientos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {movements.length} mostrados de {totalCount} total{totalCount !== 1 ? "es" : ""}
            {isDefaultPendientes && (
              <span className="ml-1 text-amber-700">· solo pendientes</span>
            )}
          </p>
        </div>
      </div>

      {/* Stats arriba — conteo + desglose ingresos/egresos por estado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Total movimientos"
          count={totalCount}
          ingresos={totalIngresos}
          egresos={totalEgresos}
          tone="default"
        />
        <StatCard
          label={`Conciliados${totalCount > 0 ? ` · ${pctConciliado}%` : ""}`}
          count={conciliados}
          ingresos={conciliadosIngresos}
          egresos={conciliadosEgresos}
          tone="ok"
        />
        <StatCard
          label="Pendientes"
          count={sinAsignar}
          ingresos={pendientesIngresos}
          egresos={pendientesEgresos}
          tone={sinAsignar > 0 ? "warn" : "default"}
        />
      </div>

      {/* Filtros: cuenta + status + search + toggle internas */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <FilterLink sp={sp} field="accountId" value={undefined} label="Todas las cuentas" />
          {accounts.map((a) => (
            <FilterLink
              key={a.id}
              sp={sp}
              field="accountId"
              value={a.id}
              label={a.alias}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {/* Default (sin params) = pendientes. "Todos" es elección explícita. */}
          <FilterLink sp={sp} field="status" value={undefined} label="Pendientes" />
          <FilterLink sp={sp} field="status" value="all" label="Todos" />
          {Object.entries(STATUS_LABEL).map(([key, { label }]) => (
            <FilterLink
              key={key}
              sp={sp}
              field="status"
              value={key}
              label={`${label}${countByStatus[key] ? ` (${countByStatus[key]})` : ""}`}
            />
          ))}
        </div>
        <MovementsSearch defaultQ={q} sp={sp} />
        <ShowInternalToggle sp={sp} active={showInternal} />
      </div>

      <MovementsAdvancedFilters
        initial={{
          rut: sp.rut ?? "",
          name: sp.name ?? "",
          monto: sp.monto ?? "",
          desc: sp.desc ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
          estado: sp.estado ?? "",
          tipo: sp.tipo ?? "",
          limit: sp.limit ?? "",
        }}
        preserveParams={{
          accountId: sp.accountId,
          status: sp.status,
          q: sp.q,
          showInternal: sp.showInternal,
        }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {movements.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">No hay movimientos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 w-24">Fecha</th>
                <th className="text-left px-4 py-2 w-24">Cuenta</th>
                <th className="text-left px-4 py-2">Descripción</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-left px-4 py-2 w-32">Imputación</th>
                <th className="text-left px-4 py-2 w-32">Estado</th>
                <th className="px-4 py-2 w-44 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((m) => {
                const isCargo = m.amount < 0;
                const sumApplied = m.payments.reduce((s, p) => s + p.amountApplied, 0);
                const remaining = Math.max(0, Math.abs(m.amount) - sumApplied);
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-700 whitespace-nowrap tabular-nums">
                      {new Date(m.date).toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-700">
                      {m.bankAccount.alias}
                    </td>
                    <td className="px-4 py-2 text-gray-900 truncate max-w-[280px]">
                      {m.description}
                      {m.counterpartyName && (
                        <span className="text-xs text-gray-400 ml-2">· {m.counterpartyName}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                        isCargo ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {formatCLP(m.amount)}
                      {m.status === "parcial" && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          libre {formatCLP(remaining)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {m.payments.length > 0 ? (
                        <div className="space-y-0.5">
                          {m.payments.slice(0, 2).map((p) => (
                            <Link
                              key={p.id}
                              href={`/facturas/${p.invoice.id}`}
                              className="block text-gray-700 hover:text-gray-900 hover:underline truncate"
                            >
                              F-{p.invoice.folioNumber} ({formatCLP(p.amountApplied)})
                            </Link>
                          ))}
                          {m.payments.length > 2 && (
                            <span className="text-[10px] text-gray-400">
                              + {m.payments.length - 2} más
                            </span>
                          )}
                        </div>
                      ) : m.category ? (
                        <span className="text-gray-600">
                          {CATEGORY_LABEL[m.category] ?? m.category}
                        </span>
                      ) : m.status === "interno" ? (
                        <span className="text-gray-500">transfer interno</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          STATUS_LABEL[m.status]?.tone ?? "bg-gray-100"
                        }`}
                      >
                        {STATUS_LABEL[m.status]?.label ?? m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {/* Hint ✨ "match exacto" — un click concilia */}
                        {matchHints.has(m.id) && (
                          <MatchHintButton
                            movimientoId={m.id}
                            invoiceId={matchHints.get(m.id)!.invoiceId}
                            folio={matchHints.get(m.id)!.folio}
                          />
                        )}
                        {/* "↔ Interna" — solo para sin_asignar entre cuentas BLARQ */}
                        {(m.status === "sin_asignar" || m.status === "parcial") &&
                          (m.counterpartyRut ?? "").replace(/\D/g, "").includes(BLARQ_RUT_DIGITS) && (
                            <MarkInternalButton movimientoId={m.id} />
                          )}
                        <MovementActionButton
                          movimientoId={m.id}
                          amount={m.amount}
                          description={m.description}
                          counterpartyName={m.counterpartyName}
                          counterpartyRut={m.counterpartyRut}
                          date={m.date.toISOString()}
                          bankAccountAlias={m.bankAccount.alias}
                          existingPayments={m.payments.map((p) => ({
                            id: p.id,
                            invoiceId: p.invoiceId,
                            amountApplied: p.amountApplied,
                            invoice: {
                              folioNumber: p.invoice.folioNumber,
                              businessName: p.invoice.businessName,
                              totalAmount: p.invoice.totalAmount,
                            },
                          }))}
                          status={m.status}
                          variant={
                            m.status === "sin_asignar" || m.status === "parcial"
                              ? "primary"
                              : "ghost"
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterLink({
  sp,
  field,
  value,
  label,
}: {
  sp: SearchParams;
  field: keyof SearchParams;
  value: string | undefined;
  label: string;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== field && v) params.set(k, v as string);
  }
  if (value) params.set(field, value);
  const href = `/banco/movimientos${params.toString() ? "?" + params.toString() : ""}`;
  const isActive = sp[field] === value || (!sp[field] && !value);
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </Link>
  );
}

function ShowInternalToggle({ sp, active }: { sp: SearchParams; active: boolean }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== "showInternal" && v) params.set(k, v as string);
  }
  if (!active) params.set("showInternal", "1");
  const href = `/banco/movimientos${params.toString() ? "?" + params.toString() : ""}`;
  return (
    <Link
      href={href}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
      }`}
      title="Por default las transferencias internas BLARQ↔BLARQ se ocultan"
    >
      {active ? "✓ Internas visibles" : "Mostrar internas"}
    </Link>
  );
}

function StatCard({
  label,
  count,
  ingresos,
  egresos,
  tone,
}: {
  label: string;
  count: number;
  ingresos: number;
  egresos: number;
  tone: "default" | "ok" | "warn";
}) {
  const countColor =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${countColor}`}>{count}</p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
        <div>
          <span className="text-gray-400">↗ ingresos</span>
          <p className="tabular-nums text-emerald-700">{formatCLP(ingresos)}</p>
        </div>
        <div>
          <span className="text-gray-400">↘ egresos</span>
          <p className="tabular-nums text-rose-700">{formatCLP(egresos)}</p>
        </div>
      </div>
    </div>
  );
}
