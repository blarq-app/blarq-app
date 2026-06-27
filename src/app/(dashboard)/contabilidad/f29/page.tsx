import Link from "next/link";
import {
  computeF29Year,
  getF29AvailableYears,
  type F29Mes,
} from "@/lib/contabilidad/f29";
import { formatCLP } from "@/lib/utils";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default async function F29Page({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const years = await getF29AvailableYears();
  const year =
    sp.year && years.includes(Number(sp.year))
      ? Number(sp.year)
      : years[0] ?? new Date().getUTCFullYear();

  const meses = await computeF29Year(year);

  // Mes por defecto: el último con movimiento (débito o crédito).
  const ultimoConDatos = [...meses]
    .reverse()
    .find((m) => m.totalDebito !== 0 || m.totalCredito !== 0);
  const month =
    sp.month && Number(sp.month) >= 1 && Number(sp.month) <= 12
      ? Number(sp.month)
      : ultimoConDatos?.month ?? 1;

  const mes = meses[month - 1];

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">F29 del mes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Declaración mensual de impuestos, calculada en vivo desde tus facturas.
        </p>
      </div>

      {/* Selector de año */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400">Año</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/contabilidad/f29?year=${y}`}
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

      {/* Selector de mes */}
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 mb-6">
        {meses.map((m) => {
          const tieneDatos = m.totalDebito !== 0 || m.totalCredito !== 0;
          const activo = m.month === month;
          return (
            <Link
              key={m.month}
              href={`/contabilidad/f29?year=${year}&month=${m.month}`}
              className={`text-center py-1.5 rounded text-xs font-medium transition-colors ${
                activo
                  ? "bg-gray-900 text-white"
                  : tieneDatos
                    ? "text-gray-700 hover:bg-gray-100"
                    : "text-gray-300 hover:bg-gray-50"
              }`}
              title={MESES[m.month - 1]}
            >
              {MESES[m.month - 1].slice(0, 3)}
            </Link>
          );
        })}
      </div>

      {/* Cuerpo del F29 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            {MESES[month - 1]} {year}
          </h2>
          <span className="text-xs text-gray-400 tabular-nums">
            {mes.countVentas} ventas · {mes.countCompras} compras
          </span>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Débitos — IVA de ventas */}
          <Bloque titulo="IVA de ventas (débito)">
            <Linea codigo="502" glosa="IVA facturas emitidas" valor={mes.debitoVentas} />
            {mes.debitoNotasCredito > 0 && (
              <Linea
                codigo="510"
                glosa="IVA notas de crédito emitidas"
                valor={-mes.debitoNotasCredito}
              />
            )}
            <Linea codigo="538" glosa="Total débitos" valor={mes.totalDebito} strong />
          </Bloque>

          {/* Créditos — IVA de compras */}
          <Bloque titulo="IVA de compras (crédito)">
            <Linea codigo="520" glosa="IVA facturas recibidas" valor={mes.creditoCompras} />
            {mes.creditoNotasCredito > 0 && (
              <Linea
                codigo="528"
                glosa="IVA notas de crédito recibidas"
                valor={-mes.creditoNotasCredito}
              />
            )}
            <Linea codigo="537" glosa="Total créditos" valor={mes.totalCredito} strong />
          </Bloque>

          {/* IVA determinado + remanente */}
          <Bloque titulo="IVA del mes">
            <Linea
              codigo="089"
              glosa="IVA determinado (débito − crédito)"
              valor={mes.ivaDeterminado}
            />
            {mes.remanenteAnterior > 0 && (
              <Linea
                glosa="Remanente del mes anterior"
                valor={-mes.remanenteAnterior}
              />
            )}
            {mes.remanenteSiguiente > 0 ? (
              <Linea
                glosa="Remanente a favor (pasa al mes siguiente)"
                valor={mes.remanenteSiguiente}
                tone="credito"
                strong
              />
            ) : (
              <Linea glosa="IVA a pagar" valor={mes.ivaAPagar} strong />
            )}
          </Bloque>

          {/* PPM */}
          <Bloque titulo="PPM (pago provisional)">
            <Linea
              codigo="062"
              glosa={`PPM — ${(mes.ppmRate * 100).toLocaleString("es-CL")}% de las ventas`}
              valor={mes.ppm}
            />
          </Bloque>

          {/* Impuesto único de los sueldos */}
          <Bloque titulo="Sueldos">
            <Linea
              codigo="048"
              glosa="Impuesto único de los sueldos"
              valor={mes.impuestoUnicoPendiente ? null : mes.impuestoUnico}
              note={
                mes.impuestoUnicoPendiente
                  ? "falta cargar las remuneraciones del mes"
                  : undefined
              }
            />
          </Bloque>

          {/* Pendiente de otra etapa */}
          <Bloque titulo="Pendiente (otra etapa del módulo)">
            <Linea
              glosa="Retención de honorarios"
              valor={null}
              note="cuando sumemos boletas de honorarios"
            />
          </Bloque>
        </div>

        {/* Total */}
        <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 flex items-baseline justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Total a pagar</p>
            <p className="text-xs text-gray-400">
              {mes.impuestoUnicoPendiente
                ? "IVA a pagar + PPM (sin impuesto único todavía)"
                : "IVA a pagar + PPM + impuesto único de sueldos"}
            </p>
          </div>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {formatCLP(mes.totalAPagar)}
          </p>
        </div>
      </div>

      {/* Nota de validación */}
      <p className="text-xs text-gray-400 mt-3 leading-relaxed">
        Calculado en vivo desde las facturas de compra y venta, y el impuesto
        único de las liquidaciones de sueldo. Validado al peso contra el F29 real
        del SII (abril y mayo 2026). Falta solo la retención de honorarios, que
        depende de la etapa de boletas de honorarios.
      </p>
    </div>
  );
}

function Bloque({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
        {titulo}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Linea({
  codigo,
  glosa,
  valor,
  strong = false,
  tone = "default",
  note,
}: {
  codigo?: string;
  glosa: string;
  valor: number | null;
  strong?: boolean;
  tone?: "default" | "credito";
  note?: string;
}) {
  const valorClass =
    "tabular-nums " +
    (valor === null
      ? "text-gray-300"
      : tone === "credito"
        ? "text-emerald-700"
        : "text-gray-900") +
    (strong ? " font-semibold" : "");

  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="flex items-baseline gap-2 min-w-0">
        {codigo && (
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0 w-7">
            {codigo}
          </span>
        )}
        <span className={strong ? "font-medium text-gray-900" : "text-gray-600"}>
          {glosa}
        </span>
        {note && <span className="text-xs text-gray-400 italic">— {note}</span>}
      </span>
      <span className={valorClass}>
        {valor === null
          ? "pendiente"
          : valor < 0
            ? `−${formatCLP(-valor)}`
            : formatCLP(valor)}
      </span>
    </div>
  );
}
