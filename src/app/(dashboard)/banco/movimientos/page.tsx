import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import AutoConciliarPendientesButton from "@/components/banco/AutoConciliarPendientesButton";
import MovementsSearch from "@/components/banco/MovementsSearch";
import MovementsAdvancedFilters from "@/components/banco/MovementsAdvancedFilters";
import MovementsTable from "@/components/banco/MovementsTable";

type SearchParams = {
  accountId?: string;
  status?: string;
  q?: string;
  // Drill-down a UN movimiento puntual (link "ver" desde el historial de pagos
  // de una factura). No es un filtro persistente: cualquier tab/búsqueda lo
  // suelta (ver FilterLink). Se sale con el cartelito "limpiar".
  id?: string;
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
  neto_cero: { label: "Neto cero", tone: "bg-gray-100 text-gray-500" },
};

const CATEGORY_LABEL: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro personal",
  deposito_efectivo: "Depósito efectivo",
  impuestos: "Impuestos",
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
  const q = (sp.q ?? "").trim();

  // Filtro principal del listado.
  const where: Record<string, unknown> = {};
  const andFilters: Record<string, unknown>[] = [];
  if (sp.accountId) where.bankAccountId = sp.accountId;
  // Drill-down a un movimiento puntual: si viene `id`, mostramos solo ese.
  if (sp.id) where.id = sp.id;
  // Estado de asignación: el filtro avanzado (sp.estado) pisa al de las tabs.
  // "all" = elección explícita de "Todos" → SIN ningún filtro de status:
  // muestra TODO, incluidas las transferencias internas (que igual van
  // etiquetadas como "Transfer interna" en la columna Estado). Antes "Todos"
  // escondía las internas salvo que se prendiera un toggle — confuso, porque
  // la pestaña que dice "Todos" era la única que ocultaba algo. Las demás
  // pestañas filtran por su propio estado, así que las internas no aparecen
  // ahí de todos modos. Sin filtro = vista por defecto: pendientes
  // (sin_asignar + parcial), porque MJ entra a /banco/movimientos típicamente
  // para conciliar.
  const effectiveStatus = sp.estado || sp.status;
  const isDefaultPendientes = !effectiveStatus;
  if (effectiveStatus === "all") {
    // sin filtro de status: TODO
  } else if (effectiveStatus) {
    where.status = effectiveStatus;
  } else {
    // Default: solo pendientes (sin_asignar + parcial).
    where.status = { in: ["sin_asignar", "parcial"] };
  }
  if (q) {
    // Búsqueda libre: descripción + nombre contraparte + RUT contraparte.
    // OJO: el filtro de RUT solo se incluye si q tiene dígitos. De lo
    // contrario `q.replace(/\D/g, "")` queda en "" y `contains: ""`
    // matchea TODO, rompiendo el OR (cualquier movimiento con RUT pasa,
    // sea o no del nombre buscado).
    const rutDigits = q.replace(/\D/g, "");
    const orFilters: Prisma.BankMovementWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { counterpartyName: { contains: q, mode: "insensitive" } },
    ];
    if (rutDigits.length >= 3) {
      orFilters.push({ counterpartyRut: { contains: rutDigits } });
    }
    where.OR = orFilters;
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
  // En drill-down por `id`, las tarjetas de totales también reflejan solo ese
  // movimiento (si no, mostrarían "86 movimientos" mientras la lista muestra 1).
  if (sp.id) statsWhere.id = sp.id;
  if (q) statsWhere.OR = where.OR;
  if (andFilters.length > 0) statsWhere.AND = andFilters;

  const [movements, accounts, statusCounts, ingresos, egresos, projects, categories] = await Promise.all([
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
    // Proyectos y categorías para el modal "pago sin factura" (asignar un
    // movimiento a un costo de proyecto sin que exista factura).
    prisma.project.findMany({
      // Solo proyectos asignables: se esconden las cotizaciones no ganadas
      // (status="cotizacion"). Los centros internos (BLARQ) se mantienen.
      where: { NOT: { status: "cotizacion", isInternal: false } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.costCategory.findMany({
      where: { appliesTo: { in: ["recibida", "both"] } },
      select: {
        id: true,
        name: true,
        parent: { select: { name: true } },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // Categorías aplanadas con etiqueta "Padre / Hijo" para el selector.
  const categoryOptions = categories.map((c) => ({
    id: c.id,
    label: c.parent ? `${c.parent.name} / ${c.name}` : c.name,
  }));

  const totalCount = statusCounts.reduce((s, x) => s + x._count._all, 0);
  const countByStatus: Record<string, number> = {};
  for (const c of statusCounts) countByStatus[c.status] = c._count._all;
  const ingresoByStatus: Record<string, number> = {};
  for (const r of ingresos) ingresoByStatus[r.status] = r._sum.amount ?? 0;
  const egresoByStatus: Record<string, number> = {};
  for (const r of egresos) egresoByStatus[r.status] = Math.abs(r._sum.amount ?? 0);

  const sinAsignar = (countByStatus.sin_asignar ?? 0) + (countByStatus.parcial ?? 0);
  // Cuántos movs son candidatos a auto-conciliarse contra factura: están
  // sin_asignar o sin_factura, sin payments. La cuenta exacta se hace en
  // el endpoint; acá usamos un proxy razonable para mostrar al usuario.
  const conciliablesAprox =
    (countByStatus.sin_asignar ?? 0) + (countByStatus.sin_factura ?? 0);
  const conciliados = countByStatus.conciliado ?? 0;
  const pctConciliado = totalCount > 0 ? Math.round((conciliados / totalCount) * 100) : 0;

  // Sumas para las cards: total = todo; conciliados = status conciliado;
  // pendientes = sin_asignar + parcial. Las devoluciones "neto cero" se
  // EXCLUYEN de ingresos/egresos: entró y volvió, no es plata real (igual
  // criterio que el resto de la app, donde la utilidad sale de las facturas).
  const sumExcluyendoNetoCero = (byStatus: Record<string, number>) =>
    Object.entries(byStatus)
      .filter(([s]) => s !== "neto_cero")
      .reduce((acc, [, v]) => acc + v, 0);
  const totalIngresos = sumExcluyendoNetoCero(ingresoByStatus);
  const totalEgresos = sumExcluyendoNetoCero(egresoByStatus);
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

  // Serializar para el componente client de la tabla (Date → ISO string).
  const movementRows = movements.map((m) => ({
    id: m.id,
    amount: m.amount,
    date: m.date.toISOString(),
    description: m.description,
    counterpartyName: m.counterpartyName,
    counterpartyRut: m.counterpartyRut,
    status: m.status,
    category: m.category,
    bankAccountAlias: m.bankAccount.alias,
    payments: m.payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountApplied: p.amountApplied,
      invoice: {
        id: p.invoice.id,
        folioNumber: p.invoice.folioNumber,
        businessName: p.invoice.businessName,
        totalAmount: p.invoice.totalAmount,
      },
    })),
  }));
  const matchHintsObj = Object.fromEntries(matchHints);

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
        <AutoConciliarPendientesButton pendientesCount={conciliablesAprox} />
      </div>

      {/* Drill-down a un movimiento puntual: link discreto para salir del filtro
          y volver a la lista completa. Sin texto explicativo — MJ ya lo sabe. */}
      {sp.id && (
        <div className="mb-4 text-xs">
          <Link
            href="/banco/movimientos?status=all"
            className="text-gray-500 hover:text-gray-900 underline"
          >
            limpiar
          </Link>
        </div>
      )}

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
        }}
      />

      <MovementsTable
        movements={movementRows}
        matchHints={matchHintsObj}
        statusLabels={STATUS_LABEL}
        categoryLabels={CATEGORY_LABEL}
        blarqRutDigits={BLARQ_RUT_DIGITS}
        projects={projects}
        categories={categoryOptions}
      />
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
    // `id` es un drill-down efímero (ver un movimiento puntual): cualquier
    // click en una tab vuelve a la navegación normal, no lo arrastra.
    if (k !== field && k !== "id" && v) params.set(k, v as string);
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
  // Protagonista del card: el monto neto (ingresos − egresos). La cantidad
  // de movimientos pasa a leyenda secundaria — MJ prefiere ver plata.
  const neto = ingresos - egresos;
  const amountColor =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${amountColor}`}>
        {formatCLP(neto)}
      </p>
      <p className="text-[11px] text-gray-400 tabular-nums mt-0.5">
        {count} {count === 1 ? "movimiento" : "movimientos"}
      </p>
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
