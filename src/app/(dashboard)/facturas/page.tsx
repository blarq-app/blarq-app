import { prisma } from "@/lib/prisma";
import { PROYECTOS_ASIGNABLES_WHERE } from "@/lib/projects/asignables";
import Link from "next/link";
import FacturasFilterBar from "@/components/facturas/FacturasFilterBar";
import FacturasTable from "@/components/facturas/FacturasTable";
import SyncSiiButton from "@/components/facturas/SyncSiiButton";
import { formatCLP } from "@/lib/utils";

type SearchParams = {
  type?: "emitida" | "recibida";
  status?: "pendiente" | "parcial" | "pagada" | "anulada";
  origin?: "manual" | "sii_automatica";
  projectId?: string;
  tipoDoc?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  // Filtro por ID exacto de una factura. Lo usa el link de la imputación
  // conciliada en /banco/movimientos: al apretar "F-3322" muestra SOLO esa
  // factura, no las que contienen "3322" en el folio.
  invoiceId?: string;
  // Monto exacto en CLP. Búsqueda con tolerancia ±$10 para cubrir
  // redondeos de IVA típicos (factura emitida $100.000 vs neto+iva
  // que da $99.999 por floor).
  monto?: string;
  // Atajo del banner "NC sin clasificar / saldo a favor": muestra solo las
  // notas de crédito recibidas que todavía no se clasificaron (sin saber si
  // volvieron en efectivo, al banco, o se aplicaron a otra factura).
  sinClasificar?: string;
};

// Status tone moved to FacturasTable client component.

