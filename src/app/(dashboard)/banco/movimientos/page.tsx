import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import AutoConciliarPendientesButton from "@/components/banco/AutoConciliarPendientesButton";
import MovementsSearch from "@/components/banco/MovementsSearch";
import MovementsMontoSearch from "@/components/banco/MovementsMontoSearch";
import MovementsAdvancedFilters from "@/components/banco/MovementsAdvancedFilters";
import MovementsTable from "@/components/banco/MovementsTable";
import { SOCIO_RUTS, SOCIO_GLOSA_HINTS } from "@/lib/banco/socios";

type SearchParams = {
  accountId?: string;
  // Estado (resolución): "pendiente" | "parcial" | "pagado" (o valores DB
  // legacy: sin_asignar/conciliado/sin_factura/interno/neto_cero, para URLs viejos).
  status?: string;
  // Respaldo (naturaleza/documento): factura | boleta | internacional |
  // sin_respaldo | gasto_propio | interna | devolucion.
  respaldo?: string;
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
  socios?: string; // "1" = solo transferencias a socios (MJ/JT), para revisión
  limit?: string; // "100" | "200" | "500" | "all"
  // Filtro por tipo de imputación (categoría sin factura), desde el encabezado
  // de la columna Imputación. Solo se ofrece en la cuenta Sueldos.
  imputacion?: string;
};

// Categorías de imputación (sin factura), ordenadas para el editor inline y el
// filtro de columna. Subconjunto de CATEGORY_LABEL con las que MJ usa en la
// sección Sueldos.
const IMPUTACION_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "sueldo", label: "Sueldo" },
  // Dos relaciones de financiamiento con socios. La dirección (crear o saldar la
  // deuda) la da el signo del movimiento — ver banco/socios.ts. En la fila el
  // rótulo se muestra direccional ("Devolución a socio" en las salidas).
  { value: "prestamo_socio", label: "Préstamo socio (el socio presta)" },
  { value: "adelanto_socio", label: "Adelanto a socio (BLARQ presta)" },
  { value: "retiro_personal", label: "Retiro socio" },
  { value: "bono_socio", label: "Bono socio" },
  { value: "previred", label: "Previred" },
  { value: "comision_bancaria", label: "Comisión banco" },
  { value: "impuestos", label: "Impuestos" },
  { value: "deposito_efectivo", label: "Depósito efectivo" },
  { value: "otro_sin_factura", label: "Otro" },
];

// Estado y Respaldo se derivan ahora en src/lib/banco/movementDisplay.ts
// (el viejo STATUS_LABEL de 7 estados se dividió en los dos ejes).

