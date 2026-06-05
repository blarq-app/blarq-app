"use client";

import { useState, useEffect, useRef, Fragment, useCallback } from "react";
import { useRouter } from "next/navigation";
import { OBRA_CHAPTERS, ObraChapter, formatCLP } from "@/lib/utils";
import MoneyInput from "@/components/ui/MoneyInput";
import BudgetAuditBanner from "@/components/presupuesto/BudgetAuditBanner";
import ObraItemComponentsEditor from "@/components/presupuesto/ObraItemComponentsEditor";
import CostoDirectoDetalle from "@/components/presupuesto/CostoDirectoDetalle";
import PartidaExpandedPanel from "@/components/presupuesto/PartidaExpandedPanel";
import { sanitizeRichTextHtml, isRichTextEmpty } from "@/lib/richText";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Props que SortableRow le pasa a la fila (via render-prop) para enganchar
// el arrastre: ref del nodo, estilo con el transform de dnd-kit, y los
// listeners que van SOLO en la manija (no en toda la fila, para no pelear
// con los textareas/botones editables de cada celda).
type SortableReturn = ReturnType<typeof useSortable>;
type DragHandle = {
  setNodeRef: SortableReturn["setNodeRef"];
  style: React.CSSProperties;
  attributes: SortableReturn["attributes"];
  listeners: SortableReturn["listeners"];
  isDragging: boolean;
};

// Envoltorio que llama useSortable (un hook → necesita ser componente) y le
// entrega al hijo lo necesario para arrastrar. Se usa como render-prop para
// no tener que extraer la fila gigante de la partida fuera de ObraEditor
// (así sigue cerrando sobre todos los handlers del editor).
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (drag: DragHandle) => React.ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // La fila que se arrastra se atenúa; el "fantasma" que sigue al cursor
    // lo dibuja el DragOverlay aparte.
    opacity: isDragging ? 0.4 : 1,
  };
  return <>{children({ setNodeRef, style, attributes, listeners, isDragging })}</>;
}

// Versión "plana" de la fila para el render del servidor y la primera
// hidratación: NO llama useSortable, así que NO emite los atributos de
// dnd-kit (aria-describedby con un contador interno que difiere entre
// servidor y cliente y genera un warning de hidratación). Una vez montado
// en el cliente, ObraEditor cambia a SortableRow y el arrastre se activa.
function PlainRow({
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (drag: DragHandle) => React.ReactNode;
}) {
  return (
    <>
      {children({
        setNodeRef: () => {},
        style: {},
        attributes: {} as DragHandle["attributes"],
        listeners: undefined,
        isDragging: false,
      })}
    </>
  );
}

interface ObraItemComponent {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  materialId: string | null;
}

interface ObraItem {
  id: string;
  chapter: string;
  subChapter: string | null;
  itemNumber: string;
  name: string;
  descriptionCliente: string | null;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  costMaterial: number | null;
  costLabor: number | null;
  costSubcontract: number | null;
  costMargin: number | null;
  costTools: number | null;
  costLoss: number | null;
  sortOrder: number;
  catalogPartidaId: string | null;
  components?: ObraItemComponent[];
}

interface PaymentTerm {
  id: string;
  stage: string;
  percentage: number;
  amount: number | null;
  sortOrder: number;
}

interface Budget {
  id: string;
  version: string;
  status: string;
  type: string;
  observations: string | null;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraItems: ObraItem[];
  paymentTerms: PaymentTerm[];
}

interface CatalogProvision {
  componentId: string;
  name: string;
  unitCost: number;   // neto de referencia del catálogo
  quantity: number;   // qty por unidad de partida (ej: 1.05 m2 porcelanato / m2 piso)
}

interface CatalogPartida {
  id: string;
  category: string;
  name: string;
  descriptionCliente: string | null;
  descriptionMaestro: string | null;
  unit: string;
  unitPrice: number;
  costMaterial: number;
  costLabor: number;
  costTools: number;
  costMargin: number;
  costLoss: number;
  costSubcontract: number;
  provisions: CatalogProvision[];
}

const UNITS = ["M2", "ML", "UN", "GL", "M3", "KG", "DIA"];

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 40 },
  { stage: "Avance 1", percentage: 25 },
  { stage: "Avance 2", percentage: 25 },
  { stage: "Saldo final", percentage: 10 },
];