export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // Arma el `where` de la consulta a partir de los filtros de la URL.
  //
  // `omitir` existe por las PASTILLAS con conteo: el número que va al lado de
  // "Pendiente" tiene que contar las pendientes que quedan DENTRO del resto de
  // los filtros puestos, pero ignorando el filtro de estado en sí — si no, al
  // tener "Pagada" activo todas las demás pastillas dirían 0 y no se podría
  // saltar de una a otra. Mismo criterio que el `statsWhere` del banco.
  function buildWhere(omitir?: "type" | "status" | "tipoDoc") {
    const where: Record<string, unknown> = {};
    // Filtro por id exacto (link de la imputación conciliada). Gana sobre el
    // resto: si viene invoiceId, se muestra esa única factura.
    if (sp.invoiceId) where.id = sp.invoiceId;
    if (sp.type && omitir !== "type") where.type = sp.type;
    if (sp.status && omitir !== "status") where.status = sp.status;
    if (sp.origin) where.origin = sp.origin;
    if (sp.projectId === "sin-asignar") where.projectId = null;
    else if (sp.projectId) where.projectId = sp.projectId;
    if (sp.tipoDoc && omitir !== "tipoDoc") where.tipoDoc = Number(sp.tipoDoc);
    if (sp.categoryId) where.categoryId = sp.categoryId;
    if (sp.dateFrom || sp.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (sp.dateFrom) dateFilter.gte = new Date(sp.dateFrom);
      if (sp.dateTo) {
        // inclusivo: hasta el final del día
        const end = new Date(sp.dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.issueDate = dateFilter;
    }
    if (sp.q) {
      // mode "insensitive" para que la búsqueda matchee independiente de
      // mayúsculas/minúsculas. Es necesario en Postgres (en SQLite el LIKE
      // era case-insensitive por default; tras el cutover a Neon se rompió).
      //
      // Si q es un folio PURO (solo dígitos), el folio se matchea EXACTO: así
      // buscar "3322" no arrastra "11332256" (que lo contiene). Los otros
      // campos (nombre, RUT, notas) siguen por "contiene". Si q tiene letras,
      // el folio vuelve a "contiene" (búsqueda parcial de texto normal).
      const qFolioNumerico = /^\d+$/.test(sp.q.trim());
      where.OR = [
        qFolioNumerico
          ? { folioNumber: sp.q.trim() }
          : { folioNumber: { contains: sp.q, mode: "insensitive" } },
        { businessName: { contains: sp.q, mode: "insensitive" } },
        { rutIssuer: { contains: sp.q, mode: "insensitive" } },
        { notes: { contains: sp.q, mode: "insensitive" } },
      ];
    }
    if (sp.monto) {
      // Permitir formato chileno con puntos ("1.234.567") o solo dígitos.
      const digits = sp.monto.replace(/[^\d]/g, "");
      const m = parseFloat(digits);
      if (!isNaN(m) && m > 0) {
        // Tolerancia ±$10 para redondeos de IVA.
        where.totalAmount = { gte: m - 10, lte: m + 10 };
      }
    }
    if (sp.sinClasificar) {
      // NC recibidas sin compensación decidida = plata a favor flotando.
      // Se aplica SIEMPRE, incluso cuando se omite una dimensión: es el modo
      // en el que está la pantalla, no una pastilla que se pueda soltar.
      where.tipoDoc = 61;
      where.type = "recibida";
      where.compensationType = null;
      where.status = { not: "anulada" };
    }
    return where;
  }

  const where = buildWhere();

  const [
    invoices,
    projects,
    categories,
    totalsByType,
    countsByType,
    countsByStatus,
    countsByTipoDoc,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issueDate: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        // autoMatched: para marcar conciliadas automáticamente.
        // amountApplied: para calcular el saldo (columna "Saldo").
        payments: { select: { autoMatched: true, amountApplied: true } },
      },
      // Excluir el blob del PDF oficial — pesado (~170KB c/u) y solo lo
      // sirve el endpoint /api/facturas/[id]/pdf cuando se descarga.
      omit: { pdfContent: true },
      take: 500,
    }),
    prisma.project.findMany({
      // Solo proyectos asignables al conciliar (criterio único en asignables.ts:
      // se esconden cotizaciones no ganadas y archivadas sin facturas).
      where: PROYECTOS_ASIGNABLES_WHERE,
      orderBy: [{ numeroProyecto: "asc" }, { numeroCotizacion: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        numeroProyecto: true,
        numeroCotizacion: true,
      },
    }),
    prisma.costCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        appliesTo: true,
        parent: { select: { id: true, name: true } },
      },
    }),
    // Totales de las tarjetas de arriba. Van por consulta y NO sumando las
    // filas traídas: la lista corta en 500, así que sumar `invoices` daba el
    // total de las primeras 500 y no el de todas las que matchean el filtro.
    prisma.invoice.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true, netAmount: true },
    }),
    // Conteos de las pastillas. Cada uno omite su propia dimensión (ver
    // buildWhere) para que se pueda saltar de una pastilla a otra.
    prisma.invoice.groupBy({
      by: ["type"],
      where: buildWhere("type"),
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: buildWhere("status"),
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["tipoDoc"],
      where: buildWhere("tipoDoc"),
      _count: { _all: true },
    }),
  ]);

  // Los cuatro totales de arriba, ya por consulta y no sobre las 500 filas.
  const totalFacturas = totalsByType.reduce((s, r) => s + r._count._all, 0);
  const filaEmitidas = totalsByType.find((r) => r.type === "emitida");
  const filaRecibidas = totalsByType.find((r) => r.type === "recibida");
  const totalEmitido = filaEmitidas?._sum.totalAmount ?? 0;
  const totalEmitidoNeto = filaEmitidas?._sum.netAmount ?? 0;
  const totalRecibido = filaRecibidas?._sum.totalAmount ?? 0;
  const totalRecibidoNeto = filaRecibidas?._sum.netAmount ?? 0;

  // Conteos aplanados a { valor: cuántas } para las pastillas.
  const conteoTipo: Record<string, number> = {};
  for (const r of countsByType) conteoTipo[r.type] = r._count._all;
  const conteoEstado: Record<string, number> = {};
  for (const r of countsByStatus) conteoEstado[r.status] = r._count._all;
  // tipoDoc es número (33/34/61/56/39) y puede venir null en facturas viejas;
  // las null no tienen pastilla, así que se descartan.
  const conteoDocumento: Record<string, number> = {};
  for (const r of countsByTipoDoc) {
    if (r.tipoDoc != null) conteoDocumento[String(r.tipoDoc)] = r._count._all;
  }

  // Cuántas facturas SII están sin asignar a proyecto — para destacar el
  // filtro y atraer la atención del usuario.
  const siiUnassignedCount = await prisma.invoice.count({
    where: { origin: "sii_automatica", projectId: null },
  });

  // Saldo por factura (para la columna "Saldo"). Misma lógica que la lista
  // por proyecto: pagado = suma de InvoicePayment + crédito de las NC
  // aplicadas a esta factura (compensationType="other_invoice"). Saldo =
  // total − pagado, nunca negativo.
  const invoiceIds = invoices.map((i) => i.id);
  const ncsCompensadas =
    invoiceIds.length > 0
      ? await prisma.invoice.findMany({
          where: {
            compensationType: "other_invoice",
            appliedToInvoiceId: { in: invoiceIds },
          },
          select: {
            id: true,
            appliedToInvoiceId: true,
            totalAmount: true,
            folioNumber: true,
          },
        })
      : [];
  const ncCreditByInvoice = new Map<string, number>();
  // Detalle de las NC aplicadas a cada factura (id + folio + monto), para
  // mostrar la marca "↳ NC F-xxx" clickeable en la fila. Es independiente del
  // estado: una factura pagada o anulada puede tener marca de NC.
  const ncAppliedByInvoice = new Map<
    string,
    { id: string; folio: string | null; amount: number }[]
  >();
  for (const nc of ncsCompensadas) {
    if (!nc.appliedToInvoiceId) continue;
    ncCreditByInvoice.set(
      nc.appliedToInvoiceId,
      (ncCreditByInvoice.get(nc.appliedToInvoiceId) ?? 0) + Math.abs(nc.totalAmount)
    );
    const list = ncAppliedByInvoice.get(nc.appliedToInvoiceId) ?? [];
    list.push({ id: nc.id, folio: nc.folioNumber, amount: Math.abs(nc.totalAmount) });
    ncAppliedByInvoice.set(nc.appliedToInvoiceId, list);
  }
  const paidOf = (inv: {
    id: string;
    status: string;
    totalAmount: number;
    payments: { amountApplied: number }[];
  }) => {
    const ncCredit = ncCreditByInvoice.get(inv.id) ?? 0;
    if (inv.payments.length > 0) {
      return inv.payments.reduce((s, p) => s + p.amountApplied, 0) + ncCredit;
    }
    if (inv.status === "pagada") return inv.totalAmount;
    return ncCredit;
  };
  const remainingOf = (inv: {
    id: string;
    status: string;
    totalAmount: number;
    payments: { amountApplied: number }[];
  }) => Math.max(0, inv.totalAmount - paidOf(inv));

  // Resolución de la factura original que referencia cada NC (61) / ND (56),
  // para hacer clickeable el "ref F-…" de la lista. La referencia se guarda
  // como folio en texto (referenceFolioNumber), no como id; la resolvemos por
  // (type, folio, RUT del mismo emisor/receptor) contra factura/exenta (33/34).
  // Una sola query batch para toda la página, no N+1. Si la original no está
  // cargada en la app, el folio queda sin id y el "ref" se muestra sin link.
  const refKeyOf = (
    type: string,
    folio: string | null,
    rutIssuer: string | null,
    rutReceiver: string | null
  ) =>
    // Recibidas: la original comparte rutIssuer (mismo proveedor). Emitidas:
    // comparte rutReceiver (mismo cliente) — el rutIssuer sería siempre BLARQ.
    type === "recibida"
      ? `recibida|${folio ?? ""}|${rutIssuer ?? ""}`
      : `emitida|${folio ?? ""}|${rutReceiver ?? ""}`;
  const refNCs = invoices.filter(
    (i) => i.referenceFolioNumber && (i.tipoDoc === 61 || i.tipoDoc === 56)
  );
  const referencedIdByNC = new Map<string, string>();
  if (refNCs.length > 0) {
    const originals = await prisma.invoice.findMany({
      where: {
        tipoDoc: { in: [33, 34] },
        OR: refNCs.map((nc) => ({
          type: nc.type,
          folioNumber: nc.referenceFolioNumber,
          ...(nc.type === "recibida"
            ? { rutIssuer: nc.rutIssuer }
            : { rutReceiver: nc.rutReceiver }),
        })),
      },
      select: {
        id: true,
        type: true,
        folioNumber: true,
        rutIssuer: true,
        rutReceiver: true,
      },
    });
    const idByKey = new Map<string, string>();
    for (const o of originals) {
      idByKey.set(refKeyOf(o.type, o.folioNumber, o.rutIssuer, o.rutReceiver), o.id);
    }
    for (const nc of refNCs) {
      const id = idByKey.get(
        refKeyOf(nc.type, nc.referenceFolioNumber, nc.rutIssuer, nc.rutReceiver)
      );
      if (id) referencedIdByNC.set(nc.id, id);
    }
  }

  // Banner "saldo a favor": NC recibidas sin clasificar (no se sabe si la
  // plata volvió en efectivo, al banco, o se aplicó a otra factura).
  const ncSinClasificarAgg = await prisma.invoice.aggregate({
    where: {
      tipoDoc: 61,
      type: "recibida",
      compensationType: null,
      status: { not: "anulada" },
    },
    _count: true,
    _sum: { totalAmount: true },
  });
  const ncSinClasificarCount = ncSinClasificarAgg._count;
  const ncSinClasificarTotal = ncSinClasificarAgg._sum.totalAmount ?? 0;

  return (
    <div>
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Facturas</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/facturas/reglas"
            className="text-xs text-gray-500 hover:text-gray-900 underline"
          >
            Reglas
          </Link>
          <SyncSiiButton />
          <Link
            href="/facturas/nueva"
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            + Nueva factura
          </Link>
        </div>
      </div>

      {/* Atajo destacado a "facturas SII sin asignar a proyecto" cuando hay.
          Estilo gris/icono mono — sin morado, consistente con el sistema BLARQ. */}
      {siiUnassignedCount > 0 && sp.projectId !== "sin-asignar" && (
        <Link
          href="/facturas?origin=sii_automatica&projectId=sin-asignar"
          className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-4 hover:border-gray-400 transition-colors"
        >
          <span className="text-gray-500 text-base leading-none">⚐</span>
          <p className="text-sm text-gray-900 flex-1">
            <span className="font-semibold">
              {siiUnassignedCount} factura{siiUnassignedCount > 1 ? "s" : ""} del SII
            </span>{" "}
            sin asignar a proyecto — asignalas para que cuenten en su Estado de
            Resultados.
          </p>
          <span className="text-xs text-gray-500 underline">Ver →</span>
        </Link>
      )}

      {/* Atajo a "notas de crédito sin clasificar" = plata a favor que todavía
          no se resolvió (efectivo / banco / aplicada a otra factura). Mismo
          estilo gris/mono que el banner de arriba. */}
      {ncSinClasificarCount > 0 && !sp.sinClasificar && (
        <Link
          href="/facturas?sinClasificar=1"
          className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-4 hover:border-gray-400 transition-colors"
        >
          <span className="text-gray-500 text-base leading-none">⚐</span>
          <p className="text-sm text-gray-900 flex-1">
            <span className="font-semibold">
              {ncSinClasificarCount} nota{ncSinClasificarCount > 1 ? "s" : ""} de
              crédito sin clasificar
            </span>{" "}
            — {formatCLP(ncSinClasificarTotal)} a favor. Clasificalas (efectivo,
            banco, o aplicar a otra factura).
          </p>
          <span className="text-xs text-gray-500 underline">Ver →</span>
        </Link>
      )}

      {/* En el celular los tres totales van en una fila compacta. Apilados
          ocupaban tres tarjetas altas antes de que apareciera la primera
          factura, que es a lo que se entra. */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
        <Stat
          label="Total"
          value={totalFacturas.toLocaleString("es-CL")}
          sub={
            invoices.length < totalFacturas
              ? `facturas · se listan ${invoices.length}`
              : "facturas"
          }
        />
        <Stat
          label="Emitido"
          value={formatCLP(totalEmitido)}
          sub={`neto ${formatCLP(totalEmitidoNeto)}`}
        />
        <Stat
          label="Recibido"
          value={formatCLP(totalRecibido)}
          sub={`neto ${formatCLP(totalRecibidoNeto)}`}
        />
      </div>

      <FacturasFilterBar
        projects={projects}
        categories={categories}
        conteos={{
          tipo: conteoTipo,
          estado: conteoEstado,
          documento: conteoDocumento,
        }}
        initial={{
          type: sp.type ?? "",
          status: sp.status ?? "",
          origin: sp.origin ?? "",
          projectId: sp.projectId ?? "",
          tipoDoc: sp.tipoDoc ?? "",
          categoryId: sp.categoryId ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
          q: sp.q ?? "",
          monto: sp.monto ?? "",
        }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-4">
        {invoices.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">No hay facturas que coincidan con los filtros.</p>
            <Link
              href="/facturas/nueva"
              className="inline-block mt-3 text-sm text-gray-900 underline"
            >
              Crear una factura
            </Link>
          </div>
        ) : (
          <FacturasTable
            projects={projects}
            categories={categories}
            invoices={invoices.map((inv) => ({
              id: inv.id,
              type: inv.type,
              tipoDoc: inv.tipoDoc,
              folioNumber: inv.folioNumber,
              issueDate: inv.issueDate.toISOString(),
              businessName: inv.businessName,
              // Van los dos: la lista muestra el RUT de la contraparte, que en
              // una emitida es el cliente (rutReceiver) y en una recibida el
              // proveedor (rutIssuer).
              rutIssuer: inv.rutIssuer,
              rutReceiver: inv.rutReceiver,
              totalAmount: inv.totalAmount,
              status: inv.status,
              origin: inv.origin,
              referenceFolioNumber: inv.referenceFolioNumber,
              referencedInvoiceId: referencedIdByNC.get(inv.id) ?? null,
              siiCodigo: inv.siiCodigo,
              project: inv.project ? { id: inv.project.id, name: inv.project.name } : null,
              category: inv.category ? { id: inv.category.id, name: inv.category.name } : null,
              autoMatched: inv.payments.some((p) => p.autoMatched),
              remaining: remainingOf(inv),
              // NC aplicadas a esta factura (folio + monto). Se muestran como
              // marca propia en la fila, aparte del estado (ver FacturasTable).
              ncApplied: ncAppliedByInvoice.get(inv.id) ?? [],
              // Modo de compensación (si es NC compensada) → badge "compensada".
              compensationType: inv.compensationType,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-4">
      <p className="text-[10px] md:text-xs uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="text-base md:text-xl font-bold text-gray-900 mt-1 tabular-nums break-words">
        {value}
      </p>
      <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 break-words">{sub}</p>
    </div>
  );
}
