import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import {
  EditableCategoryCell,
  EditableProjectCell,
  type CategoryOption,
  type ProjectOption,
} from "@/components/facturas/EditableInvoiceFields";
import GastoAttachmentCell from "@/components/contabilidad/GastoAttachmentCell";
import DescargarPDFMes from "@/components/contabilidad/DescargarPDFMes";

// Contabilidad → Gastos.
//
// Repositorio de los GASTOS DE LA EMPRESA sin documento del SII: boletas
// (origin=gasto_boleta) y gastos internacionales (origin=gasto_internacional).
// Son Invoice type=recibida, tipoDoc=1043 — el mismo registro con el que ya
// cuentan como costo en su obra o en BLARQ (ver metrics.ts: facturasRecibidas
// no excluye 1043). Acá NO se recalcula plata: solo se listan y se cataloga
// (obra/categoría) con el mismo criterio que Facturas.
//
// Objetivo (MJ): verlos todos, por mes, para después adjuntar la foto (Parte 2),
// bajar un PDF mensual (Parte 3) y armar el informe anual F22 (Parte 4). Esta
// página es la Parte 1: la lista + el mes + los totales + edición inline.
//
// "Pago sin respaldo" (origin=sin_respaldo, pago a maestro sin ningún
// documento) NO entra acá: no hay boleta que declarar. Solo boleta e
// internacional, que son los que van al F22.

type SearchParams = { mes?: string };

