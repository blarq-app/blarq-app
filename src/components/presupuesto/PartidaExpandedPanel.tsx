"use client";

// Panel que se abre al expandir una partida del presupuesto.
//
// Layout DENSO: descripciones cliente/maestro lado a lado con letra chica e
// interlineado apretado, los 6 rubros de costo en una fila compacta, los
// botones de catálogo, y la tabla de "Detalle de materiales y costos" (densa).
// Objetivo: mantener TODA la info de la partida ocupando el menor alto posible
// (referencia: la planilla maestra de MJ). Reemplazó a la versión apilada que
// ocupaba ~918px → este panel ronda los ~490px.

import { useState } from "react";
import { formatCLP } from "@/lib/utils";
import MoneyInput from "@/components/ui/MoneyInput";
import RichTextEditor from "@/components/presupuesto/RichTextEditor";
import ObraItemComponentsEditor from "@/components/presupuesto/ObraItemComponentsEditor";
import GuardarAlCatalogoButton from "@/components/presupuesto/GuardarAlCatalogoButton";

// Solo los campos que el panel necesita de la partida.
export interface PanelItem {
  id: string;
  name: string;
  descriptionCliente: string | null;
  descriptionMaestro: string | null;
  costMaterial: number | null;
  costLabor: number | null;
  costSubcontract: number | null;
  costMargin: number | null;
  costTools: number | null;
  costLoss: number | null;
  catalogPartidaId: string | null;
}

type SaveStatus = "idle" | "saving" | "saved";

interface Props {
  item: PanelItem;
  saveStatus: SaveStatus;
  budgetId: string;
  canEdit: boolean;
  // Cantidad de componentes que tiene la partida al abrir el panel (viene del
  // dato cargado en ObraEditor). Define si mostramos o no la fila de totales.
  initialComponentCount: number;
  onUpdate: (field: string, value: string | number) => void;
  onUpdateCatalog: () => void;
  onUpdateCatalogDescription: () => void;
  onComponentsChanged: () => void;
  // Tras guardar una partida nueva al catálogo: el editor recarga la partida
  // para que quede con su catalogPartidaId y aparezcan los botones de siempre.
  onSavedToCatalog: (catalogPartidaId: string) => void;
}

// Los 6 rubros del desglose de costo de la partida (por unidad).
const COSTS: [string, keyof PanelItem][] = [
  ["Material", "costMaterial"],
  ["Mano de obra", "costLabor"],
  ["Herramientas", "costTools"],
  ["Subcontrato", "costSubcontract"],
  ["Pérdida", "costLoss"],
  ["Margen", "costMargin"],
];

function sumaDesglose(i: PanelItem) {
  return (
    (i.costMaterial ?? 0) +
    (i.costLabor ?? 0) +
    (i.costSubcontract ?? 0) +
    (i.costMargin ?? 0) +
    (i.costTools ?? 0) +
    (i.costLoss ?? 0)
  );
}

function SaveHint({ status }: { status: SaveStatus }) {
  if (status === "saving")
    return <span className="text-[10px] text-gray-400 animate-pulse">guardando…</span>;
  if (status === "saved")
    return <span className="text-[10px] text-green-600">guardado</span>;
  return null;
}

