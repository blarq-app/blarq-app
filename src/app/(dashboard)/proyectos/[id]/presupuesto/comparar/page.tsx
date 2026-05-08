import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { OBRA_CHAPTERS, ObraChapter, formatCLP } from "@/lib/utils";
import VersionPicker from "@/components/presupuesto/VersionPicker";

// Pantalla comparar 2 versiones de presupuesto Obra del mismo proyecto.
// Muestra partidas matcheadas por (chapter, name) lado a lado, resalta
// las que difieren en cantidad o total, y marca las que solo están en
// una versión. Útil cuando MJ cotiza 2 alternativas (ej. con/sin
// demolición) y quiere ver el delta.

type SearchParams = {
  a?: string; // budgetVersion id de la versión "izquierda"
  b?: string; // id de la "derecha"
};

function normName(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

function calcTotal(bv: {
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraItems: { total: number }[];
}) {
  const cd = bv.obraItems.reduce((s, i) => s + i.total, 0);
  const gg = cd * ((bv.ggPercentage ?? 0) / 100);
  const ut = cd * ((bv.utilityPercentage ?? 0) / 100);
  const neto = cd + gg + ut;
  const total = neto * 1.19;
  return { cd, gg, ut, neto, total };
}

export default async function CompararPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      budgetVersions: {
        where: { type: "obra" },
        orderBy: { date: "desc" },
        include: { obraItems: true },
      },
    },
  });
  if (!project) notFound();

  const versions = project.budgetVersions;
  if (versions.length < 2) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Comparar versiones</h1>
        <p className="text-sm text-gray-600">
          Necesitás al menos 2 versiones de Obra para comparar. Hoy hay {versions.length}.
        </p>
        <Link
          href={`/proyectos/${id}/presupuesto`}
          className="inline-block mt-4 text-sm text-gray-700 hover:text-gray-900 underline"
        >
          ← Volver a Presupuestos
        </Link>
      </div>
    );
  }

  // Defaults: las 2 versiones más recientes
  const aId = sp.a ?? versions[0].id;
  const bId = sp.b ?? versions[1]?.id ?? versions[0].id;
  const a = versions.find((v) => v.id === aId) ?? versions[0];
  const b = versions.find((v) => v.id === bId) ?? versions[1] ?? versions[0];

  const totA = calcTotal(a);
  const totB = calcTotal(b);

  // Indexar items por (chapter, name)
  const aMap = new Map<string, typeof a.obraItems[number]>();
  const bMap = new Map<string, typeof b.obraItems[number]>();
  for (const it of a.obraItems) aMap.set(`${it.chapter}|${normName(it.name)}`, it);
  for (const it of b.obraItems) bMap.set(`${it.chapter}|${normName(it.name)}`, it);

  // Construir filas comparadas: union de keys, ordenadas por capítulo y nombre
  const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);
  type Row = {
    chapter: string;
    name: string;
    a: typeof a.obraItems[number] | null;
    b: typeof b.obraItems[number] | null;
  };
  const rows: Row[] = [];
  for (const key of allKeys) {
    const [chapter, name] = key.split("|");
    rows.push({ chapter, name, a: aMap.get(key) ?? null, b: bMap.get(key) ?? null });
  }
  // Agrupar por capítulo (en orden cronológico), partidas alfabéticas adentro
  const chapterOrder = Object.keys(OBRA_CHAPTERS) as ObraChapter[];
  rows.sort((x, y) => {
    const cx = chapterOrder.indexOf(x.chapter as ObraChapter);
    const cy = chapterOrder.indexOf(y.chapter as ObraChapter);
    if (cx !== cy) return cx - cy;
    return x.name.localeCompare(y.name, "es");
  });

  // Subtotales por capítulo (cd) por versión
  const subA = new Map<string, number>();
  const subB = new Map<string, number>();
  for (const it of a.obraItems) subA.set(it.chapter, (subA.get(it.chapter) ?? 0) + it.total);
  for (const it of b.obraItems) subB.set(it.chapter, (subB.get(it.chapter) ?? 0) + it.total);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          href={`/proyectos/${id}/presupuesto`}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Presupuestos
        </Link>
        <VersionPicker
          projectId={id}
          versions={versions.map((v) => ({ id: v.id, version: v.version }))}
          aId={a.id}
          bId={b.id}
        />
      </div>

      {/* Totales generales */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Concepto</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{a.version}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{b.version}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <RowTotal label="Costo directo" a={totA.cd} b={totB.cd} />
            <RowTotal label={`GG (${a.ggPercentage ?? 0}% / ${b.ggPercentage ?? 0}%)`} a={totA.gg} b={totB.gg} />
            <RowTotal label={`Utilidad (${a.utilityPercentage ?? 0}% / ${b.utilityPercentage ?? 0}%)`} a={totA.ut} b={totB.ut} />
            <RowTotal label="Neto" a={totA.neto} b={totB.neto} />
            <tr className="border-t-2 border-gray-900 bg-gray-50">
              <td className="px-4 py-3 font-bold text-gray-900">Total c/IVA</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900">{formatCLP(totA.total)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900">{formatCLP(totB.total)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold">
                <DiffCell a={totA.total} b={totB.total} bold />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Comparación por partidas, agrupadas por capítulo */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-gray-900 bg-white">
            <tr>
              <th className="text-left px-3 py-1 text-[10px] font-bold text-gray-900 uppercase tracking-wider" style={{ width: "32%" }}>
                Partida
              </th>
              <th className="text-center px-2 py-1 text-[10px] font-bold text-gray-900 uppercase w-12">Un.</th>
              <th colSpan={2} className="text-center px-3 py-1 text-[10px] font-bold text-gray-900 uppercase border-l border-gray-200">{a.version}</th>
              <th colSpan={2} className="text-center px-3 py-1 text-[10px] font-bold text-gray-900 uppercase border-l border-gray-200">{b.version}</th>
              <th className="text-right px-3 py-1 text-[10px] font-bold text-gray-900 uppercase w-28 border-l border-gray-200">Δ Total</th>
            </tr>
            <tr className="bg-white border-b border-gray-300">
              <th></th>
              <th></th>
              <th className="text-right px-2 py-0.5 text-[9px] font-medium text-gray-500 uppercase border-l border-gray-200">Cant.</th>
              <th className="text-right px-3 py-0.5 text-[9px] font-medium text-gray-500 uppercase">Total</th>
              <th className="text-right px-2 py-0.5 text-[9px] font-medium text-gray-500 uppercase border-l border-gray-200">Cant.</th>
              <th className="text-right px-3 py-0.5 text-[9px] font-medium text-gray-500 uppercase">Total</th>
              <th className="border-l border-gray-200"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {chapterOrder.map((chKey) => {
              const chRows = rows.filter((r) => r.chapter === chKey);
              if (chRows.length === 0) return null;
              const ch = OBRA_CHAPTERS[chKey];
              const sa = subA.get(chKey) ?? 0;
              const sb = subB.get(chKey) ?? 0;
              return (
                <ChapterBlock
                  key={chKey}
                  label={ch.label}
                  rows={chRows}
                  subA={sa}
                  subB={sb}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowTotal({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <tr>
      <td className="px-4 py-2 text-gray-700">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatCLP(a)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatCLP(b)}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        <DiffCell a={a} b={b} />
      </td>
    </tr>
  );
}

function DiffCell({ a, b, bold }: { a: number; b: number; bold?: boolean }) {
  const d = b - a;
  if (Math.abs(d) < 1) return <span className="text-gray-400">—</span>;
  const pct = a !== 0 ? (d / a) * 100 : 0;
  const cls = d > 0 ? "text-red-600" : "text-green-700";
  return (
    <span className={`${cls} ${bold ? "font-bold" : ""}`}>
      {d > 0 ? "+" : ""}{formatCLP(d)} {a !== 0 && (
        <span className="text-xs opacity-70">({d > 0 ? "+" : ""}{pct.toFixed(0)}%)</span>
      )}
    </span>
  );
}

function ChapterBlock({
  label,
  rows,
  subA,
  subB,
}: {
  label: string;
  rows: { chapter: string; name: string; a: { quantity: number; total: number; unit: string } | null; b: { quantity: number; total: number; unit: string } | null }[];
  subA: number;
  subB: number;
}) {
  return (
    <>
      <tr className="bg-gray-200">
        <td colSpan={2} className="px-4 py-1 font-bold text-xs text-gray-900 uppercase tracking-wide">
          {label}
        </td>
        <td colSpan={2} className="px-3 py-1 text-right text-xs font-medium text-gray-700 tabular-nums border-l border-gray-300">
          {formatCLP(subA)}
        </td>
        <td colSpan={2} className="px-3 py-1 text-right text-xs font-medium text-gray-700 tabular-nums border-l border-gray-300">
          {formatCLP(subB)}
        </td>
        <td className="px-3 py-1 text-right text-xs font-medium tabular-nums border-l border-gray-300">
          <DiffCell a={subA} b={subB} bold />
        </td>
      </tr>
      {rows.map((r, i) => {
        const onlyA = r.a && !r.b;
        const onlyB = !r.a && r.b;
        const qtyDiff = r.a && r.b && Math.abs(r.a.quantity - r.b.quantity) > 0.001;
        const rowCls = onlyA
          ? "bg-amber-50"
          : onlyB
          ? "bg-blue-50"
          : qtyDiff
          ? "bg-yellow-50"
          : "";
        const unit = r.a?.unit ?? r.b?.unit ?? "";
        return (
          <tr key={`${r.chapter}-${r.name}-${i}`} className={rowCls}>
            <td className="px-3 py-0.5 text-xs uppercase">
              {r.name}
              {onlyA && <span className="ml-2 text-[9px] text-amber-700 font-medium">solo en {/* version a */}izquierda</span>}
              {onlyB && <span className="ml-2 text-[9px] text-blue-700 font-medium">solo en derecha</span>}
            </td>
            <td className="px-2 py-0.5 text-center text-xs text-gray-600">{unit}</td>
            <td className="px-2 py-0.5 text-right text-xs tabular-nums border-l border-gray-200">
              {r.a ? r.a.quantity.toLocaleString("es-CL") : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-3 py-0.5 text-right text-xs tabular-nums">
              {r.a ? formatCLP(r.a.total) : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-2 py-0.5 text-right text-xs tabular-nums border-l border-gray-200">
              {r.b ? r.b.quantity.toLocaleString("es-CL") : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-3 py-0.5 text-right text-xs tabular-nums">
              {r.b ? formatCLP(r.b.total) : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-3 py-0.5 text-right text-xs tabular-nums border-l border-gray-200">
              <DiffCell a={r.a?.total ?? 0} b={r.b?.total ?? 0} />
            </td>
          </tr>
        );
      })}
    </>
  );
}