export default function ObraEditor({
  budget: initialBudget,
  projectId,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ObraItem[]>(initialBudget.obraItems);
  const [ggPercent, setGgPercent] = useState(initialBudget.ggPercentage || 20);
  const [utilPercent, setUtilPercent] = useState(
    initialBudget.utilityPercentage || 5
  );
  const [observations, setObservations] = useState(
    initialBudget.observations || ""
  );
  const [paymentTerms, setPaymentTerms] = useState<
    { stage: string; percentage: number }[]
  >(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        }))
      : DEFAULT_PAYMENT_TERMS
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ itemId: string; item: ObraItem } | null>(null);
  const [addingChapter, setAddingChapter] = useState<string | null>(null);
  // Capítulos vacíos que el usuario "habilitó" explícitamente para que se
  // muestren aunque no tengan items. Se vacía cuando el usuario pone un
  // ítem dentro (ya no necesita el flag — el chapter se muestra solo).
  const [enabledEmptyChapters, setEnabledEmptyChapters] = useState<Set<string>>(new Set());
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  // Provision price overrides: componentId → precio c/IVA ingresado por usuario
  const [provisionPrices, setProvisionPrices] = useState<Record<string, number>>({});
  // Edición inline de zona (subChapter) — por fila individual o por grupo
  // (renombrar la "bandita" gris renombra todas las partidas del grupo).
  const [editingZoneItemId, setEditingZoneItemId] = useState<string | null>(null);
  const [editingZoneGroup, setEditingZoneGroup] = useState<{ chapter: string; name: string } | null>(null);
  const [zoneDraft, setZoneDraft] = useState("");
  // Selección múltiple para asignar zona en bulk. MJ habilita checkbox por
  // fila, selecciona varias y aplica una zona desde la barra flotante.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkZoneDraft, setBulkZoneDraft] = useState("");
  // Arrastre de partidas (orden manual). activeDragId = id de la fila que se
  // está arrastrando, para dibujar el "fantasma" (DragOverlay) que sigue al
  // cursor. distance:6 = hay que mover 6px antes de iniciar el arrastre, así
  // un click simple en la manija no dispara drag y no pelea con la edición.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // El arrastre se monta solo en el cliente (evita el warning de hidratación
  // de dnd-kit, ver PlainRow). En SSR y primera hidratación: filas planas.
  const [dndMounted, setDndMounted] = useState(false);
  useEffect(() => setDndMounted(true), []);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Catalog search state
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogPartida[]>([]);
  const [searchingCatalog, setSearchingCatalog] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogPartida | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // Visibilidad del dropdown de resultados del buscador de catálogo. Se separa
  // de catalogQuery/catalogResults para poder CERRAR el dropdown al hacer click
  // afuera SIN borrar lo que MJ escribió. (fix: el dropdown "No se encontraron
  // partidas" quedaba pegado porque el click-afuera solo limpiaba resultados.)
  const [showCatalogDropdown, setShowCatalogDropdown] = useState(false);
  // Ref del dropdown "+ Capítulo" para cerrarlo al hacer click afuera.
  const chapterPickerRef = useRef<HTMLDivElement>(null);

  // New item state (for both catalog-selected and manual)
  const [newItem, setNewItem] = useState({
    name: "",
    descriptionCliente: "",
    descriptionMaestro: "",
    unit: "GL",
    quantity: 0,
    unitPrice: 0,
  });

  // Search catalog with debounce
  useEffect(() => {
    if (!catalogQuery || catalogQuery.length < 2) {
      setCatalogResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingCatalog(true);
      try {
        const res = await fetch(
          `/api/catalogo/partidas?q=${encodeURIComponent(catalogQuery)}&limit=15`
        );
        const data = await res.json();
        setCatalogResults(data);
      } catch {
        setCatalogResults([]);
      } finally {
        setSearchingCatalog(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [catalogQuery]);

  // Cerrar los dropdowns al hacer click afuera: el buscador de catálogo y el
  // picker "+ Capítulo". Un solo handler chequea ambos refs.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) {
        setShowCatalogDropdown(false);
      }
      if (
        chapterPickerRef.current &&
        !chapterPickerRef.current.contains(target)
      ) {
        setShowChapterPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculos
  const costoDirecto = items.reduce((sum, item) => sum + item.total, 0);
  const gastosGenerales = costoDirecto * (ggPercent / 100);
  const utilidad = costoDirecto * (utilPercent / 100);
  const neto = costoDirecto + gastosGenerales + utilidad;
  const iva = neto * 0.19;
  const totalConIva = neto + iva;

  // Agrupar por capitulo
  const chapters = Object.entries(OBRA_CHAPTERS) as [
    ObraChapter,
    { label: string; index: number }
  ][];
  // Orden interno: alfabético por nombre (regla MJ 2026-05-08).
  // El orden de los capítulos sigue siendo por etapa cronológica (definido
  // en OBRA_CHAPTERS). Dentro de cada capítulo, las partidas se ordenan
  // por nombre con localeCompare("es") para manejar acentos correctamente.
  //
  // Capítulos vacíos NO se muestran por default — la numeración se reflowa
  // sobre los capítulos visibles (1, 2, 3...). Para "agregar" un capítulo
  // vacío de vuelta, hay un dropdown "+ Capítulo" abajo de todo. (regla
  // MJ 2026-05-08).
  const allChaptersData = chapters.map(([key, chapter]) => {
    const chapterItems = items.filter((item) => item.chapter === key);
    // Ordenar dentro del chapter:
    //   1) Por sortOrder — el ORDEN MANUAL que arma MJ arrastrando las filas
    //      (regla MJ 2026-06-05; reemplaza el orden alfabético previo). Le
    //      sirve para contar la obra al cliente en orden cronológico.
    //   2) Desempate: zona (subChapter) y luego nombre. Esto importa para los
    //      presupuestos viejos donde TODAS las partidas tienen sortOrder=0
    //      (el campo nunca se pobló): con el empate en 0, caen al orden de
    //      antes (zona + nombre), o sea se ven IGUAL que hoy hasta que MJ
    //      arrastre por primera vez. Apenas arrastra, el sortOrder pasa a ser
    //      distinto para cada fila y manda el orden manual.
    const sortedItems = [...chapterItems].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      const aSub = a.subChapter ?? "";
      const bSub = b.subChapter ?? "";
      if (aSub !== bSub) return aSub.localeCompare(bSub, "es");
      return a.name.localeCompare(b.name, "es");
    });
    // Subtotales por zona (subChapter) dentro de este capítulo. Se muestran
    // como fila al cierre de cada grupo. La key "" agrupa los items sin zona.
    const subChapterSubtotals = new Map<string, number>();
    for (const it of chapterItems) {
      const k = it.subChapter ?? "";
      subChapterSubtotals.set(k, (subChapterSubtotals.get(k) ?? 0) + it.total);
    }
    const distinctZones = new Set(chapterItems.map((i) => i.subChapter ?? ""));
    const showZoneSubtotals = distinctZones.size > 1;
    return {
      key,
      ...chapter,
      items: sortedItems,
      subtotal: chapterItems.reduce((sum, item) => sum + item.total, 0),
      subChapterSubtotals,
      showZoneSubtotals,
    };
  });

  // Sugerencias para autocompletar zona: todas las zonas existentes
  // en el presupuesto, únicas y ordenadas.
  const zoneSuggestions = Array.from(
    new Set(items.map((i) => i.subChapter).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, "es"));
  // Filtrar vacíos, EXCEPTO si el usuario está activamente agregando a uno
  // (addingChapter) — ese se muestra aunque esté vacío.
  const visibleChapters = allChaptersData.filter(
    (c) => c.items.length > 0 || c.key === addingChapter || enabledEmptyChapters.has(c.key)
  );
  // Re-asignar índices visualmente (1, 2, 3...) en el orden cronológico.
  const itemsByChapter = visibleChapters.map((c, i) => ({ ...c, index: i + 1 }));

  // Orden de arrastre: solo en versiones editables (borrador/enviado). En
  // aprobado/rechazado la lista queda fija.
  const canReorder = ["borrador", "enviado"].includes(initialBudget.status);
  // Lista plana de ids EN EL ORDEN VISIBLE (capítulo por capítulo, y dentro de
  // cada uno el orden ya calculado arriba). dnd-kit ordena contra esta lista,
  // así que tiene que reflejar exactamente lo que se ve en pantalla.
  const orderedIds = itemsByChapter.flatMap((c) => c.items.map((i) => i.id));
  // Para dibujar el "fantasma" mientras se arrastra.
  const activeDragItem = activeDragId
    ? items.find((i) => i.id === activeDragId) ?? null
    : null;
  // Solo envolvemos las filas con el arrastre real cuando está montado en el
  // cliente Y la versión es editable. Antes (SSR / 1ª hidratación): fila plana.
  const dndActive = dndMounted && canReorder;
  const RowWrapper = dndActive ? SortableRow : PlainRow;

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  // Al soltar una partida: la reubico en el orden visible (arrayMove) y, si
  // cayó en otro capítulo, le cambio el chapter al del destino (caso "metí
  // piso flotante en Eléctricas y lo arrastro a Terminaciones"). Después
  // reasigno sortOrder consecutivo a TODAS las partidas en el nuevo orden y lo
  // persisto, igual que el reorder del catálogo de artefactos.
  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = orderedIds.indexOf(activeId);
    const newIndex = orderedIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;

    // El capítulo de destino = el de la partida sobre la que se soltó.
    const overItem = items.find((i) => i.id === overId);
    const targetChapter = overItem?.chapter;

    const newOrder = arrayMove(orderedIds, oldIndex, newIndex);
    const sortMap = new Map(newOrder.map((id, idx) => [id, idx]));

    // Optimista: actualizo el estado local antes de que conteste el servidor.
    const updated = items.map((it) => {
      const so = sortMap.get(it.id);
      const base = so !== undefined ? { ...it, sortOrder: so } : it;
      if (it.id === activeId && targetChapter && targetChapter !== it.chapter) {
        return { ...base, chapter: targetChapter };
      }
      return base;
    });
    setItems(updated);
    setSaveStatus("saving");

    try {
      const payload = newOrder.map((id) => {
        const it = updated.find((u) => u.id === id)!;
        return { id, sortOrder: it.sortOrder, chapter: it.chapter };
      });
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: payload }),
        }
      );
      if (!res.ok) throw new Error("Error");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
      alert("Error al guardar el orden");
      router.refresh();
    }
  }
  // Capítulos disponibles para "+ agregar" (los que no están visibles).
  const hiddenChapters = allChaptersData.filter(
    (c) => c.items.length === 0 && c.key !== addingChapter && !enabledEmptyChapters.has(c.key)
  );

  function handleSelectFromCatalog(partida: CatalogPartida) {
    setSelectedCatalog(partida);
    setNewItem({
      name: partida.name,
      descriptionCliente: partida.descriptionCliente ?? "",
      descriptionMaestro: partida.descriptionMaestro ?? "",
      unit: partida.unit,
      quantity: 0,
      unitPrice: Math.round(partida.unitPrice),
    });
    // Inicializar precios de provisión con referencia del catálogo (neto → c/IVA)
    const initPrices: Record<string, number> = {};
    if (partida.provisions?.length) {
      for (const prov of partida.provisions) {
        initPrices[prov.componentId] = Math.round(prov.unitCost * 1.19);
      }
    }
    setProvisionPrices(initPrices);
    setCatalogQuery("");
    setCatalogResults([]);
    setShowCatalogDropdown(false);
    setShowManualForm(false);
  }

  function handleStartManual() {
    setSelectedCatalog(null);
    setShowManualForm(true);
    setCatalogResults([]);
    setShowCatalogDropdown(false);
    setNewItem({ name: catalogQuery, descriptionCliente: "", descriptionMaestro: "", unit: "GL", quantity: 0, unitPrice: 0 });
  }

  function resetAddForm() {
    setCatalogQuery("");
    setCatalogResults([]);
    setShowCatalogDropdown(false);
    setSelectedCatalog(null);
    setShowManualForm(false);
    setNewItem({ name: "", descriptionCliente: "", descriptionMaestro: "", unit: "GL", quantity: 0, unitPrice: 0 });
    setProvisionPrices({});
    setAddingChapter(null);
  }

  // Calcula el P. Unitario neto ajustado cuando hay provisiones con precio personalizado
  function calcAdjustedUnitPrice(): number {
    if (!selectedCatalog?.provisions?.length) return newItem.unitPrice;
    let provCostNeto = 0;
    for (const prov of selectedCatalog.provisions) {
      const priceNeto = Math.round((provisionPrices[prov.componentId] ?? 0) / 1.19);
      provCostNeto += priceNeto * prov.quantity;
    }
    const nonMaterial =
      (selectedCatalog.costLabor || 0) +
      (selectedCatalog.costSubcontract || 0) +
      (selectedCatalog.costMargin || 0) +
      (selectedCatalog.costTools || 0) +
      (selectedCatalog.costLoss || 0);
    return Math.round(provCostNeto + nonMaterial);
  }

  async function handleAddItem(chapter: string) {
    if (!newItem.name) return;

    try {
      const body: any = { ...newItem, chapter };
      if (selectedCatalog) {
        body.catalogPartidaId = selectedCatalog.id;
        body.costLabor = selectedCatalog.costLabor;
        body.costSubcontract = selectedCatalog.costSubcontract;
        body.costMargin = selectedCatalog.costMargin;
        body.costTools = selectedCatalog.costTools;
        body.costLoss = selectedCatalog.costLoss;
        // Si hay provisiones, costMaterial se deriva del precio de provisión ingresado
        if (selectedCatalog.provisions?.length) {
          let provCostNeto = 0;
          for (const prov of selectedCatalog.provisions) {
            const priceNeto = Math.round((provisionPrices[prov.componentId] ?? 0) / 1.19);
            provCostNeto += priceNeto * prov.quantity;
          }
          body.costMaterial = Math.round(provCostNeto);
          body.unitPrice = calcAdjustedUnitPrice();
          body.total = body.unitPrice * body.quantity;
        } else {
          body.costMaterial = selectedCatalog.costMaterial;
        }
      }

      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems([...items, created]);

      // Si es manual y no existe en catalogo, guardar al catalogo
      if (!selectedCatalog && newItem.name) {
        saveToCatalog(chapter, newItem);
      }

      resetAddForm();
    } catch {
      alert("Error al agregar partida");
    }
  }

  async function saveToCatalog(
    chapter: string,
    item: { name: string; unit: string; unitPrice: number }
  ) {
    try {
      // Map chapter key to a category name for the catalog
      const chapterEntry = OBRA_CHAPTERS[chapter as ObraChapter];
      const categoryName = chapterEntry
        ? chapterEntry.label.toUpperCase()
        : chapter.toUpperCase();

      await fetch("/api/catalogo/partidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: categoryName,
          name: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
        }),
      });
    } catch {
      // silently fail - catalog save is best-effort
    }
  }

  async function handleDeleteItem(itemId: string) {
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        { method: "DELETE" }
      );
      setItems(items.filter((i) => i.id !== itemId));
    } catch {
      alert("Error al eliminar partida");
    }
  }

  // Duplica una partida (con snapshot de componentes). Útil para partir
  // mixtas en dos zonas: MJ duplica, ajusta cantidades de cada lado y le
  // pone subChapter distinto a cada copia.
  async function handleDuplicateItem(itemId: string) {
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}/duplicate`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems((curr) => [...curr, created]);
    } catch {
      alert("Error al duplicar partida");
    }
  }

  // Guardar zona (subChapter) de una partida individual. Persiste vía PUT
  // y actualiza el state local sin esperar refresh.
  async function handleSetZone(itemId: string, zone: string | null) {
    const normalized = zone && zone.trim() ? zone.trim() : null;
    // Optimista: actualizar UI primero
    setItems((curr) =>
      curr.map((i) => (i.id === itemId ? { ...i, subChapter: normalized } : i))
    );
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setSaveStatus("saving");
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, subChapter: normalized ?? "" }),
        }
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }

  // Asignar (o quitar) zona en bulk a todas las partidas seleccionadas.
  // Llama al PUT individual en paralelo. Pasar `null` quita la zona.
  async function handleBulkSetZone(zone: string | null) {
    const normalized = zone && zone.trim() ? zone.trim() : null;
    const targets = items.filter((i) => selectedItemIds.has(i.id));
    if (targets.length === 0) return;
    setItems((curr) =>
      curr.map((i) =>
        selectedItemIds.has(i.id) ? { ...i, subChapter: normalized } : i
      )
    );
    setSaveStatus("saving");
    try {
      await Promise.all(
        targets.map((it) =>
          fetch(
            `/api/presupuestos/${initialBudget.id}/partidas/${it.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...it, subChapter: normalized ?? "" }),
            }
          )
        )
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
    setSelectedItemIds(new Set());
    setBulkZoneDraft("");
  }

  function toggleSelected(itemId: string) {
    setSelectedItemIds((curr) => {
      const next = new Set(curr);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // Renombrar TODA una zona dentro de un capítulo (ej: "Cocina" → "Cocina 1").
  // Hace bulk: actualiza state local + persiste cada item afectado.
  async function handleRenameZoneGroup(
    chapter: string,
    oldName: string,
    newName: string
  ) {
    const normalized = newName.trim();
    if (!normalized || normalized === oldName) return;
    const affected = items.filter(
      (i) => i.chapter === chapter && i.subChapter === oldName
    );
    setItems((curr) =>
      curr.map((i) =>
        i.chapter === chapter && i.subChapter === oldName
          ? { ...i, subChapter: normalized }
          : i
      )
    );
    setSaveStatus("saving");
    try {
      await Promise.all(
        affected.map((it) =>
          fetch(
            `/api/presupuestos/${initialBudget.id}/partidas/${it.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...it, subChapter: normalized }),
            }
          )
        )
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }

  async function handleUpdateCatalog(item: ObraItem) {
    if (!item.catalogPartidaId) return;
    if (
      !confirm(
        `¿Actualizar los PRECIOS de la partida "${item.name}" en el catálogo?\n\n` +
          `Material: $${item.costMaterial ?? 0}\n` +
          `Mano de obra: $${item.costLabor ?? 0}\n` +
          `Herramientas: $${item.costTools ?? 0}\n` +
          `Margen: $${item.costMargin ?? 0}\n` +
          `Pérdida: $${item.costLoss ?? 0}\n` +
          `Subcontrato: $${item.costSubcontract ?? 0}\n` +
          `P. Unitario: $${item.unitPrice}\n\n` +
          `Esto afectará la plantilla base para todos los proyectos futuros\n` +
          `Y se propagará automáticamente a las cotizaciones EN BORRADOR\n` +
          `(no toca las enviadas/aprobadas, ni las que vos editaste a mano).`
      )
    )
      return;
    try {
      const res = await fetch(`/api/catalogo/partidas/${item.catalogPartidaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitPrice: item.unitPrice,
          costMaterial: item.costMaterial ?? 0,
          costLabor: item.costLabor ?? 0,
          costTools: item.costTools ?? 0,
          costMargin: item.costMargin ?? 0,
          costLoss: item.costLoss ?? 0,
          costSubcontract: item.costSubcontract ?? 0,
        }),
      });
      if (!res.ok) throw new Error("Error");
      const result = await res.json();
      const p = result?._propagated;
      const extra =
        p && p.obraItemsUpdated > 0
          ? `\n\nAdemás se actualizaron ${p.obraItemsUpdated} ítem${p.obraItemsUpdated === 1 ? "" : "s"} en ${p.budgetVersionsAffected} cotización${p.budgetVersionsAffected === 1 ? "" : "es"} en borrador.`
          : "";
      alert(`✓ Precios del catálogo actualizados para "${item.name}"${extra}`);
    } catch {
      alert("Error al actualizar catálogo");
    }
  }

  async function handleUpdateCatalogDescription(item: ObraItem) {
    if (!item.catalogPartidaId) return;
    const descCli = (item.descriptionCliente ?? "").trim();
    const descMae = (item.descriptionMaestro ?? "").trim();
    if (
      !confirm(
        `¿Actualizar las DESCRIPCIONES de "${item.name}" en el catálogo?\n\n` +
          `Cliente: "${descCli || "(vacía)"}"\n` +
          `Maestro: "${descMae || "(vacía)"}"\n\n` +
          `Esto afectará las descripciones base para todos los proyectos futuros\n` +
          `Y se propagará automáticamente a las cotizaciones EN BORRADOR\n` +
          `(no toca las enviadas/aprobadas, ni las que vos editaste a mano).`
      )
    )
      return;
    try {
      const res = await fetch(`/api/catalogo/partidas/${item.catalogPartidaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptionCliente: descCli || null,
          descriptionMaestro: descMae || null,
        }),
      });
      if (!res.ok) throw new Error("Error");
      const result = await res.json();
      const p = result?._propagated;
      const extra =
        p && p.obraItemsUpdated > 0
          ? `\n\nAdemás se actualizaron ${p.obraItemsUpdated} ítem${p.obraItemsUpdated === 1 ? "" : "s"} en ${p.budgetVersionsAffected} cotización${p.budgetVersionsAffected === 1 ? "" : "es"} en borrador.`
          : "";
      alert(`✓ Descripción del catálogo actualizada para "${item.name}"${extra}`);
    } catch {
      alert("Error al actualizar descripción del catálogo");
    }
  }

  const flushSave = useCallback(async (itemId: string, item: ObraItem) => {
    setSaveStatus("saving");
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        }
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }, [initialBudget.id]);

  // Tras editar el detalle de componentes de una partida, el recálculo vive en
  // el server. Acá traemos los totales frescos de ESA partida y actualizamos
  // los campos de arriba (Material/Mano de obra/Margen/P.U./total), así no
  // quedan mostrando los valores viejos hasta recargar la página.
  async function refreshItemTotals(itemId: string) {
    try {
      const r = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const fresh = await r.json();
      setItems((curr) =>
        curr.map((it) =>
          it.id === itemId
            ? {
                ...it,
                quantity: fresh.quantity ?? it.quantity,
                unitPrice: fresh.unitPrice ?? it.unitPrice,
                total: fresh.total ?? it.total,
                costMaterial: fresh.costMaterial ?? 0,
                costLabor: fresh.costLabor ?? 0,
                costTools: fresh.costTools ?? 0,
                costSubcontract: fresh.costSubcontract ?? 0,
                costLoss: fresh.costLoss ?? 0,
                costMargin: fresh.costMargin ?? 0,
              }
            : it
        )
      );
    } catch {
      /* si falla, queda el valor en pantalla; no rompe nada */
    }
  }

  function handleUpdateItem(
    itemId: string,
    field: string,
    value: string | number
  ) {
    const BREAKDOWN_FIELDS = [
      "costMaterial",
      "costLabor",
      "costSubcontract",
      "costMargin",
      "costTools",
      "costLoss",
    ];
    const updatedItems = items.map((item) => {
      if (item.id !== itemId) return item;
      const updated = { ...item, [field]: value };
      // Si cambió un componente del desglose → P.U = suma del desglose
      if (BREAKDOWN_FIELDS.includes(field)) {
        updated.unitPrice =
          (updated.costMaterial ?? 0) +
          (updated.costLabor ?? 0) +
          (updated.costSubcontract ?? 0) +
          (updated.costMargin ?? 0) +
          (updated.costTools ?? 0) +
          (updated.costLoss ?? 0);
      }
      if (
        field === "quantity" ||
        field === "unitPrice" ||
        BREAKDOWN_FIELDS.includes(field)
      ) {
        updated.total = updated.quantity * updated.unitPrice;
      }
      return updated;
    });
    setItems(updatedItems);

    const item = updatedItems.find((i) => i.id === itemId);
    if (!item) return;

    // Debounce: cancel pending save, schedule new one in 600ms
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingSaveRef.current = { itemId, item };
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        flushSave(pendingSaveRef.current.itemId, pendingSaveRef.current.item);
        pendingSaveRef.current = null;
      }
    }, 600);
  }

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ggPercentage: ggPercent,
          utilityPercentage: utilPercent,
          observations,
        }),
      });

      await fetch(`/api/presupuestos/${initialBudget.id}/forma-pago`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: paymentTerms.map((t) => ({
            stage: t.stage,
            percentage: t.percentage,
            amount: (totalConIva * t.percentage) / 100,
          })),
        }),
      });

      router.refresh();
    } catch {
      alert("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <BudgetAuditBanner
        budgetId={initialBudget.id}
        status={initialBudget.status}
        onSynced={() => router.refresh()}
      />
      {/* Header de tabla — UNA sola vez arriba, después chapters y items
          forman una tabla continua estilo Excel maestro. */}
      <div className="bg-white border border-gray-200 rounded-t-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-900 bg-white">
              <th className="px-2 py-0.5 w-8 text-center">
                {/* Select all / deselect all visible partidas. Indeterminado
                    cuando hay selección parcial. */}
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 align-middle accent-gray-900"
                  checked={
                    items.length > 0 && selectedItemIds.size === items.length
                  }
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        selectedItemIds.size > 0 &&
                        selectedItemIds.size < items.length;
                    }
                  }}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedItemIds(new Set(items.map((i) => i.id)));
                    } else {
                      setSelectedItemIds(new Set());
                    }
                  }}
                  title="Seleccionar todas"
                />
              </th>
              <th className="text-center px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-10">Item</th>
              <th className="text-left px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider" style={{ width: "20%" }}>Partida</th>
              <th className="text-left px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider" style={{ width: "32%" }}>Descripcion</th>
              <th className="text-center px-1 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-12">Un.</th>
              <th className="text-right px-1 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-16">Cant.</th>
              <th className="text-right px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-20" title="Mano de obra por unidad — lo que pagás al maestro">M.O.</th>
              <th className="text-right px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-24">P.U.</th>
              <th className="text-right px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-28">Total</th>
              <th className="w-6"></th>
            </tr>
          </thead>
        </table>
      </div>

      <DndContext
        id="obra-partidas-dnd"
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
      <div className="space-y-0 -mt-3">
      {itemsByChapter.map((chapter) => (
        <div
          key={chapter.key}
          className="bg-white border-x border-gray-200 overflow-visible last:border-b last:rounded-b-xl"
        >
          {/* Chapter bar — gris claro, formato cuadro Excel */}
          <div className="flex items-center justify-between px-4 py-1 bg-gray-200 border-y border-gray-200">
            <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wide">
              <span className="inline-block w-6">{chapter.index}</span>
              {chapter.label}
            </h3>
            <div className="flex items-center gap-5">
              <span className="text-xs font-medium text-gray-700 tabular-nums">
                Subtotal {formatCLP(chapter.subtotal)}
              </span>
              <button
                onClick={() => {
                  resetAddForm();
                  setAddingChapter(chapter.key);
                }}
                className="text-xs font-semibold text-gray-700 hover:text-black uppercase tracking-wide"
              >
                + Agregar
              </button>
            </div>
          </div>

          {chapter.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-10" />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "32%" }} />
                  <col className="w-12" />
                  <col className="w-16" />
                  <col className="w-20" />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col className="w-6" />
                </colgroup>
                <tbody className="divide-y divide-gray-50">
                  {chapter.items.map((item, itemIdx) => {
                    const prevItem = itemIdx > 0 ? chapter.items[itemIdx - 1] : null;
                    const showSubHeader =
                      item.subChapter &&
                      (!prevItem || prevItem.subChapter !== item.subChapter);
                    return (
                    <Fragment key={item.id}>
                    {showSubHeader && (
                      <tr className="bg-gray-100/70 border-y border-gray-200">
                        <td
                          colSpan={8}
                          className="px-3 py-0.5 text-[10px] font-semibold text-gray-600 uppercase tracking-wider"
                        >
                          {editingZoneGroup &&
                          editingZoneGroup.chapter === chapter.key &&
                          editingZoneGroup.name === item.subChapter ? (
                            <input
                              autoFocus
                              value={zoneDraft}
                              onChange={(e) => setZoneDraft(e.target.value)}
                              onBlur={() => {
                                handleRenameZoneGroup(
                                  chapter.key,
                                  item.subChapter!,
                                  zoneDraft
                                );
                                setEditingZoneGroup(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                } else if (e.key === "Escape") {
                                  setEditingZoneGroup(null);
                                }
                              }}
                              className="bg-white border border-gray-300 rounded px-1 py-0 text-[10px] font-semibold uppercase tracking-wider text-gray-700 focus:outline-none focus:border-gray-900"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setZoneDraft(item.subChapter ?? "");
                                setEditingZoneGroup({
                                  chapter: chapter.key,
                                  name: item.subChapter!,
                                });
                              }}
                              className="hover:text-gray-900"
                              title="Renombrar zona (afecta todas las partidas de este grupo)"
                            >
                              {item.subChapter}
                            </button>
                          )}
                        </td>
                        {/* Subtotal de zona en la misma fila de la bandita,
                            alineado a la derecha bajo la columna Total. Solo
                            si el capítulo tiene 2+ zonas (sino == subtotal
                            del capítulo). */}
                        <td className="px-3 py-0.5 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wider tabular-nums whitespace-nowrap">
                          {chapter.showZoneSubtotals
                            ? formatCLP(
                                chapter.subChapterSubtotals.get(
                                  item.subChapter ?? ""
                                ) ?? 0
                              )
                            : ""}
                        </td>
                        <td></td>
                      </tr>
                    )}
                    <RowWrapper id={item.id} disabled={!canReorder}>
                    {(drag) => (
                    <tr
                      ref={drag.setNodeRef}
                      style={drag.style}
                      className={`border-b border-gray-100 hover:bg-gray-50/60 group ${
                        selectedItemIds.has(item.id) || drag.isDragging ? "bg-gray-50" : ""
                      }`}
                    >
                      <td className="px-2 py-1 align-top text-center">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 align-middle accent-gray-900"
                          checked={selectedItemIds.has(item.id)}
                          onChange={() => toggleSelected(item.id)}
                        />
                      </td>
                      <td className="px-3 py-1 text-gray-700 text-xs tabular-nums align-top whitespace-nowrap">
                        {/* Manija de arrastre — solo en versiones editables.
                            Los listeners van acá (no en toda la fila) para no
                            pelear con la edición de las celdas. */}
                        {dndActive && (
                          <span
                            {...drag.attributes}
                            {...(drag.listeners ?? {})}
                            className="mr-1 inline-block cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-700 select-none align-middle"
                            title="Arrastrar para reordenar"
                          >
                            ⋮⋮
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const willOpen = !expandedItems[item.id];
                            setExpandedItems((prev) => ({
                              ...prev,
                              [item.id]: willOpen,
                            }));
                            const sum =
                              (item.costMaterial ?? 0) +
                              (item.costLabor ?? 0) +
                              (item.costSubcontract ?? 0) +
                              (item.costMargin ?? 0) +
                              (item.costTools ?? 0) +
                              (item.costLoss ?? 0);
                            if (willOpen && sum === 0 && item.unitPrice > 0) {
                              handleUpdateItem(item.id, "costMaterial", item.unitPrice);
                            } else if (willOpen && sum > 0 && sum < item.unitPrice) {
                              const gap = Math.round(item.unitPrice - sum);
                              handleUpdateItem(item.id, "costMaterial", (item.costMaterial ?? 0) + gap);
                            } else if (willOpen && sum > item.unitPrice) {
                              handleUpdateItem(item.id, "unitPrice", sum);
                            }
                          }}
                          className="mr-1 text-gray-300 hover:text-gray-700"
                          title="Ver desglose"
                        >
                          {expandedItems[item.id] ? "▾" : "▸"}
                        </button>
                        {chapter.index}.{itemIdx + 1}
                        {/* Zona (subChapter) — selector inline. Si la partida
                            no tiene zona, muestra "+ zona" muy discreto al
                            hover de la fila. Si la tiene, no se muestra acá
                            (ya está la bandita gris arriba del grupo).
                            Click = inline input con datalist de zonas usadas. */}
                        {editingZoneItemId === item.id ? (
                          <div className="mt-0.5">
                            <input
                              autoFocus
                              list={`zonas-${initialBudget.id}`}
                              value={zoneDraft}
                              onChange={(e) => setZoneDraft(e.target.value)}
                              onBlur={() => {
                                handleSetZone(item.id, zoneDraft);
                                setEditingZoneItemId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                else if (e.key === "Escape") {
                                  setEditingZoneItemId(null);
                                }
                              }}
                              placeholder="Cocina, Baños…"
                              className="bg-white border border-gray-300 rounded px-1 py-0 text-[10px] uppercase tracking-wider text-gray-700 focus:outline-none focus:border-gray-900 w-20"
                            />
                          </div>
                        ) : !item.subChapter ? (
                          <button
                            type="button"
                            onClick={() => {
                              setZoneDraft("");
                              setEditingZoneItemId(item.id);
                            }}
                            className="mt-0.5 block text-[9px] uppercase tracking-wider text-gray-300 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Asignar zona"
                          >
                            + zona
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setZoneDraft(item.subChapter!);
                              setEditingZoneItemId(item.id);
                            }}
                            className="mt-0.5 block text-[9px] uppercase tracking-wider text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Cambiar zona"
                          >
                            ↻ zona
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-0.5 align-top">
                        {/* PARTIDA — textarea auto-altura, sin cap. Muestra
                            todo el nombre aunque sea largo (la fila crece). */}
                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = "auto";
                              el.style.height = `${el.scrollHeight}px`;
                            }
                          }}
                          value={item.name}
                          onChange={(e) => {
                            handleUpdateItem(item.id, "name", e.target.value);
                            e.currentTarget.style.height = "auto";
                            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                          }}
                          rows={1}
                          className="text-force-11 w-full resize-none bg-transparent border-0 p-0 text-gray-900 focus:ring-0 outline-none uppercase leading-snug overflow-hidden"
                          style={{ minHeight: "16px" }}
                        />
                      </td>
                      <td className="px-3 py-0.5 align-top">
                        {/* DESCRIPCION CLIENTE — vista con formato (negrita,
                            cursiva, listas, color). La edición está en el panel
                            expandido (abajo); acá un clic lo abre, porque una
                            barra de formato no entra en esta celda compacta. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setExpandedItems((prev) => ({ ...prev, [item.id]: true }))
                          }
                          title="Clic para editar la descripción (se abre el detalle)"
                          className="text-force-10 w-full text-gray-600 leading-snug cursor-text min-h-[14px] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5"
                        >
                          {isRichTextEmpty(item.descriptionCliente) ? (
                            <span className="text-gray-300">Descripción para el cliente (PDF)…</span>
                          ) : (
                            <span
                              dangerouslySetInnerHTML={{
                                __html: sanitizeRichTextHtml(item.descriptionCliente),
                              }}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 align-top text-center">
                        {/* Unidad NO editable — viene de la PartidaCatalog
                            y mantenerla acá editable confunde porque cada
                            proyecto podría tener una unidad distinta para
                            la misma partida. Si hay que cambiarla, se
                            edita en el catálogo. */}
                        <span className="text-force-11 text-gray-700">{item.unit}</span>
                      </td>
                      <td className="px-2 py-0.5 align-top">
                        <input
                          type="number"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateItem(
                              item.id,
                              "quantity",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="text-force-11 w-full min-w-0 bg-transparent border-0 p-0 text-right text-gray-900 tabular-nums focus:ring-0 outline-none"
                        />
                      </td>
                      <td className="px-3 py-0.5 align-top" title="Mano de obra por unidad — lo que pagás al maestro por cada m²/un/ml">
                        <div className="flex items-center justify-end gap-0.5 tabular-nums">
                          <span className="text-amber-700/60 text-sm">$</span>
                          <MoneyInput
                            value={item.costLabor ?? 0}
                            onChange={(v) => handleUpdateItem(item.id, "costLabor", v)}
                            className="w-16 bg-transparent border-0 p-0 text-right text-sm text-amber-800 tabular-nums focus:ring-0 outline-none"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-0.5 align-top">
                        <div className="flex items-center justify-end gap-0.5 tabular-nums">
                          <span className="text-gray-400 text-sm">$</span>
                          <MoneyInput
                            value={item.unitPrice}
                            onChange={(v) => handleUpdateItem(item.id, "unitPrice", v)}
                            className="w-20 bg-transparent border-0 p-0 text-right text-sm text-gray-900 tabular-nums focus:ring-0 outline-none"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-0.5 align-top text-right text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {saveStatus === "saving" && (
                            <span className="text-[10px] text-gray-400 animate-pulse hidden group-hover:inline">guardando…</span>
                          )}
                          {saveStatus === "saved" && (
                            <span className="text-[10px] text-green-600 hidden group-hover:inline">✓</span>
                          )}
                          {formatCLP(item.total)}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 align-top whitespace-nowrap">
                        <button
                          onClick={() => handleDuplicateItem(item.id)}
                          className="text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-900 transition-all text-xs mr-1"
                          title="Duplicar partida (para partir en dos zonas)"
                        >
                          ⎘
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all text-xs"
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    )}
                    </RowWrapper>
                    {expandedItems[item.id] && (
                      <tr className="bg-gray-50">
                        <td colSpan={10} className="p-0">
                          <PartidaExpandedPanel
                            item={item}
                            saveStatus={saveStatus}
                            budgetId={initialBudget.id}
                            canEdit={["borrador", "enviado"].includes(initialBudget.status)}
                            onUpdate={(field, value) =>
                              handleUpdateItem(item.id, field, value)
                            }
                            onUpdateCatalog={() => handleUpdateCatalog(item)}
                            onUpdateCatalogDescription={() =>
                              handleUpdateCatalogDescription(item)
                            }
                            onComponentsChanged={() => refreshItemTotals(item.id)}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Panel agregar partida desde catalogo */}
          {addingChapter === chapter.key && (
            <div className="p-4 border-t border-gray-100 bg-blue-50">
              {/* Step 1: Search catalog or go manual */}
              {!selectedCatalog && !showManualForm && (
                <div ref={searchRef} className="relative">
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={catalogQuery}
                        onChange={(e) => {
                          setCatalogQuery(e.target.value);
                          setShowCatalogDropdown(true);
                        }}
                        onFocus={() => setShowCatalogDropdown(true)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        placeholder="Buscar partida en catalogo... (ej: demolicion muro, enchape)"
                        autoFocus
                      />
                      {searchingCatalog && (
                        <div className="absolute right-3 top-3">
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleStartManual}
                      className="text-sm text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap px-3 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
                    >
                      Crear nueva
                    </button>
                    <button
                      onClick={resetAddForm}
                      className="text-gray-400 hover:text-gray-600 px-2 py-2.5"
                    >
                      Cancelar
                    </button>
                  </div>

                  {/* Search results dropdown */}
                  {showCatalogDropdown && catalogResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-16 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-72 overflow-y-auto">
                      {catalogResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectFromCatalog(p)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-gray-900">
                                {p.name}
                              </span>
                              <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                {p.unit}
                              </span>
                              <span className="ml-2 text-xs text-gray-400">
                                {p.category}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-gray-600">
                              {formatCLP(p.unitPrice)}/{p.unit}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* No results message */}
                  {showCatalogDropdown &&
                    catalogQuery.length >= 2 &&
                    !searchingCatalog &&
                    catalogResults.length === 0 && (
                      <div className="absolute z-10 left-0 right-16 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg p-4">
                        <p className="text-sm text-gray-500 mb-2">
                          No se encontraron partidas para &quot;{catalogQuery}&quot;
                        </p>
                        <button
                          onClick={handleStartManual}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Crear partida nueva manualmente
                        </button>
                      </div>
                    )}
                </div>
              )}

              {/* Step 2a: Catalog partida selected - just need quantity */}
              {selectedCatalog && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-gray-500 bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                      Del catalogo
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {selectedCatalog.name}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedCatalog(null);
                        setCatalogQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 ml-1"
                    >
                      (cambiar)
                    </button>
                  </div>
                  <div
                    className="grid grid-cols-12 gap-2 items-end"
                    onKeyDown={(e) => {
                      // Enter dentro del formulario "Del catálogo" guarda igual
                      // que el botón Agregar. preventDefault evita que el navegador
                      // intente un submit o una recarga. Las validaciones viven en
                      // handleAddItem (si falta el nombre, no hace nada).
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddItem(chapter.key);
                      }
                    }}
                  >
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-600 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={newItem.name}
                        onChange={(e) =>
                          setNewItem({ ...newItem, name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Unidad
                      </label>
                      <select
                        value={newItem.unit}
                        onChange={(e) =>
                          setNewItem({ ...newItem, unit: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Cantidad
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newItem.quantity || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        autoFocus
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        P. Unitario
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={newItem.unitPrice || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none text-right"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleAddItem(chapter.key)}
                        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                      >
                        Agregar
                      </button>
                      <button
                        onClick={resetAddForm}
                        className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                  {/* Provision price fields */}
                  {selectedCatalog.provisions?.length > 0 && (
                    <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <p className="text-xs font-medium text-purple-700 mb-2">
                        Valor provisión al cliente (precio c/IVA que se le cotiza al cliente)
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedCatalog.provisions.map((prov) => (
                          <label key={prov.componentId} className="flex flex-col">
                            <span className="text-xs text-purple-600 mb-1">
                              {prov.name}
                              {prov.quantity !== 1 && (
                                <span className="text-purple-400 ml-1">
                                  (×{prov.quantity} por {selectedCatalog.unit})
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none text-sm">$</span>
                                <input
                                  type="number"
                                  step="1"
                                  value={provisionPrices[prov.componentId] ?? ""}
                                  onChange={(e) =>
                                    setProvisionPrices({
                                      ...provisionPrices,
                                      [prov.componentId]: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  placeholder="Precio c/IVA"
                                  className="w-full border border-purple-300 rounded pl-6 pr-2 py-1.5 text-sm text-right bg-white focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none"
                                />
                              </div>
                              <span className="text-xs text-purple-500 whitespace-nowrap">
                                c/IVA por {prov.quantity !== 1 ? "unidad" : selectedCatalog.unit}
                              </span>
                            </div>
                            {(provisionPrices[prov.componentId] ?? 0) > 0 && (
                              <span className="text-xs text-purple-400 mt-0.5 text-right">
                                neto: {formatCLP(Math.round((provisionPrices[prov.componentId] ?? 0) / 1.19))} / unidad
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {newItem.quantity > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Total estimado:{" "}
                      <span className="font-medium text-gray-700">
                        {formatCLP(newItem.quantity * (selectedCatalog.provisions?.length ? calcAdjustedUnitPrice() : newItem.unitPrice))}
                      </span>
                      {selectedCatalog.provisions?.length > 0 && (
                        <span className="ml-2 text-purple-500">
                          (P.U neto ajustado: {formatCLP(calcAdjustedUnitPrice())})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2b: Manual form */}
              {showManualForm && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-medium">
                      Nueva partida
                    </span>
                    <span className="text-xs text-gray-400">
                      Se guardara automaticamente en el catalogo
                    </span>
                    <button
                      onClick={() => {
                        setShowManualForm(false);
                        setCatalogQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 ml-1"
                    >
                      (buscar en catalogo)
                    </button>
                  </div>
                  <div
                    className="grid grid-cols-12 gap-2 items-end"
                    onKeyDown={(e) => {
                      // Enter dentro del formulario manual ("Crear partida nueva")
                      // guarda igual que el botón Agregar. Mismo patrón que el form
                      // del catálogo: preventDefault evita submit/recarga; las
                      // validaciones viven en handleAddItem (si falta el nombre, no hace nada).
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddItem(chapter.key);
                      }
                    }}
                  >
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-600 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={newItem.name}
                        onChange={(e) =>
                          setNewItem({ ...newItem, name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        placeholder="Nombre de la partida"
                        autoFocus
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Unidad
                      </label>
                      <select
                        value={newItem.unit}
                        onChange={(e) =>
                          setNewItem({ ...newItem, unit: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        Cantidad
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newItem.quantity || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">
                        P. Unitario
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={newItem.unitPrice || ""}
                        onChange={(e) =>
                          setNewItem({
                            ...newItem,
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none text-right"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleAddItem(chapter.key)}
                        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                      >
                        Agregar
                      </button>
                      <button
                        onClick={resetAddForm}
                        className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                  {newItem.quantity > 0 && newItem.unitPrice > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Total estimado:{" "}
                      <span className="font-medium text-gray-700">
                        {formatCLP(newItem.quantity * newItem.unitPrice)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      </div>
      </SortableContext>
      {/* Fantasma que sigue al cursor mientras se arrastra una partida. Es una
          versión liviana de la fila (nombre + total), suficiente para que MJ
          vea qué está moviendo sin arrastrar toda la tabla. */}
      <DragOverlay>
        {activeDragItem ? (
          <div className="flex items-center gap-3 bg-white border border-gray-300 rounded shadow-sm px-3 py-1.5 text-xs">
            <span className="text-gray-400">⋮⋮</span>
            <span className="font-medium text-gray-900 uppercase truncate max-w-[280px]">
              {activeDragItem.name || "(sin nombre)"}
            </span>
            <span className="ml-auto text-gray-700 tabular-nums whitespace-nowrap">
              {formatCLP(activeDragItem.total)}
            </span>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* "+ Capítulo": dropdown para re-habilitar capítulos vacíos. Solo
          aparece cuando hay capítulos ocultos disponibles. */}
      {hiddenChapters.length > 0 && (
        <div className="relative" ref={chapterPickerRef}>
          <button
            onClick={() => setShowChapterPicker((s) => !s)}
            className="text-sm text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors"
          >
            + Capítulo
          </button>
          {showChapterPicker && (
            <div className="absolute z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[220px]">
              {hiddenChapters.map((c) => (
                <button
                  key={c.key}
                  onClick={() => {
                    setEnabledEmptyChapters((prev) => new Set(prev).add(c.key));
                    setShowChapterPicker(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resumen financiero — 2 columnas:
          IZQUIERDA: desglose del costo directo por tipo (Materiales, MO,
          Herramientas, Subcontrato, Pérdidas, Margen). Sirve para que
          MJ vea cuánto se le está pagando al maestro mientras cotiza,
          y ajuste valores in-situ si algo se desbalancea.
          DERECHA: cascada CD + GG + Util + IVA = Total. */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Resumen Presupuesto
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Desglose costo directo por tipo */}
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Desglose costo directo
            </div>
            {(() => {
              // Sumar por tipo. Costo directo total = suma de items.total
              // (que ya incluye desglose interno). Cada componente es la
              // suma de cost{X} × quantity en todos los items.
              const sumByType = items.reduce(
                (acc, it) => ({
                  material: acc.material + (it.costMaterial ?? 0) * it.quantity,
                  labor: acc.labor + (it.costLabor ?? 0) * it.quantity,
                  tools: acc.tools + (it.costTools ?? 0) * it.quantity,
                  subcontract:
                    acc.subcontract + (it.costSubcontract ?? 0) * it.quantity,
                  loss: acc.loss + (it.costLoss ?? 0) * it.quantity,
                  margin: acc.margin + (it.costMargin ?? 0) * it.quantity,
                }),
                { material: 0, labor: 0, tools: 0, subcontract: 0, loss: 0, margin: 0 }
              );
              const rows: { label: string; value: number; tone?: string }[] = [
                { label: "Materiales", value: sumByType.material },
                { label: "Mano de obra", value: sumByType.labor, tone: "text-amber-700" },
                { label: "Herramientas", value: sumByType.tools },
                { label: "Subcontrato", value: sumByType.subcontract },
                { label: "Pérdidas", value: sumByType.loss },
                { label: "Margen", value: sumByType.margin, tone: "text-green-700" },
              ];
              const sumDesglose = rows.reduce((s, r) => s + r.value, 0);
              const sinClasificar = costoDirecto - sumDesglose;
              return (
                <div className="space-y-1.5">
                  {rows.map((r) => {
                    const pct = costoDirecto > 0 ? (r.value / costoDirecto) * 100 : 0;
                    return (
                      <div key={r.label} className="flex items-center justify-between text-sm">
                        <span className={`text-gray-600 ${r.tone ?? ""}`}>{r.label}</span>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
                          <span className={`font-medium w-28 text-right ${r.tone ?? ""}`}>{formatCLP(r.value)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {Math.abs(sinClasificar) > 1 && (
                    <div className="flex items-center justify-between text-sm pt-1.5 border-t border-gray-100">
                      <span className="text-gray-400 italic">(sin desglose)</span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-xs text-gray-400 w-10 text-right">
                          {costoDirecto > 0 ? ((sinClasificar / costoDirecto) * 100).toFixed(0) : 0}%
                        </span>
                        <span className="font-medium text-gray-400 w-28 text-right">
                          {formatCLP(sinClasificar)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm pt-1.5 border-t-2 border-gray-300 font-bold">
                    <span>Costo directo</span>
                    <span className="tabular-nums">{formatCLP(costoDirecto)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Cascada hacia Total */}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Cascada hacia total
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Costo Directo</span>
              <span className="font-medium tabular-nums">{formatCLP(costoDirecto)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                Gastos Generales ({ggPercent}%)
              </span>
              <span className="font-medium tabular-nums">{formatCLP(gastosGenerales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Utilidad ({utilPercent}%)</span>
              <span className="font-medium tabular-nums">{formatCLP(utilidad)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
              <span className="text-gray-600">Neto</span>
              <span className="font-medium tabular-nums">{formatCLP(neto)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">IVA (19%)</span>
              <span className="font-medium tabular-nums">{formatCLP(iva)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t-2 border-gray-900 pt-2">
              <span>Total con IVA</span>
              <span className="tabular-nums">{formatCLP(totalConIva)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detalle por costo directo — qué hay dentro de cada bolsa
          (Materiales, MO, etc). Cada componente proviene del snapshot
          ObraItemComponent de las partidas. */}
      <CostoDirectoDetalle
        items={items.map((it) => ({
          id: it.id,
          itemNumber: it.itemNumber,
          name: it.name,
          quantity: it.quantity,
          components: it.components ?? [],
        }))}
      />

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Forma de Pago
        </h2>
        <div className="space-y-3 max-w-lg">
          {paymentTerms.map((term, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-5">
                <input
                  type="text"
                  value={term.stage}
                  onChange={(e) => {
                    const updated = [...paymentTerms];
                    updated[index] = {
                      ...updated[index],
                      stage: e.target.value,
                    };
                    setPaymentTerms(updated);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                />
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="1"
                    value={term.percentage}
                    onChange={(e) => {
                      const updated = [...paymentTerms];
                      updated[index] = {
                        ...updated[index],
                        percentage: parseFloat(e.target.value) || 0,
                      };
                      setPaymentTerms(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>
              <div className="col-span-3 text-sm text-right text-gray-600">
                {formatCLP((totalConIva * term.percentage) / 100)}
              </div>
              <div className="col-span-1">
                <button
                  onClick={() => {
                    setPaymentTerms(
                      paymentTerms.filter((_, i) => i !== index)
                    );
                  }}
                  className="text-gray-400 hover:text-red-500 text-sm"
                >
                  x
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              onClick={() =>
                setPaymentTerms([
                  ...paymentTerms,
                  {
                    stage: `Etapa ${paymentTerms.length + 1}`,
                    percentage: 0,
                  },
                ])
              }
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              + Agregar etapa
            </button>
            <span className="text-sm text-gray-500">
              Total:{" "}
              {paymentTerms.reduce((sum, t) => sum + t.percentage, 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Observaciones y Condiciones
        </h2>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={6}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none resize-none"
          placeholder="Condiciones del presupuesto, plazos, exclusiones, etc."
        />
      </div>

      {/* Configuracion GG + Utilidad — al final, una vez seteados al
          principio del proyecto no estorban arriba. */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Configuración
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Gastos Generales (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={ggPercent}
              onChange={(e) => setGgPercent(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Utilidad (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={utilPercent}
              onChange={(e) => setUtilPercent(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar Todo"}
            </button>
          </div>
        </div>
      </div>
      {/* Datalist global de zonas usadas en este presupuesto.
          Sirve como autocompletado para todos los inputs de zona. */}
      <datalist id={`zonas-${initialBudget.id}`}>
        {zoneSuggestions.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {/* Barra flotante de acción bulk — aparece cuando hay selección.
          Centrada abajo, estilo editorial (blanco, borde fino). */}
      {selectedItemIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-300 rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs font-medium text-gray-700 tabular-nums whitespace-nowrap">
            {selectedItemIds.size}{" "}
            {selectedItemIds.size === 1 ? "partida" : "partidas"}
          </span>
          <span className="h-4 w-px bg-gray-200" />
          <input
            list={`zonas-${initialBudget.id}`}
            value={bulkZoneDraft}
            onChange={(e) => setBulkZoneDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleBulkSetZone(bulkZoneDraft);
            }}
            placeholder="Asignar zona (Cocina, Baños…)"
            className="border border-gray-300 rounded px-2 py-1 text-xs uppercase tracking-wider text-gray-700 focus:outline-none focus:border-gray-900 w-44"
          />
          <button
            type="button"
            onClick={() => handleBulkSetZone(bulkZoneDraft)}
            disabled={!bulkZoneDraft.trim()}
            className="text-xs font-semibold uppercase tracking-wide text-gray-900 hover:text-black disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            Aplicar
          </button>
          <span className="h-4 w-px bg-gray-200" />
          <button
            type="button"
            onClick={() => handleBulkSetZone(null)}
            className="text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900"
            title="Dejar las partidas seleccionadas sin zona"
          >
            Quitar zona
          </button>
          <span className="h-4 w-px bg-gray-200" />
          <button
            type="button"
            onClick={() => {
              setSelectedItemIds(new Set());
              setBulkZoneDraft("");
            }}
            className="text-xs uppercase tracking-wide text-gray-400 hover:text-gray-700"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}