// Nombre del mes en español para el encabezado.
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Parsear ?mes=YYYY-MM → { año, mes(0-11) }. Sin parámetro o inválido → mes
// actual. Los límites del mes se construyen en UTC (ver abajo), no en local.
function parseMes(raw: string | undefined): { year: number; month: number } {
  const m = raw?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month >= 0 && month <= 11) return { year, month };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function fmtMesParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { year, month } = parseMes(sp.mes);
  // Límites en UTC: las fechas de los gastos se guardan como día calendario a
  // medianoche UTC. Con límites en hora local (UTC-4), un gasto del día 1 caería
  // en el mes anterior. UTC alinea el filtro con lo guardado (mismo criterio que
  // listarGastosDelMes, el que usa el PDF).
  const inicio = new Date(Date.UTC(year, month, 1));
  const finExclusivo = new Date(Date.UTC(year, month + 1, 1));

  const mesParam = fmtMesParam(year, month);

  const [gastos, projectsRaw, categoriesRaw, todosLosGastos] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        type: "recibida",
        origin: { in: ["gasto_boleta", "gasto_internacional"] },
        issueDate: { gte: inicio, lt: finExclusivo },
      },
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        issueDate: true,
        businessName: true,
        rutIssuer: true,
        totalAmount: true,
        origin: true,
        notes: true,
        attachmentUrl: true,
        projectId: true,
        categoryId: true,
        project: { select: { id: true, name: true, numeroProyecto: true } },
        category: {
          select: { id: true, name: true, parent: { select: { name: true } } },
        },
      },
    }),
    // Proyectos asignables (mismo criterio que banco/facturas: se esconden las
    // cotizaciones no ganadas; los centros internos como BLARQ se mantienen).
    prisma.project.findMany({
      where: { NOT: { status: "cotizacion", isInternal: false } },
      select: { id: true, name: true, numeroProyecto: true },
      orderBy: { numeroProyecto: { sort: "asc", nulls: "last" } },
    }),
    // Categorías que aplican a documentos recibidos.
    prisma.costCategory.findMany({
      where: { appliesTo: { in: ["recibida", "both"] } },
      select: {
        id: true,
        name: true,
        parentId: true,
        parent: { select: { name: true } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    // Solo las fechas de TODOS los gastos, para armar el selector: qué años
    // tienen gastos y, dentro del año elegido, qué meses tienen (para agrisar
    // los vacíos como en el F29). Son pocos registros, traer las fechas es barato.
    prisma.invoice.findMany({
      where: {
        type: "recibida",
        origin: { in: ["gasto_boleta", "gasto_internacional"] },
      },
      select: { issueDate: true },
    }),
  ]);

  // Años con gastos (en UTC, igual que el filtro), siempre incluyendo el año en
  // curso, de más nuevo a más viejo.
  const añosConDatos = new Set(todosLosGastos.map((g) => g.issueDate.getUTCFullYear()));
  añosConDatos.add(new Date().getUTCFullYear());
  añosConDatos.add(year); // el que se esté mirando, aunque no tenga gastos
  const years = [...añosConDatos].sort((a, b) => b - a);

  // Meses (1-12) del año elegido que tienen al menos un gasto.
  const mesesConDatos = new Set(
    todosLosGastos
      .filter((g) => g.issueDate.getUTCFullYear() === year)
      .map((g) => g.issueDate.getUTCMonth() + 1)
  );

  const projectOptions: ProjectOption[] = projectsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    numeroProyecto: p.numeroProyecto,
  }));
  const categoryOptions: CategoryOption[] = categoriesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    appliesTo: "recibida",
  }));

  // Totales del mes. Estos gastos se registran con IVA=0 (boleta/internacional
  // no dan crédito recuperable), así que totalAmount = el costo completo. El
  // desglose "boletas / internacionales" agrupa por tipo, no por un IVA
  // separado (que no existe en estos registros).
  const totalMes = gastos.reduce((s, g) => s + g.totalAmount, 0);
  const totalBoletas = gastos
    .filter((g) => g.origin === "gasto_boleta")
    .reduce((s, g) => s + g.totalAmount, 0);
  const totalInternacionales = gastos
    .filter((g) => g.origin === "gasto_internacional")
    .reduce((s, g) => s + g.totalAmount, 0);

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gastos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gastos de la empresa sin documento del SII (boletas, internacionales)
            — para respaldar y declarar en el F22.
          </p>
        </div>
        {/* Respaldo del mes: la planilla + la foto de cada boleta. Es el
            archivo que se le pasa al contador o se guarda para el F22. */}
        <DescargarPDFMes mes={mesParam} deshabilitado={gastos.length === 0} />
      </div>

      {/* Selector de año (mismo patrón que el F29). */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400">Año</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/contabilidad/gastos?mes=${fmtMesParam(y, month)}`}
            className={`px-2.5 py-1 rounded text-sm font-medium tabular-nums transition-colors ${
              y === year
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      {/* Selector de mes: los que no tienen gastos quedan en gris (como el F29). */}
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 mb-6">
        {MESES.map((nombre, i) => {
          const m = i + 1;
          const activo = i === month;
          const tieneDatos = mesesConDatos.has(m);
          return (
            <Link
              key={m}
              href={`/contabilidad/gastos?mes=${fmtMesParam(year, i)}`}
              className={`text-center py-1.5 rounded text-xs font-medium transition-colors ${
                activo
                  ? "bg-gray-900 text-white"
                  : tieneDatos
                    ? "text-gray-700 hover:bg-gray-100"
                    : "text-gray-300 hover:bg-gray-50"
              }`}
              title={nombre}
            >
              {nombre.slice(0, 3)}
            </Link>
          );
        })}
      </div>

      {/* Totales del mes. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Tile label="Total del mes" value={formatCLP(totalMes)} strong />
        <Tile label="Boletas (con IVA)" value={formatCLP(totalBoletas)} />
        <Tile label="Internacionales (sin IVA)" value={formatCLP(totalInternacionales)} />
        <Tile label="Gastos" value={String(gastos.length)} />
      </div>

      {gastos.length === 0 ? (
        <div className="border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">
            No hay gastos en {MESES[month]} {year}.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Se registran desde el banco: marcá un cargo como boleta o gasto
            internacional en la columna Respaldo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-200">
                <Th>Fecha</Th>
                <Th>Emisor</Th>
                <Th>Tipo</Th>
                <Th>Categoría</Th>
                <Th>Obra</Th>
                <Th right>Monto</Th>
                <Th>IVA</Th>
                <Th>Comprobante</Th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => {
                const esBoleta = g.origin === "gasto_boleta";
                const categoryName = g.category
                  ? g.category.parent
                    ? `${g.category.parent.name} / ${g.category.name}`
                    : g.category.name
                  : null;
                const projectName = g.project
                  ? g.project.numeroProyecto != null
                    ? `${g.project.numeroProyecto} · ${g.project.name}`
                    : g.project.name
                  : null;
                return (
                  <tr
                    key={g.id}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">
                      {g.issueDate.toLocaleDateString("es-CL", { timeZone: "UTC" })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-gray-900">
                        {g.businessName ?? (
                          <span className="text-gray-400 italic">sin nombre</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          esBoleta
                            ? "bg-slate-100 text-slate-700"
                            : "bg-indigo-50 text-indigo-700"
                        }`}
                      >
                        {esBoleta ? "Boleta" : "Internacional"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <EditableCategoryCell
                        invoiceId={g.id}
                        invoiceType="recibida"
                        currentCategoryId={g.categoryId}
                        currentCategoryName={categoryName}
                        options={categoryOptions}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <EditableProjectCell
                        invoiceId={g.id}
                        currentProjectId={g.projectId}
                        currentProjectName={projectName}
                        options={projectOptions}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums whitespace-nowrap">
                      {formatCLP(g.totalAmount)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          esBoleta
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {esBoleta ? "Con IVA" : "Sin IVA"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <GastoAttachmentCell
                        invoiceId={g.id}
                        attachmentUrl={g.attachmentUrl}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4 leading-relaxed">
        La obra es opcional (dejala sin asignar cuando el gasto es de BLARQ en
        general). Estos gastos ya cuentan como costo de su obra o de BLARQ.
        &quot;Respaldo del mes&quot; baja la planilla con la foto de cada boleta,
        listo para el contador. Próximo: el informe anual F22.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wider text-gray-400">{label}</p>
      <p
        className={`tabular-nums mt-0.5 ${
          strong ? "text-lg font-semibold text-gray-900" : "text-sm text-gray-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium whitespace-nowrap ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