const CATEGORY_LABEL: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro socio",
  bono_socio: "Bono socio",
  prestamo_socio: "Préstamo socio",
  adelanto_socio: "Adelanto a socio",
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
  // Vista por defecto (sin filtro) = TODOS los movimientos. Las pestañas de
  // estado van separadas (Pendiente, Parcial, Conciliado, ...) — MJ prefiere
  // filtrar cada una por su cuenta, sin una pestaña combinada "Pendientes"
  // que junte sin_asignar + parcial. "all" se mantiene como alias explícito
  // de "sin filtro" (lo usan links de drill-down ?status=all). Cualquier otro
  // valor filtra por ese status. Las transferencias internas igual aparecen
  // solo en "Todos" o en su propia pestaña (las demás filtran por su estado).
  // Estado (resolución): las pestañas Pendiente / Parcial / Pagado se mapean a
  // los status de la BD. "Pagado" agrupa todo lo ya resuelto (conciliado, sin
  // factura, interno, neto cero) — la naturaleza de cada uno se ve en la
  // columna/filtro "Respaldo". Se aceptan también los valores DB crudos
  // (URLs viejos: sin_asignar, conciliado, etc.). sp.estado (avanzado) pisa.
  const estadoParam = sp.estado || sp.status;
  if (estadoParam && estadoParam !== "all") {
    if (estadoParam === "pendiente" || estadoParam === "sin_asignar") {
      where.status = "sin_asignar";
    } else if (estadoParam === "parcial") {
      where.status = "parcial";
    } else if (estadoParam === "pagado") {
      where.status = { in: ["conciliado", "sin_factura", "interno", "neto_cero"] };
    } else {
      where.status = estadoParam;
    }
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
  // Filtro "transferencias a socios" (MJ/JT): para revisar de un saque todo lo
  // que se les transfirió y re-imputar lo que no sea sueldo (reembolso/retiro/
  // bono). Capta por RUT (confiable) o por la glosa truncada del banco.
  if (sp.socios === "1") {
    andFilters.push({
      OR: [
        ...SOCIO_RUTS.map((d) => ({ counterpartyRut: { contains: d } })),
        ...SOCIO_GLOSA_HINTS.map((n) => ({
          counterpartyName: { contains: n, mode: "insensitive" as const },
        })),
        ...SOCIO_GLOSA_HINTS.map((n) => ({
          description: { contains: n, mode: "insensitive" as const },
        })),
      ],
    });
  }
  // Filtro por tipo de imputación (categoría), desde el encabezado de la
  // columna Imputación (solo se ofrece en la cuenta Sueldos). Va en andFilters
  // para que también acote las tarjetas de totales, como el resto.
  if (sp.imputacion) {
    andFilters.push({ category: sp.imputacion });
  }
  // Respaldo (naturaleza / documento). Reemplaza los estados "sin factura /
  // transfer interna / neto cero" que antes vivían en las pestañas de Estado, y
  // agrega el filtro por documento (factura / boleta / internacional / pago sin
  // respaldo) según el origin de la factura imputada. Va a andFilters para
  // combinarse con el Estado sin pisar where.status.
  if (sp.respaldo) {
    switch (sp.respaldo) {
      case "gasto_propio":
        andFilters.push({ status: "sin_factura" });
        break;
      case "interna":
        andFilters.push({ status: "interno" });
        break;
      case "devolucion":
        andFilters.push({ status: "neto_cero" });
        break;
      case "factura":
        andFilters.push({
          payments: { some: { invoice: { origin: { in: ["sii_automatica", "manual"] } } } },
        });
        break;
      case "boleta":
        andFilters.push({ payments: { some: { invoice: { origin: "gasto_boleta" } } } });
        break;
      case "internacional":
        andFilters.push({ payments: { some: { invoice: { origin: "gasto_internacional" } } } });
        break;
      case "sin_respaldo":
        andFilters.push({ payments: { some: { invoice: { origin: "sin_respaldo" } } } });
        break;
    }
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

  const [movements, accounts, statusCounts, ingresos, egresos, parcialMovs, projects, categories, boletaCount, internacionalCount] = await Promise.all([
    prisma.bankMovement.findMany({
      where,
      orderBy: { date: "desc" },
      take,
      include: {
        bankAccount: { select: { alias: true } },
        payments: {
          include: {
            invoice: {
              // origin distingue el tipo de respaldo del pago: sii_automatica /
              // manual = factura real; sin_respaldo = pago a obra sin documento;
              // gasto_boleta / gasto_internacional = gasto registrado. Se usa
              // para derivar la columna "Respaldo".
              select: { id: true, folioNumber: true, businessName: true, totalAmount: true, origin: true },
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
    // Movimientos PARCIALES con sus payments: los necesitamos para repartir
    // su monto entre las tarjetas de arriba. Un mov parcial tiene una parte
    // aplicada a factura(s) (= conciliada) y un resto libre (= pendiente);
    // sumarlo entero a "pendientes" sobreestima lo que falta conciliar.
    prisma.bankMovement.findMany({
      where: { ...statsWhere, status: "parcial" },
      select: { amount: true, payments: { select: { amountApplied: true } } },
    }),
    // Proyectos y categorías para el modal "pago sin factura" (asignar un
    // movimiento a un costo de proyecto sin que exista factura).
    prisma.project.findMany({
      // Solo proyectos asignables: se esconden las cotizaciones no ganadas
      // (status="cotizacion"). Los centros internos (BLARQ) se mantienen.
      where: { NOT: { status: "cotizacion", isInternal: false } },
      select: { id: true, name: true, numeroProyecto: true },
      // Ordenado por número de proyecto (el desplegable muestra "46 · …"), con
      // los proyectos sin número (BLARQ, CASA, internos) al final. Antes salía
      // por nombre y los números saltaban (46, 58, 61, 48…).
      orderBy: { numeroProyecto: { sort: "asc", nulls: "last" } },
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
    // ¿Existe al menos un gasto con boleta / internacional? Las pastillas de esos
    // respaldos solo se muestran cuando hay (hoy 0; se llenan al usar "Registrar
    // gasto"). Conteo GLOBAL a propósito — que la pastilla no aparezca/desaparezca
    // según los otros filtros activos.
    prisma.bankMovement.count({
      where: { payments: { some: { invoice: { origin: "gasto_boleta" } } } },
    }),
    prisma.bankMovement.count({
      where: { payments: { some: { invoice: { origin: "gasto_internacional" } } } },
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

  // Conteos para las pestañas de Estado (Pendiente / Parcial / Pagado).
  // "Pagado" agrupa todo lo resuelto (conciliado + sin factura + interno + neto cero).
  const countPendiente = countByStatus.sin_asignar ?? 0;
  const countParcial = countByStatus.parcial ?? 0;
  const countPagado =
    (countByStatus.conciliado ?? 0) +
    (countByStatus.sin_factura ?? 0) +
    (countByStatus.interno ?? 0) +
    (countByStatus.neto_cero ?? 0);

  const sinAsignar = (countByStatus.sin_asignar ?? 0) + (countByStatus.parcial ?? 0);
  // Cuántos movs son candidatos a auto-conciliarse contra factura: están
  // sin_asignar o sin_factura, sin payments. La cuenta exacta se hace en
  // el endpoint; acá usamos un proxy razonable para mostrar al usuario.
  const conciliablesAprox =
    (countByStatus.sin_asignar ?? 0) + (countByStatus.sin_factura ?? 0);
  const conciliados = countByStatus.conciliado ?? 0;

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

  // Reparto del monto de los movimientos PARCIALES entre conciliado y
  // pendiente. Un parcial NO es "todo pendiente": tiene una parte aplicada a
  // factura (conciliada) y un resto libre (pendiente). Repartimos por MONTO:
  //   aplicado = Σ amountApplied de sus payments  → va a CONCILIADO
  //   libre    = |monto| − aplicado               → va a PENDIENTE
  // Ingresos (monto>0) y egresos (monto<0) por separado, igual que las cards.
  let parcialAplicadoIngresos = 0;
  let parcialLibreIngresos = 0;
  let parcialAplicadoEgresos = 0;
  let parcialLibreEgresos = 0;
  for (const m of parcialMovs) {
    const aplicado = m.payments.reduce((s, p) => s + p.amountApplied, 0);
    const libre = Math.max(0, Math.abs(m.amount) - aplicado);
    if (m.amount >= 0) {
      parcialAplicadoIngresos += aplicado;
      parcialLibreIngresos += libre;
    } else {
      parcialAplicadoEgresos += aplicado;
      parcialLibreEgresos += libre;
    }
  }

  // Conciliado = movs 100% conciliados + la parte aplicada de los parciales.
  // Pendiente  = movs sin asignar enteros + la parte libre de los parciales.
  // Así TOTAL = Conciliado + Pendiente sigue cuadrando: el monto del parcial
  // (aplicado + libre) es el mismo, solo se reparte entre las dos tarjetas.
  const conciliadosIngresos = (ingresoByStatus.conciliado ?? 0) + parcialAplicadoIngresos;
  const conciliadosEgresos = (egresoByStatus.conciliado ?? 0) + parcialAplicadoEgresos;
  const pendientesIngresos = (ingresoByStatus.sin_asignar ?? 0) + parcialLibreIngresos;
  const pendientesEgresos = (egresoByStatus.sin_asignar ?? 0) + parcialLibreEgresos;

  // "% conciliado" por MONTO (no por conteo de movimientos), para que sea
  // consistente con las tarjetas, que ahora también reparten por plata. Antes
  // era conciliados/totalCount (un parcial contaba como 0% aunque tuviera casi
  // todo aplicado). Denominador = plata total (excluye neto cero).
  const totalMonto = totalIngresos + totalEgresos;
  const conciliadoMonto = conciliadosIngresos + conciliadosEgresos;
  const pctConciliado = totalMonto > 0 ? Math.round((conciliadoMonto / totalMonto) * 100) : 0;

  // RUT BLARQ — necesario para ofrecer "Marcar transferencia interna" en el
  // menú Resolver (solo cuando la contraparte es la propia BLARQ).
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
    projectId: m.projectId,
    internalConcepto: m.internalConcepto,
    salaryPeriod: m.salaryPeriod,
    socioRut: m.socioRut,
    payments: m.payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountApplied: p.amountApplied,
      invoice: {
        id: p.invoice.id,
        folioNumber: p.invoice.folioNumber,
        businessName: p.invoice.businessName,
        totalAmount: p.invoice.totalAmount,
        origin: p.invoice.origin,
      },
    })),
  }));

  // El filtro de imputación en la columna filtra por la categoría del
  // movimiento sin factura (sueldo / préstamo socio / retiro / etc.). Antes
  // solo aparecía en la cuenta Sueldos, pero los pagos a socios pasan por
  // Sueldos Y por Operativa, así que en "Todas las cuentas" no se podían
  // pescar. Ahora se muestra en "Todas las cuentas", "Operativa" y "Sueldos"
  // (donde el filtro tiene sentido); se oculta solo si la cuenta elegida es
  // "otra". El filtro es agnóstico de cuenta en la query, así que respeta la
  // URL igual en todas las vistas.
  const selectedAccount = sp.accountId
    ? accounts.find((a) => a.id === sp.accountId)
    : null;
  const showImputacionFilter =
    !sp.accountId || // Todas las cuentas
    selectedAccount?.role === "operating" || // Operativa
    selectedAccount?.role === "salary_fund"; // Sueldos

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

      {/* Filtros ordenados en jerarquía (§2.2 de la auditoría): se leen de
          arriba a abajo — primero la CUENTA (dónde miro), después ESTADO,
          después TIPO, después BUSCAR. Cada fila con su rótulo a la izquierda.
          Antes estaban todos apretados al mismo peso, sin orden mental. Ningún
          filtro se perdió: solo se reordenaron y se sacó el "estado" duplicado
          que además vivía en "Filtros avanzados". */}
      <div className="space-y-2 mb-4">
        {/* Cuenta — la decisión primaria: primero elegí dónde mirás. */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterRowLabel>Cuenta</FilterRowLabel>
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
        </div>

        {/* Estado — SOLO resolución: Pendiente / Parcial / Pagado. Los que
            antes eran estados por naturaleza (Sin factura / Transfer interna /
            Neto cero) se movieron al filtro "Respaldo". "Pagado" agrupa todo lo
            ya resuelto. */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterRowLabel>Estado</FilterRowLabel>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <FilterLink sp={sp} field="status" value={undefined} label="Todos" />
            <FilterLink sp={sp} field="status" value="pendiente" label={`Pendiente${countPendiente ? ` (${countPendiente})` : ""}`} />
            <FilterLink sp={sp} field="status" value="parcial" label={`Parcial${countParcial ? ` (${countParcial})` : ""}`} />
            <FilterLink sp={sp} field="status" value="pagado" label={`Pagado${countPagado ? ` (${countPagado})` : ""}`} />
          </div>
        </div>

        {/* Respaldo (naturaleza / documento) en pastillas, igual que Cuenta y
            Estado (antes era el único filtro-desplegable — inconsistente). Las
            opciones raras/vacías se curan: "Devolución" (neto cero, ~6 casos) se
            saca de la barra — esos movimientos igual aparecen dentro de "Pagado"
            y su etiqueta se ve en la columna Respaldo. "Boleta" e "Internacional"
            solo se muestran cuando existe al menos un gasto de ese tipo (hoy 0;
            se llenan al usar "Registrar gasto"). Los valores de la URL siguen
            siendo los mismos (?respaldo=…), el switch de arriba los mapea igual. */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterRowLabel>Respaldo</FilterRowLabel>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 flex-wrap">
            <FilterLink sp={sp} field="respaldo" value={undefined} label="Todos" />
            <FilterLink sp={sp} field="respaldo" value="factura" label="Factura" />
            {boletaCount > 0 && (
              <FilterLink sp={sp} field="respaldo" value="boleta" label="Boleta" />
            )}
            {internacionalCount > 0 && (
              <FilterLink sp={sp} field="respaldo" value="internacional" label="Internacional" />
            )}
            <FilterLink sp={sp} field="respaldo" value="sin_respaldo" label="Pago sin respaldo" />
            <FilterLink sp={sp} field="respaldo" value="gasto_propio" label="Gasto BLARQ" />
            <FilterLink sp={sp} field="respaldo" value="interna" label="Traspaso" />
          </div>
        </div>

        {/* Tipo (ingreso/egreso) + filtro de revisión "transferencias a socios". */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterRowLabel>Tipo</FilterRowLabel>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <FilterLink sp={sp} field="tipo" value={undefined} label="Todos" />
            <FilterLink sp={sp} field="tipo" value="ingreso" label="↗ Ingresos" />
            <FilterLink sp={sp} field="tipo" value="egreso" label="↘ Egresos" />
          </div>
          <SociosFilterLink sp={sp} />
        </div>

        {/* Buscar — texto libre + monto exacto, a mano en la barra (MJ los usa
            seguido para conciliar). */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterRowLabel>Buscar</FilterRowLabel>
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <MovementsSearch defaultQ={q} sp={sp} />
            <MovementsMontoSearch defaultMonto={sp.monto ?? ""} sp={sp} />
          </div>
        </div>
      </div>

      <MovementsAdvancedFilters
        initial={{
          rut: sp.rut ?? "",
          name: sp.name ?? "",
          desc: sp.desc ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
          limit: sp.limit ?? "",
        }}
        preserveParams={{
          accountId: sp.accountId,
          status: sp.status,
          q: sp.q,
          // El monto y el tipo (ingreso/egreso) ahora viven en la barra visible;
          // el panel avanzado los conserva pero ya no los edita.
          monto: sp.monto,
          tipo: sp.tipo,
        }}
      />

      <MovementsTable
        movements={movementRows}
        categoryLabels={CATEGORY_LABEL}
        blarqRutDigits={BLARQ_RUT_DIGITS}
        projects={projects}
        categories={categoryOptions}
        imputacionCategories={IMPUTACION_CATEGORY_OPTIONS}
        showImputacionFilter={showImputacionFilter}
        imputacionFilterValue={sp.imputacion ?? ""}
      />
    </div>
  );
}

// Rótulo a la izquierda de cada fila de filtros. Da el orden de lectura
// (Cuenta → Estado → Tipo → Buscar) sin peso visual: gris chico, alineado a
// la derecha para que "apunte" a los controles. En pantallas angostas la fila
// hace wrap y el rótulo queda arriba de sus controles.
function FilterRowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-16 shrink-0 text-right pr-1 text-[10px] uppercase tracking-wider text-gray-400 select-none">
      {children}
    </span>
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

// Toggle "Transferencias a socios": prende/apaga el filtro socios=1 sin perder
// el resto de los filtros activos. Pill aparte porque es una dimensión
// ortogonal a ingreso/egreso (puede combinarse con cualquier pestaña).
function SociosFilterLink({ sp }: { sp: SearchParams }) {
  const active = sp.socios === "1";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== "socios" && k !== "id" && v) params.set(k, v as string);
  }
  if (!active) params.set("socios", "1");
  const href = `/banco/movimientos${params.toString() ? "?" + params.toString() : ""}`;
  return (
    <Link
      href={href}
      title="Ver solo transferencias a los socios (MJ/JT) para confirmar sueldos o re-imputar reembolsos/retiros"
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "text-gray-600 border-gray-200 bg-white hover:bg-gray-100"
      }`}
    >
      Transferencias a socios
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