export default function PartidaExpandedPanel(p: Props) {
  const { item } = p;
  // Cantidad de componentes en vivo (la reporta el editor de detalle). Cuando
  // la partida YA tiene desglose, los montos de la fila de totales son un
  // ESPEJO derivado de esos componentes (recalcObraItemFromComponents) — así
  // que la ocultamos por redundante. Solo la mostramos cuando NO hay desglose:
  // ahí esa fila es el único lugar para cargar los costos a mano.
  const [compCount, setCompCount] = useState(p.initialComponentCount);
  const showLumpRow = compCount === 0;
  return (
    <div className="px-4 py-1.5 space-y-1">
      {/* Solo la descripción para el MAESTRO (la que el cliente NO ve, va al
          estado de pago). La del cliente se edita inline arriba, en la fila. */}
      <DescBlock
        label="Descripción para el maestro"
        hint="— estado de pago · el cliente no la ve"
        value={item.descriptionMaestro}
        placeholder="Alcance para el maestro…"
        onChange={(html) => p.onUpdate("descriptionMaestro", html)}
      />

      {/* Fila de costos por unidad (6 rubros + suma). SOLO cuando la partida
          no tiene desglose: ahí es donde se cargan los costos a mano. Si hay
          desglose abajo, esta fila sería un espejo derivado (redundante) y se
          oculta. */}
      {showLumpRow && (
        <div className="grid grid-cols-4 md:grid-cols-7 gap-1.5 text-[11px]">
          {COSTS.map(([label, field]) => (
            <label key={field} className="flex flex-col">
              <span className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500">{label}</span>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[11px]">$</span>
                <MoneyInput
                  value={(item[field] as number | null) ?? 0}
                  onChange={(val) => p.onUpdate(field, val)}
                  className="w-full border border-gray-300 rounded pl-4 pr-1.5 py-0.5 text-right text-[11px]"
                />
              </div>
            </label>
          ))}
          <div className="flex flex-col justify-end">
            <span className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
              Suma <SaveHint status={p.saveStatus} />
            </span>
            <span className="text-gray-900 font-semibold py-0.5 text-right tabular-nums text-xs">
              {formatCLP(sumaDesglose(item))}
            </span>
          </div>
        </div>
      )}

      <CatalogButtons {...p} />

      {/* Desglose por componente — editable si el presupuesto está en borrador. */}
      <div className="pt-1.5 border-t border-gray-200">
        <ObraItemComponentsEditor
          budgetId={p.budgetId}
          itemId={item.id}
          canEdit={p.canEdit}
          catalogPartidaId={item.catalogPartidaId}
          onChanged={p.onComponentsChanged}
          onCountChange={setCompCount}
          dense
        />
      </div>
    </div>
  );
}

function DescBlock({
  label, hint, value, placeholder, onChange,
}: {
  label: string; hint: string; value: string | null;
  placeholder: string; onChange: (html: string) => void;
}) {
  // Achicamos la letra del editor (9px, más chica que el resto del panel),
  // apretamos el interlineado y bajamos el alto mínimo, SIN tocar
  // RichTextEditor. La barra de formato ya no es fija (es un BubbleMenu
  // flotante que aparece al seleccionar texto, PR #80), así que no hay nada
  // de toolbar que achicar acá.
  const editorClass =
    "[&_.ProseMirror]:!text-[9px] [&_.ProseMirror]:!leading-[1.25] " +
    "[&_.ProseMirror]:!min-h-[22px] [&_.ProseMirror]:!py-0.5 [&_.ProseMirror]:!px-2 " +
    "[&_.ProseMirror_p]:!my-0 [&_.ProseMirror_li]:!my-0";
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-0.5">
        {label}
        <span className="ml-2 text-gray-400 normal-case font-normal italic">{hint}</span>
      </label>
      <div className={editorClass}>
        <RichTextEditor value={value} onChange={onChange} placeholder={placeholder} />
      </div>
    </div>
  );
}

function CatalogButtons(p: Props) {
  // Partida armada de cero en esta cotización: todavía no tiene molde. Lo único
  // que se ofrece es CREARLO. Los botones de abajo actualizan un molde que
  // existe, así que acá no aplican.
  if (!p.item.catalogPartidaId) {
    return (
      <GuardarAlCatalogoButton
        budgetId={p.budgetId}
        itemId={p.item.id}
        itemName={p.item.name}
        canEdit={p.canEdit}
        onSaved={p.onSavedToCatalog}
      />
    );
  }
  return (
    <div className="flex justify-end gap-2">
      {/* Abrir ESTA partida en el Catálogo de Partidas, en pestaña nueva, para
          editar la receta MAESTRA (la que se usa en próximos proyectos), NO la
          copia de este presupuesto. La etiqueta lo deja claro. */}
      <a
        href={`/catalogo/partidas?focus=${p.item.catalogPartidaId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
        title="Abre la partida en el Catálogo (pestaña nueva). Editás la receta maestra para los próximos proyectos, no esta cotización."
      >
        Editar en catálogo ↗
      </a>
      <button
        onClick={p.onUpdateCatalogDescription}
        className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
        title="Guardar esta descripción en el catálogo + propagar a cotizaciones en borrador (no toca enviadas/aprobadas ni las que editaste a mano)"
      >
        ↑ Descripción a catálogo + borradores
      </button>
      <button
        onClick={p.onUpdateCatalog}
        className="text-xs text-orange-600 hover:text-orange-800 border border-orange-200 hover:border-orange-400 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
        title="Propagar estos precios al catálogo + cotizaciones en borrador (no toca enviadas/aprobadas ni las que editaste a mano)"
      >
        ↑ Precios a catálogo + borradores
      </button>
    </div>
  );
}
