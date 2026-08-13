"use client";

import { useState, useEffect, useRef, Fragment, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";
import { annotateZones } from "@/lib/presupuesto/zones";
import {
  groupByChapter,
  CAPITULOS_SUGERIDOS,
  SIN_CAPITULO_ID,
  type ChapterLike,
} from "@/lib/presupuesto/chapters";
import MoneyInput from "@/components/ui/MoneyInput";
import BudgetAuditBanner from "@/components/presupuesto/BudgetAuditBanner";
import ObraItemComponentsEditor from "@/components/presupuesto/ObraItemComponentsEditor";
import CostoDirectoDetalle from "@/components/presupuesto/CostoDirectoDetalle";
import PartidaExpandedPanel from "@/components/presupuesto/PartidaExpandedPanel";
import RichTextEditor from "@/components/presupuesto/RichTextEditor";
import { sanitizeRichTextHtml, isRichTextEmpty } from "@/lib/richText";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
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
import {
  computeChangeMarkers,
  type BaselineItem,
  type ChangeResult,
} from "@/lib/presupuesto/versionDiff";
import CondicionesEditor from "@/components/presupuesto/CondicionesEditor";
import type { Condicion } from "@/lib/presupuesto/condiciones";

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

// Prefijo de los ids de arrastre de CAPÍTULO, para no confundirlos nunca con
// los ids de partida dentro del mismo DndContext.
const CAP_DRAG_PREFIX = "cap:";

// Cómo se decide sobre QUÉ se está soltando.
//
// Para las PARTIDAS se mantiene closestCenter, que es lo que había y funciona
// bien en una lista larga de filas parejas.
//
// Para los CAPÍTULOS se usa pointerWithin: gana la zona que contiene al CURSOR.
// Con closestCenter el capítulo caía sistemáticamente un lugar más arriba del
// que MJ apuntaba — compara centros de rectángulos, y el centro del capítulo
// arrastrado no coincide con la punta del mouse. Con pointerWithin cae donde
// se ve el resalte, sin sorpresas. Si el cursor quedó en un hueco (entre dos
// zonas), se cae de vuelta a closestCenter para no dejar el arrastre muerto.
const detectarColision: CollisionDetection = (args) => {
  if (String(args.active.id).startsWith(CAP_DRAG_PREFIX)) {
    const bajoElCursor = pointerWithin(args);
    if (bajoElCursor.length > 0) return bajoElCursor;
  }
  return closestCenter(args);
};

// Caja arrastrable de un capítulo entero.
//
// A propósito NO usa useSortable como las filas de partida: useSortable aplica
// la estrategia de lista vertical, que mide TODOS los nodos del SortableContext
// como si fueran hermanos en una sola columna. Un capítulo CONTIENE a sus
// partidas, así que meterlo en el mismo contexto que ellas hacía que la
// estrategia calculara desplazamientos gigantes y la pantalla se llenaba de
// huecos en blanco. Con useDraggable + useDroppable el capítulo participa del
// arrastre pero queda fuera de esa matemática, y el arrastre de partidas sigue
// funcionando exactamente igual que antes.
function ChapterDragBox({
  id,
  enabled,
  className,
  children,
}: {
  id: string;
  enabled: boolean;
  className?: string;
  children: (drag: {
    attributes: DraggableAttributes;
    listeners: Record<string, unknown> | undefined;
    setDropRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
    isOver: boolean;
  }) => React.ReactNode;
}) {
  const dragId = `${CAP_DRAG_PREFIX}${id}`;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id: dragId, disabled: !enabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId,
    disabled: !enabled,
  });
  // Tanto lo que se arrastra como la zona donde se suelta son la BARRA del
  // capítulo, no el bloque entero. dnd-kit compara CENTROS de rectángulos: con
  // el bloque entero, el centro de un capítulo largo queda lejísimos de su
  // título, y soltar sobre la barra de "REPARACIONES" terminaba metiendo el
  // capítulo un lugar más arriba. Con la barra, el rectángulo es chico y sigue
  // al cursor: el capítulo cae donde MJ apunta. Soltar en el medio de las
  // filas de un capítulo sigue valiendo — eso se resuelve por la partida de
  // destino (ver handleChapterDragEnd).
  const refBarra = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };
  return (
    <div className={className} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children({ attributes, listeners, setDropRef: refBarra, isDragging, isOver })}
    </div>
  );
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
  // Para reconstruir el total real del desglose (pérdida % sobre un material,
  // leyes % sobre la mano de obra, etc.) — espejo de recalcObraItem.ts.
  appliedToComponentId?: string | null;
  appliedToType?: string | null;
}

// Suma "real" del desglose de una partida, replicando EXACTAMENTE el cálculo
// del servidor (src/lib/catalog/recalcObraItem.ts → effectiveTotal). Se usa solo
// para DETECTAR descuadres (la marquita roja): si el total guardado de la partida
// no coincide con esta suma, el número de arriba quedó como una "foto" vieja del
// desglose (pasa cuando el desglose cambió por catálogo/copia sin recalcular el
// total). NO escribe nada — es solo lectura para avisar.
function componentEffectiveTotal(
  c: ObraItemComponent,
  all: ObraItemComponent[]
): number {
  const pct = c.quantity || 0;
  if (c.unit !== "%") return (c.quantity || 0) * (c.unitCost || 0);
  if (c.type === "perdida") {
    if (c.appliedToComponentId) {
      const t = all.find((x) => x.id === c.appliedToComponentId);
      return t ? componentEffectiveTotal(t, all) * (pct / 100) : 0;
    }
    if (c.appliedToType === "material") {
      const base = all
        .filter((x) => x.type === "material" && x.id !== c.id)
        .reduce((s, x) => s + componentEffectiveTotal(x, all), 0);
      return base * (pct / 100);
    }
    return 0;
  }
  if (c.type === "mano_obra" && c.appliedToType === "mano_obra") {
    const base = all
      .filter((x) => x.type === "mano_obra" && x.unit !== "%" && x.id !== c.id)
      .reduce((s, x) => s + componentEffectiveTotal(x, all), 0);
    return base * (pct / 100);
  }
  if (c.type === "margen") {
    const base = all
      .filter((x) => x.id !== c.id && x.type !== "margen" && x.type !== "perdida")
      .reduce((s, x) => s + componentEffectiveTotal(x, all), 0);
    return base * (pct / 100);
  }
  return (c.quantity || 0) * (c.unitCost || 0);
}

// Devuelve el precio POR UNIDAD que debería tener la partida según su desglose,
// o null si no tiene desglose (ahí no hay con qué descuadrar). Es el mismo
// número que el servidor guarda en unitPrice al recalcular
// (recalcObraItem.ts → unitPrice = suma de los componentes).
function porUnidadDesglose(item: ObraItem): number | null {
  const comps = item.components ?? [];
  if (comps.length === 0) return null;
  return comps.reduce((s, c) => s + componentEffectiveTotal(c, comps), 0);
}

// ¿La partida está descuadrada respecto de su desglose?
//
// Se compara POR UNIDAD, no por total. Antes se comparaban los totales
// (porUnidad × cantidad) con umbral de $1, y eso AMPLIFICABA el redondeo: una
// partida sana con cantidad decimal y componentes con centavos (una herramienta
// 0,15 × $5.874, un margen en %) da un precio unitario de $7.913,26 contra los
// $7.913 guardados. Esos 26 centavos, multiplicados por 8,4 m², pasaban el
// umbral y pintaban un descuadre falso en partidas que estaban bien.
//
// Comparar por unidad deja el redondeo donde nació — sin que la cantidad lo
// infle — y es la misma convención que ya usa clientVisibleTotal() en
// versionDiff.ts, que resolvió este mismo ruido en las flechas de cambio.
//
// La segunda condición es una red de seguridad: cubre el caso de que el total
// guardado se haya quedado viejo respecto de la cantidad (P.U. correcto pero
// total de otra cantidad). La tolerancia crece con la cantidad porque el total
// se escribe a veces desde el P.U. exacto y a veces desde el redondeado, y esa
// ambigüedad legítima vale hasta medio peso por unidad.
function estaDescuadrada(item: ObraItem, porUnidad: number | null): boolean {
  if (porUnidad === null) return false;
  const cantidad = item.quantity ?? 0;
  const puGuardado = item.unitPrice ?? 0;
  const driftUnitario = Math.abs(porUnidad - puGuardado) > 1;
  const driftTotal =
    Math.abs((item.total ?? 0) - Math.round(puGuardado) * cantidad) >
    Math.abs(cantidad) + 1;
  return driftUnitario || driftTotal;
}

interface ObraItem {
  id: string;
  lineageId: string;
  chapterId: string | null;
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
  // BLARQ absorbe el costo: se le paga al maestro pero NO se le cobra al
  // cliente. Invisible en el PDF/total del cliente; normal en el alcance/EP
  // del maestro. Se marca acá con un toggle.
  noCobrado?: boolean;
  // Marca interna de revisión (MJ + JT): "esta partida ya la miramos".
  // Solo se dibuja en este editor — no sale en ningún PDF ni la ve el
  // cliente o el maestro. No entra en ningún cálculo.
  revisado?: boolean;
  components?: ObraItemComponent[];
}

interface PaymentTerm {
  id: string;
  stage: string;
  percentage: number;
  amount: number | null;
  sortOrder: number;
}

// Un capítulo de obra: fila propia de esta versión, con nombre libre y
// posición arrastrable (modelo ObraChapter). Ver lib/presupuesto/chapters.ts.
interface Chapter extends ChapterLike {
  id: string;
  name: string;
  sortOrder: number;
}

interface Budget {
  id: string;
  version: string;
  status: string;
  type: string;
  conditions: Condicion[];
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraChapters: Chapter[];
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
  baselineItems = null,
}: {
  budget: Budget;
  projectId: string;
  // Items de la foto de la última versión enviada al cliente. Null si no hay
  // versión base. Se usa para marcar qué partidas subieron/bajaron/son nuevas.
  baselineItems?: BaselineItem[] | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ObraItem[]>(initialBudget.obraItems);
  const [chapters, setChapters] = useState<Chapter[]>(initialBudget.obraChapters);

  // Marcas de cambio (subió/bajó/nuevo) por partida, contra la versión base.
  // Se recalcula en vivo cuando MJ edita: usa el total actual de cada item.
  // Mapa lineageId -> { marker, prevTotal }. Ver versionDiff.ts.
  const changeMarkers = useMemo<Map<string, ChangeResult>>(
    () =>
      computeChangeMarkers(
        items.map((it) => ({
          lineageId: it.lineageId,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          total: it.total,
        })),
        baselineItems
      ),
    [items, baselineItems]
  );
  const [ggPercent, setGgPercent] = useState(initialBudget.ggPercentage || 20);
  const [utilPercent, setUtilPercent] = useState(
    initialBudget.utilityPercentage || 5
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
  // Id del capítulo cuyo formulario "+ Agregar partida" está abierto.
  const [addingChapter, setAddingChapter] = useState<string | null>(null);
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  // Capítulo que se está renombrando inline (id) y el texto tipeado.
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState("");
  // Nombre tipeado en el campo libre del panel "+ Capítulo".
  const [newChapterName, setNewChapterName] = useState("");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  // Qué partida tiene la descripción del cliente abierta para editar INLINE en
  // la fila (sin abrir el panel). Solo una a la vez: el editor de texto con
  // formato es pesado, así que se monta on-demand al hacer clic y se desmonta
  // al salir (onChange de RichTextEditor dispara en blur → guarda y cierra).
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  // Provision price overrides: componentId → precio c/IVA ingresado por usuario
  const [provisionPrices, setProvisionPrices] = useState<Record<string, number>>({});
  // Edición inline de zona (subChapter) — por fila individual o por grupo
  // (renombrar la "bandita" gris renombra todas las partidas del grupo).
  const [editingZoneItemId, setEditingZoneItemId] = useState<string | null>(null);
  const [editingZoneGroup, setEditingZoneGroup] = useState<{ chapterId: string; name: string } | null>(null);
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
  //
  // Las partidas "NO COBRADO" (BLARQ absorbe el costo) NO entran en el costo
  // directo: no se le cobran al cliente, así que no pueden alimentar ni la
  // cascada hacia el total ni los montos de las cuotas de pago. Es el mismo
  // criterio de metrics.ts y del PDF de la cotización. Hasta el 2026-07-30 acá
  // se sumaban todas las partidas y este resumen mostraba un total más alto que
  // la tarjeta "Total Acordado" del proyecto — no se notaba porque no había
  // ningún presupuesto con partidas marcadas.
  //
  // La plata absorbida no desaparece de la pantalla: se muestra aparte, abajo
  // del desglose, para que MJ vea cuánto le está poniendo BLARQ.
  const itemsCobrables = items.filter((item) => !item.noCobrado);
  const totalNoCobrado = items.reduce(
    (sum, item) => (item.noCobrado ? sum + item.total : sum),
    0
  );
  const costoDirecto = itemsCobrables.reduce((sum, item) => sum + item.total, 0);
  const gastosGenerales = costoDirecto * (ggPercent / 100);
  const utilidad = costoDirecto * (utilPercent / 100);
  const neto = costoDirecto + gastosGenerales + utilidad;
  const iva = neto * 0.19;
  const totalConIva = neto + iva;

  // Agrupar por capítulo. La regla (orden de capítulos, orden de partidas
  // adentro, numeración salteando los vacíos, y el rescate de las partidas
  // huérfanas) vive en lib/presupuesto/chapters.ts — la MISMA que usan el PDF
  // del cliente, el del maestro, el Excel y el estado de pago.
  //
  // includeEmpty: en el editor SÍ se ven los capítulos vacíos (MJ acaba de
  // crearlos y todavía no les puso partidas); en el PDF no salen. Un capítulo
  // vacío no lleva número (index null) — así la numeración de la pantalla y la
  // del PDF nunca se separan.
  //
  // El desempate de las partidas EMPATADAS en sortOrder (los presupuestos
  // viejos tienen todo en 0) es propio del editor: zona y después nombre, con
  // localeCompare("es") para los acentos. Se aplica ACÁ, antes de agrupar,
  // porque el PDF y el estado de pago tienen su propio criterio y unificarlos
  // le cambiaría el orden a cotizaciones ya enviadas. Como groupByChapter
  // ordena de forma estable, este orden se respeta dentro de cada capítulo.
  const itemsOrdenados = [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aSub = a.subChapter ?? "";
    const bSub = b.subChapter ?? "";
    if (aSub !== bSub) return aSub.localeCompare(bSub, "es");
    return a.name.localeCompare(b.name, "es");
  });
  const itemsByChapter = groupByChapter(chapters, itemsOrdenados, {
    includeEmpty: true,
  }).map((g) => {
    // Zona DERIVADA por posición (helper compartido con el PDF): una partida
    // sin zona propia hereda la de arriba. Así la pantalla y el PDF agrupan
    // IGUAL y los subtotales de zona incluyen las partidas heredadas (ej: el
    // extractor recién creado sin zona, que cae al fondo de BAÑOS, ahora suma
    // en BAÑOS en vez de quedar en un grupo invisible). `zoneRows` va alineado
    // 1:1 con `items` (mismo orden) para leer la zona efectiva en el render.
    const { rows: zoneRows, zoneSubtotals, showZoneSubtotals } = annotateZones(
      g.items
    );
    return {
      key: g.chapter.id,
      label: g.chapter.name,
      index: g.index,
      // El capítulo sintético de rescate no es una fila real de la base: no se
      // puede renombrar, borrar ni arrastrar.
      esSintetico: g.chapter.id === SIN_CAPITULO_ID,
      items: g.items,
      zoneRows,
      subtotal: g.subtotal,
      subChapterSubtotals: zoneSubtotals,
      showZoneSubtotals,
    };
  });

  // Sugerencias para autocompletar zona: todas las zonas existentes
  // en el presupuesto, únicas y ordenadas.
  const zoneSuggestions = Array.from(
    new Set(items.map((i) => i.subChapter).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, "es"));

  // Orden de arrastre: solo en versiones editables (borrador/enviado). En
  // aprobado/rechazado la lista queda fija.
  const canReorder = ["borrador", "enviado"].includes(initialBudget.status);
  // Mismo gate que el detalle de costos: las descripciones se editan solo en
  // versiones no congeladas (borrador/enviado). En aprobado/rechazado son vista.
  const canEditDetail = ["borrador", "enviado"].includes(initialBudget.status);
  // Lista plana de ids EN EL ORDEN VISIBLE (capítulo por capítulo, y dentro de
  // cada uno el orden ya calculado arriba). dnd-kit ordena contra esta lista,
  // así que tiene que reflejar exactamente lo que se ve en pantalla.
  const orderedIds = itemsByChapter.flatMap((c) => c.items.map((i) => i.id));
  // Para dibujar el "fantasma" mientras se arrastra. Puede ser una partida o un
  // capítulo entero (los ids de capítulo vienen con el prefijo "cap:").
  const activeDragChapter =
    activeDragId && activeDragId.startsWith(CAP_DRAG_PREFIX)
      ? chapters.find(
          (c) => c.id === activeDragId.slice(CAP_DRAG_PREFIX.length)
        ) ?? null
      : null;
  const activeDragItem =
    activeDragId && !activeDragChapter
      ? items.find((i) => i.id === activeDragId) ?? null
      : null;
  // Solo envolvemos las filas con el arrastre real cuando está montado en el
  // cliente Y la versión es editable. Antes (SSR / 1ª hidratación): fila plana.
  const dndActive = dndMounted && canReorder;
  const RowWrapper = dndActive ? SortableRow : PlainRow;

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  // Un solo DndContext maneja los dos arrastres (capítulos enteros y partidas
  // sueltas), porque anidar dos contextos de dnd-kit pelea por el mismo puntero.
  // Acá se decide cuál es: los ids de capítulo vienen con el prefijo "cap:".
  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    if (String(e.active.id).startsWith(CAP_DRAG_PREFIX)) {
      return handleChapterDragEnd(e);
    }
    return handleItemDragEnd(e);
  }

  // Al soltar una partida: la reubico en el orden visible (arrayMove) y, si
  // cayó en otro capítulo, le cambio el capítulo al del destino (caso "metí
  // piso flotante en Eléctricas y lo arrastro a Terminaciones"). Después
  // reasigno sortOrder consecutivo a TODAS las partidas en el nuevo orden y lo
  // persisto, igual que el reorder del catálogo de artefactos.
  async function handleItemDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = orderedIds.indexOf(activeId);
    const newIndex = orderedIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;

    // El capítulo Y la zona de destino = los de la partida sobre la que se
    // soltó. La zona (subChapter) importa para que ARRASTRAR una partida
    // debajo del título de una zona (ej. BAÑOS) la deje guardada en esa zona,
    // sin tener que usar aparte el botón de zona. Antes el arrastre solo
    // movía la posición: la partida se veía bajo BAÑOS en el editor pero su
    // zona guardada quedaba vieja (o vacía), y el PDF —que agrupa por la zona
    // guardada— la mostraba huérfana arriba del capítulo. null = sin zona
    // (caer en un área sin zona, ej. el capítulo Limpieza, la deja sin zona).
    const overItem = items.find((i) => i.id === overId);
    const targetChapterId = overItem?.chapterId ?? null;
    const targetSubChapter = overItem ? overItem.subChapter ?? null : null;

    const newOrder = arrayMove(orderedIds, oldIndex, newIndex);
    const sortMap = new Map(newOrder.map((id, idx) => [id, idx]));

    // Optimista: actualizo el estado local antes de que conteste el servidor.
    const updated = items.map((it) => {
      const so = sortMap.get(it.id);
      const base = so !== undefined ? { ...it, sortOrder: so } : it;
      // Solo la partida arrastrada hereda capítulo y zona del destino.
      if (it.id === activeId) {
        return {
          ...base,
          ...(targetChapterId && targetChapterId !== it.chapterId
            ? { chapterId: targetChapterId }
            : {}),
          subChapter: targetSubChapter,
        };
      }
      return base;
    });
    setItems(updated);
    setSaveStatus("saving");

    try {
      const payload = newOrder.map((id) => {
        const it = updated.find((u) => u.id === id)!;
        return {
          id,
          sortOrder: it.sortOrder,
          chapterId: it.chapterId ?? undefined,
          subChapter: it.subChapter ?? null,
        };
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
  // ── Capítulos: crear, renombrar, borrar, reordenar ─────────────────────
  // Los nombres de siempre que todavía NO están en este presupuesto, para
  // ofrecerlos como atajo en el panel "+ Capítulo". Un presupuesto nuevo
  // arranca vacío (decisión MJ 2026-07-27): la lista clásica sigue a mano como
  // sugerencia, pero no como obligación.
  const sugerenciasDisponibles = CAPITULOS_SUGERIDOS.filter(
    (nombre) =>
      !chapters.some(
        (c) => c.name.trim().toUpperCase() === nombre.toUpperCase()
      )
  );

  async function crearCapitulo(nombre: string) {
    const name = nombre.trim();
    if (!name) return;
    setShowChapterPicker(false);
    setNewChapterName("");
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/capitulos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      if (!res.ok) throw new Error();
      const creado: Chapter = await res.json();
      setChapters((prev) => [...prev, creado]);
    } catch {
      alert("Error al crear el capítulo");
    }
  }

  async function renombrarCapitulo(chapterId: string, nombre: string) {
    const name = nombre.trim();
    setEditingChapterId(null);
    const actual = chapters.find((c) => c.id === chapterId);
    if (!name || !actual || actual.name === name) return;
    // Optimista: el nombre cambia en pantalla antes de que conteste el server.
    setChapters((prev) =>
      prev.map((c) => (c.id === chapterId ? { ...c, name } : c))
    );
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/capitulos/${chapterId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      if (!res.ok) throw new Error();
    } catch {
      setChapters((prev) =>
        prev.map((c) => (c.id === chapterId ? { ...c, name: actual.name } : c))
      );
      alert("Error al renombrar el capítulo");
    }
  }

  // Borrar solo capítulos vacíos: uno con partidas adentro es plata
  // presupuestada, y un click de más no se puede llevar medio presupuesto.
  // El server también lo controla (409 con el conteo).
  async function borrarCapitulo(chapterId: string) {
    const cantidad = items.filter((i) => i.chapterId === chapterId).length;
    if (cantidad > 0) {
      alert(
        `Este capítulo tiene ${cantidad} partida${cantidad === 1 ? "" : "s"}. ` +
          `Arrastralas a otro capítulo antes de borrarlo.`
      );
      return;
    }
    if (!confirm("¿Borrar este capítulo vacío?")) return;
    const previos = chapters;
    setChapters((prev) => prev.filter((c) => c.id !== chapterId));
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/capitulos/${chapterId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) {
      setChapters(previos);
      alert(e instanceof Error && e.message ? e.message : "Error al borrar");
    }
  }

  // Arrastrar un capítulo entero arriba/abajo. Solo cambia sortOrder: la
  // numeración que ve el cliente se recalcula sola al mostrar.
  async function handleChapterDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).slice(CAP_DRAG_PREFIX.length);
    const oldIdx = chapters.findIndex((c) => c.id === activeId);
    // Soltar un capítulo encima de una PARTIDA vale como soltarlo en el
    // capítulo de esa partida — si no, arrastrar un capítulo largo hasta el
    // medio de otro no hacía nada.
    const overRaw = String(over.id);
    const destinoId = overRaw.startsWith(CAP_DRAG_PREFIX)
      ? overRaw.slice(CAP_DRAG_PREFIX.length)
      : items.find((i) => i.id === overRaw)?.chapterId ?? "";
    const newIdx = chapters.findIndex((c) => c.id === destinoId);
    if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
    const previos = chapters;
    const reordenados = arrayMove(chapters, oldIdx, newIdx).map((c, i) => ({
      ...c,
      sortOrder: i,
    }));
    setChapters(reordenados);
    setSaveStatus("saving");
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/capitulos/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: reordenados.map((c) => c.id) }),
        }
      );
      if (!res.ok) throw new Error();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setChapters(previos);
      setSaveStatus("idle");
      alert("Error al guardar el orden de los capítulos");
    }
  }

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

  async function handleAddItem(chapterId: string) {
    if (!newItem.name) return;
    // El capítulo sintético de rescate no existe en la base: no se le pueden
    // agregar partidas.
    if (chapterId === SIN_CAPITULO_ID) return;

    try {
      const body: any = { ...newItem, chapterId };
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

      // Antes acá se mandaba, EN SILENCIO, un molde vacío al catálogo con solo
      // el nombre, la unidad y el precio de la partida recién creada. Ese molde
      // nacía sin desglose (todavía no existe al crear la partida) y sin quedar
      // enganchado al ObraItem, así que ensuciaba el catálogo sin servir de
      // nada — y encima chocaba por nombre con el guardado de verdad. Sacado
      // 2026-08-03: al catálogo se sube a conciencia, con el botón "Guardar al
      // catálogo" del panel de la partida, ya con el desglose adentro.

      resetAddForm();
    } catch {
      alert("Error al agregar partida");
    }
  }

  // Deja la partida marcada como "ya tiene molde" sin recargar la página,
  // después de guardarla al catálogo desde el panel. Con esto los botones del
  // panel pasan solos a los de las partidas que vienen del catálogo.
  function marcarConMolde(itemId: string, catalogPartidaId: string) {
    setItems((curr) =>
      curr.map((it) => (it.id === itemId ? { ...it, catalogPartidaId } : it))
    );
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

  // Marcar/desmarcar una partida como "NO COBRADO" (BLARQ absorbe el costo:
  // se le paga al maestro pero no se le cobra al cliente). PATCH liviano —
  // solo el flag — con update optimista de la UI.
  async function handleToggleNoCobrado(itemId: string, value: boolean) {
    setItems((curr) =>
      curr.map((i) => (i.id === itemId ? { ...i, noCobrado: value } : i))
    );
    setSaveStatus("saving");
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noCobrado: value }),
        }
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("idle");
    }
  }

  // Marcar/desmarcar una partida como REVISADA. Es una marca de trabajo
  // interna (MJ y JT): no la ve el cliente ni el maestro, no sale en PDFs y
  // no toca ningún total. Mismo PATCH liviano que noCobrado, con update
  // optimista para que el tilde responda al instante.
  async function handleToggleRevisado(itemId: string, value: boolean) {
    setItems((curr) =>
      curr.map((i) => (i.id === itemId ? { ...i, revisado: value } : i))
    );
    setSaveStatus("saving");
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisado: value }),
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
    chapterId: string,
    oldName: string,
    newName: string
  ) {
    const normalized = newName.trim();
    if (!normalized || normalized === oldName) return;
    const affected = items.filter(
      (i) => i.chapterId === chapterId && i.subChapter === oldName
    );
    setItems((curr) =>
      curr.map((i) =>
        i.chapterId === chapterId && i.subChapter === oldName
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
        `¿Actualizar la partida "${item.name}" en el catálogo?\n\n` +
          `Material: $${item.costMaterial ?? 0}\n` +
          `Mano de obra: $${item.costLabor ?? 0}\n` +
          `Herramientas: $${item.costTools ?? 0}\n` +
          `Margen: $${item.costMargin ?? 0}\n` +
          `Pérdida: $${item.costLoss ?? 0}\n` +
          `Subcontrato: $${item.costSubcontract ?? 0}\n` +
          `P. Unitario: $${item.unitPrice}\n\n` +
          `Se guarda el DESGLOSE completo (todas las líneas, incluida la pérdida)\n` +
          `en el catálogo (la biblioteca de moldes). NO toca ninguna otra\n` +
          `cotización: cada cotización es independiente.`
      )
    )
      return;
    try {
      // 1) Subir el DESGLOSE COMPLETO de la partida al catálogo (materiales,
      //    mano de obra, pérdida, margen, etc.). Antes esto NO se hacía: el
      //    botón solo mandaba los 6 montos globales y la pérdida del desglose
      //    nunca llegaba al catálogo. Si la partida no está vinculada al
      //    catálogo el endpoint responde 400 con mensaje claro.
      const resDesglose = await fetch(
        `/api/presupuestos/${initialBudget.id}/partidas/${item.id}/al-catalogo`,
        { method: "POST" }
      );
      if (!resDesglose.ok) {
        const err = await resDesglose.json().catch(() => ({}));
        throw new Error(err.error || "Error al subir el desglose");
      }

      // 2) Propagar los precios al catálogo + cotizaciones en borrador. El
      //    desglose ya quedó arriba (paso 1); este PUT actualiza los montos
      //    globales y hace la propagación a los borradores.
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
      await res.json();
      alert(
        `Catálogo actualizado (desglose + precios) para "${item.name}".\n\n` +
          `Solo se actualizó el molde del catálogo. Las demás cotizaciones no se tocaron.`
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al actualizar catálogo");
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
          `Esto afecta solo el molde del catálogo (para los proyectos FUTUROS).\n` +
          `NO toca ninguna otra cotización: cada cotización es independiente.`
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
      await res.json();
      alert(
        `Descripción del catálogo actualizada para "${item.name}".\n\n` +
          `Solo se actualizó el molde. Las demás cotizaciones no se tocaron.`
      );
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
                // Desglose fresco → la marca de "descuadrado" se recalcula
                // contra el detalle al día (si no viene, deja el que había).
                components: fresh.components ?? it.components,
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
              {/* Marca interna de revisión (MJ + JT). No sale en ningún PDF. */}
              <th
                className="text-center px-2 py-0.5 text-[10px] font-bold text-gray-900 uppercase tracking-wider w-10"
                title="Revisada — marca interna nuestra. No la ve el cliente ni el maestro y no sale en ningún PDF."
              >
                Rev.
              </th>
              <th className="w-6"></th>
            </tr>
          </thead>
        </table>
      </div>

      <DndContext
        id="obra-partidas-dnd"
        sensors={dndSensors}
        collisionDetection={detectarColision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
      <div className="space-y-0 -mt-3">
      {itemsByChapter.map((chapter) => (
        <ChapterDragBox
          key={chapter.key}
          id={chapter.key}
          enabled={dndActive && !chapter.esSintetico}
          className="bg-white border-x border-gray-200 overflow-visible last:border-b last:rounded-b-xl"
        >
          {(drag) => (
        <>
          {/* Chapter bar — gris claro, formato cuadro Excel */}
          <div
            ref={drag.setDropRef}
            className={`flex items-center justify-between px-4 py-1 bg-gray-200 border-y ${
              drag.isOver ? "border-gray-900" : "border-gray-200"
            }`}
          >
            <h3 className="flex items-center min-w-0 font-bold text-gray-900 text-xs uppercase tracking-wide">
              {/* Manija de arrastre del capítulo entero. Solo acá van los
                  listeners: si estuvieran en toda la barra, no se podría
                  hacer click en el nombre para renombrarlo. */}
              {dndActive && !chapter.esSintetico ? (
                <button
                  {...drag.attributes}
                  {...drag.listeners}
                  className="mr-1 -ml-1 px-1 text-gray-400 hover:text-gray-900 cursor-grab active:cursor-grabbing shrink-0"
                  title="Arrastrar para mover el capítulo"
                  aria-label="Mover capítulo"
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                    <circle cx="2.5" cy="3" r="1.1" /><circle cx="7.5" cy="3" r="1.1" />
                    <circle cx="2.5" cy="7" r="1.1" /><circle cx="7.5" cy="7" r="1.1" />
                    <circle cx="2.5" cy="11" r="1.1" /><circle cx="7.5" cy="11" r="1.1" />
                  </svg>
                </button>
              ) : (
                <span className="mr-1 -ml-1 px-1 w-[18px] shrink-0" />
              )}
              {/* Un capítulo vacío no lleva número y no sale en el PDF. */}
              <span className="inline-block w-6 shrink-0">
                {chapter.index ?? <span className="text-gray-400">—</span>}
              </span>
              {editingChapterId === chapter.key ? (
                <input
                  autoFocus
                  value={chapterNameDraft}
                  onChange={(e) => setChapterNameDraft(e.target.value)}
                  onBlur={() => renombrarCapitulo(chapter.key, chapterNameDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingChapterId(null);
                  }}
                  className="min-w-0 flex-1 bg-white border border-gray-400 rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide focus:outline-none focus:border-gray-900"
                />
              ) : (
                <button
                  onClick={() => {
                    if (chapter.esSintetico || !canEditDetail) return;
                    setChapterNameDraft(chapter.label);
                    setEditingChapterId(chapter.key);
                  }}
                  className={`truncate text-left ${
                    chapter.esSintetico || !canEditDetail
                      ? "cursor-default"
                      : "hover:underline decoration-dotted underline-offset-2"
                  }`}
                  title={
                    chapter.esSintetico
                      ? "Partidas sin capítulo — arrastralas al capítulo que corresponda"
                      : canEditDetail
                      ? "Click para renombrar"
                      : undefined
                  }
                >
                  {chapter.label}
                </button>
              )}
              {chapter.items.length === 0 && !chapter.esSintetico && (
                <span className="ml-2 shrink-0 text-[10px] font-medium normal-case tracking-normal text-gray-500">
                  vacío · no sale en el PDF
                </span>
              )}
            </h3>
            <div className="flex items-center gap-5 shrink-0">
              <span className="text-xs font-medium text-gray-700 tabular-nums">
                Subtotal {formatCLP(chapter.subtotal)}
              </span>
              {!chapter.esSintetico && (
                <button
                  onClick={() => {
                    resetAddForm();
                    setAddingChapter(chapter.key);
                  }}
                  className="text-xs font-semibold text-gray-700 hover:text-black uppercase tracking-wide"
                >
                  + Agregar
                </button>
              )}
              {/* Borrar: solo capítulos vacíos (uno con partidas es plata
                  presupuestada). Por eso el botón aparece únicamente cuando
                  no hay nada adentro. */}
              {chapter.items.length === 0 &&
                !chapter.esSintetico &&
                canEditDetail && (
                  <button
                    onClick={() => borrarCapitulo(chapter.key)}
                    className="text-gray-400 hover:text-gray-900"
                    title="Borrar capítulo vacío"
                    aria-label="Borrar capítulo"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                )}
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
                  <col className="w-10" />
                  <col className="w-6" />
                </colgroup>
                <tbody className="divide-y divide-gray-50">
                  {chapter.items.map((item, itemIdx) => {
                    const chg = changeMarkers.get(item.lineageId);
                    // Zona EFECTIVA (derivada por posición, alineada 1:1 con
                    // items): la bandita gris se muestra en la primera partida
                    // de cada zona, no en cada cambio del campo crudo.
                    const zoneRow = chapter.zoneRows[itemIdx];
                    const zone = zoneRow?.zone ?? null;
                    const showSubHeader = zoneRow?.isZoneStart ?? false;
                    // Descuadre: el precio guardado no coincide con la suma de
                    // su desglose → el número de arriba es una "foto" vieja.
                    // Marca roja para que MJ esté atenta antes de enviar.
                    // El criterio vive en estaDescuadrada() — se compara por
                    // unidad para que el redondeo no se multiplique por la
                    // cantidad y prenda alarmas falsas.
                    const realPorUnidad = porUnidadDesglose(item);
                    const descuadrada = estaDescuadrada(item, realPorUnidad);
                    return (
                    <Fragment key={item.id}>
                    {showSubHeader && (
                      <tr className="bg-gray-100/70 border-y border-gray-200">
                        <td
                          colSpan={8}
                          className="px-3 py-0.5 text-[10px] font-semibold text-gray-600 uppercase tracking-wider"
                        >
                          {editingZoneGroup &&
                          editingZoneGroup.chapterId === chapter.key &&
                          editingZoneGroup.name === zone ? (
                            <input
                              autoFocus
                              value={zoneDraft}
                              onChange={(e) => setZoneDraft(e.target.value)}
                              onBlur={() => {
                                handleRenameZoneGroup(
                                  chapter.key,
                                  zone!,
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
                                setZoneDraft(zone ?? "");
                                setEditingZoneGroup({
                                  chapterId: chapter.key,
                                  name: zone!,
                                });
                              }}
                              className="hover:text-gray-900"
                              title="Renombrar zona (afecta todas las partidas de este grupo)"
                            >
                              {zone}
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
                                chapter.subChapterSubtotals.get(zone ?? "") ?? 0
                              )
                            : ""}
                        </td>
                        {/* Rev. + acciones — vacías en la bandita de zona. */}
                        <td></td>
                        <td></td>
                      </tr>
                    )}
                    <RowWrapper id={item.id} disabled={!canReorder}>
                    {(drag) => (
                    <tr
                      ref={drag.setNodeRef}
                      style={{
                        ...drag.style,
                        // Revisada → la fila se atenúa, así la vista queda
                        // dominada por lo que FALTA revisar. Va acá en el
                        // style inline y NO como clase de Tailwind: dnd-kit
                        // ya escribe `opacity` inline en cada fila (ver
                        // SortableRow) y una clase no le gana. Mientras se
                        // arrastra manda dnd-kit y esto no se aplica.
                        ...(item.revisado && !drag.isDragging
                          ? { opacity: 0.6 }
                          : null),
                      }}
                      className={`border-b border-gray-100 hover:bg-gray-50/60 group ${
                        item.noCobrado
                          ? "bg-amber-50/60 shadow-[inset_3px_0_0_theme(colors.amber.500)]"
                          : selectedItemIds.has(item.id) || drag.isDragging
                            ? "bg-gray-50"
                            : ""
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
                        {/* Marca de cambio vs. la última versión enviada al
                            cliente. Las flechas (subió/bajó) cuelgan a la DERECHA
                            del número con posición absoluta — son chiquitas (un
                            carácter) y no estorban. La pastilla "NUEVO", que es
                            ancha, se dibuja al INICIO del nombre (celda de al
                            lado) con su propio espacio, para que no tape el texto
                            de la partida ni la manija de arrastre. */}
                        <span className="relative inline-block">
                          {chg?.marker === "up" && (
                            <span
                              className="absolute left-full top-1/2 -translate-y-1/2 ml-1 font-bold leading-none text-gray-900"
                              title={
                                chg.prevTotal != null
                                  ? `Subió · antes ${formatCLP(chg.prevTotal)} → ahora ${formatCLP(item.total)}`
                                  : "Subió respecto a la versión enviada"
                              }
                            >
                              ↑
                            </span>
                          )}
                          {chg?.marker === "down" && (
                            <span
                              className="absolute left-full top-1/2 -translate-y-1/2 ml-1 font-bold leading-none text-gray-900"
                              title={
                                chg.prevTotal != null
                                  ? `Bajó · antes ${formatCLP(chg.prevTotal)} → ahora ${formatCLP(item.total)}`
                                  : "Bajó respecto a la versión enviada"
                              }
                            >
                              ↓
                            </span>
                          )}
                          {chapter.index}.{itemIdx + 1}
                        </span>
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
                            todo el nombre aunque sea largo (la fila crece).
                            Guarda AL TERMINAR (al salir del campo / blur), no en
                            cada tecla — mismo criterio que la celda Cantidad de
                            al lado y que MoneyInput (PR #102). Con `defaultValue`
                            (no `value`) MJ escribe el nombre completo sin que
                            cada tecla dispare setItems + el re-render de toda la
                            tabla. El onChange solo ajusta el alto del textarea
                            (visual); el guardado ocurre en onBlur. Cambia CUÁNDO
                            se guarda, no QUÉ se guarda.

                            La pastilla "NUEVO" va acá adelante, en un flex, con
                            su propio espacio (shrink-0): el nombre queda a su
                            derecha y nunca arranca debajo de ella. */}
                        <div className="flex items-start gap-1.5 flex-wrap">
                          {chg?.marker === "added" && (
                            <span
                              className="mt-0.5 shrink-0 inline-block whitespace-nowrap rounded-full border border-gray-900 px-1 text-[8px] font-semibold uppercase leading-none tracking-wide text-gray-900"
                              title="Partida nueva — no estaba en la versión enviada al cliente"
                            >
                              Nuevo
                            </span>
                          )}
                          {item.noCobrado && (
                            <span
                              className="mt-0.5 shrink-0 inline-block whitespace-nowrap rounded-full bg-amber-100 px-1.5 text-[8px] font-semibold uppercase leading-none tracking-wide text-amber-800 py-0.5"
                              title="No se le cobra al cliente — BLARQ absorbe el costo. Igual va en el alcance/EP del maestro."
                            >
                              No cobrado
                            </span>
                          )}
                          <textarea
                            ref={(el) => {
                              if (el) {
                                el.style.height = "auto";
                                el.style.height = `${el.scrollHeight}px`;
                              }
                            }}
                            defaultValue={item.name}
                            onChange={(e) => {
                              e.currentTarget.style.height = "auto";
                              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                            }}
                            onBlur={(e) => {
                              if (e.target.value !== item.name) {
                                handleUpdateItem(item.id, "name", e.target.value);
                              }
                            }}
                            rows={1}
                            className="text-force-11 w-full resize-none bg-transparent border-0 p-0 text-gray-900 focus:ring-0 outline-none uppercase leading-snug overflow-hidden"
                            style={{ minHeight: "16px" }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-0.5 align-top">
                        {/* DESCRIPCION CLIENTE (la que va al PDF). Se edita INLINE
                            acá mismo: un clic monta el editor de texto con formato
                            (la barra de formato es flotante, ya no ocupa lugar) y
                            al salir guarda y vuelve a la vista. La del MAESTRO vive
                            solo en el panel expandido. En versiones congeladas
                            (aprobado/rechazado) es solo vista; el clic abre el
                            panel para consultarla. */}
                        {canEditDetail && editingDescId === item.id ? (
                          <div className="[&_.ProseMirror]:!text-[10px] [&_.ProseMirror]:!leading-snug [&_.ProseMirror]:!min-h-[18px] [&_.ProseMirror]:!py-0.5 [&_.ProseMirror]:!px-1.5 [&_.ProseMirror_p]:!my-0 [&_.ProseMirror_li]:!my-0">
                            <RichTextEditor
                              value={item.descriptionCliente}
                              autoFocus
                              placeholder="Descripción para el cliente (PDF)…"
                              onChange={(html) => {
                                // RichTextEditor dispara onChange en blur (al salir).
                                // Guardamos solo si cambió y cerramos la edición inline.
                                if (html !== (item.descriptionCliente ?? "")) {
                                  handleUpdateItem(item.id, "descriptionCliente", html);
                                }
                                setEditingDescId(null);
                              }}
                            />
                          </div>
                        ) : (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (canEditDetail) setEditingDescId(item.id);
                              else
                                setExpandedItems((prev) => ({ ...prev, [item.id]: true }));
                            }}
                            title={
                              canEditDetail
                                ? "Clic para editar la descripción del cliente acá mismo"
                                : "Clic para ver el detalle"
                            }
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
                        )}
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
                        {/* Cantidad: guarda AL TERMINAR (al salir del campo o
                            Enter), no en cada tecla. Sin esto, tipear cifras de
                            varios dígitos recalculaba el total tecla a tecla y
                            no dejaba escribir tranquila. `defaultValue` +
                            `onBlur` = el número final es exactamente el escrito. */}
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={item.quantity}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            if (v !== item.quantity) {
                              handleUpdateItem(item.id, "quantity", v);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              (e.target as HTMLInputElement).blur();
                          }}
                          className="text-force-11 w-full min-w-0 bg-transparent border-0 p-0 text-right text-gray-900 tabular-nums focus:ring-0 outline-none"
                        />
                      </td>
                      {/* Mano de obra y P. Unitario: cuando la partida TIENE
                          desglose, el encabezado es un ESPEJO de la suma del
                          desglose → solo lectura (se edita abajo, en el
                          detalle). Si todavía no tiene desglose, se pueden
                          cargar a mano acá (estado transitorio). */}
                      <td className="px-3 py-0.5 align-top" title="Mano de obra por unidad — lo que pagás al maestro por cada m²/un/ml">
                        {(item.components?.length ?? 0) > 0 ? (
                          <div className="text-right text-sm text-amber-800/80 tabular-nums" title="Viene del desglose — se edita abajo">
                            {formatCLP(item.costLabor ?? 0)}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-0.5 tabular-nums">
                            <span className="text-amber-700/60 text-sm">$</span>
                            <MoneyInput
                              value={item.costLabor ?? 0}
                              onChange={(v) => handleUpdateItem(item.id, "costLabor", v)}
                              className="w-16 bg-transparent border-0 p-0 text-right text-sm text-amber-800 tabular-nums focus:ring-0 outline-none"
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-0.5 align-top">
                        {(item.components?.length ?? 0) > 0 ? (
                          <div className="text-right text-sm text-gray-900 tabular-nums" title="Viene del desglose — se edita abajo">
                            {formatCLP(item.unitPrice)}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-0.5 tabular-nums">
                            <span className="text-gray-400 text-sm">$</span>
                            <MoneyInput
                              value={item.unitPrice}
                              onChange={(v) => handleUpdateItem(item.id, "unitPrice", v)}
                              className="w-20 bg-transparent border-0 p-0 text-right text-sm text-gray-900 tabular-nums focus:ring-0 outline-none"
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-0.5 align-top text-right text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {saveStatus === "saving" && (
                            <span className="text-[10px] text-gray-400 animate-pulse hidden group-hover:inline">guardando…</span>
                          )}
                          {saveStatus === "saved" && (
                            <span className="text-[10px] text-green-600 hidden group-hover:inline">✓</span>
                          )}
                          {descuadrada && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedItems((prev) => ({
                                  ...prev,
                                  [item.id]: true,
                                }))
                              }
                              title={`Este total (${formatCLP(item.total)}) quedó como una "foto" vieja: el precio unitario guardado (${formatCLP(item.unitPrice)}) no coincide con la suma de su desglose (${formatCLP(realPorUnidad ?? 0)} por ${item.unit}). Hacé clic para abrir el desglose y editá/confirmá una línea: así se recalcula y vuelve a coincidir.`}
                              aria-label="Total descuadrado respecto al desglose"
                              className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 hover:ring-2 hover:ring-red-200"
                            />
                          )}
                          {formatCLP(item.total)}
                        </div>
                      </td>
                      {/* REVISADA — cuadradito interno nuestro (MJ + JT).
                          Nunca sale en un PDF ni lo ve el cliente/maestro:
                          solo vive en esta pantalla. */}
                      <td className="px-2 py-1 align-top text-center">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 align-middle accent-gray-900 cursor-pointer"
                          checked={!!item.revisado}
                          onChange={(e) =>
                            handleToggleRevisado(item.id, e.target.checked)
                          }
                          aria-label="Partida revisada"
                          title={
                            item.revisado
                              ? "Revisada — destildá para volver a marcarla como pendiente de revisar"
                              : "Marcar como revisada (marca interna nuestra, no sale en ningún PDF)"
                          }
                        />
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
                        <td colSpan={11} className="p-0">
                          {/* Toggle NO COBRADO: BLARQ absorbe el costo (se le
                              paga al maestro pero no se le cobra al cliente).
                              Solo editable en versiones no congeladas. */}
                          <label
                            className={`flex items-center gap-2 px-4 py-2 border-b border-gray-200 text-xs ${
                              canEditDetail
                                ? "cursor-pointer text-gray-700"
                                : "cursor-default text-gray-400"
                            }`}
                            title="No se le cobra al cliente — no aparece en el PDF ni suma al total. Igual va en el alcance/EP del maestro."
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-amber-600"
                              checked={!!item.noCobrado}
                              disabled={!canEditDetail}
                              onChange={(e) =>
                                handleToggleNoCobrado(item.id, e.target.checked)
                              }
                            />
                            <span>
                              No cobrar al cliente
                              <span className="text-gray-400">
                                {" "}
                                — BLARQ absorbe el costo (invisible en el PDF y
                                el total; igual va al alcance/EP del maestro)
                              </span>
                            </span>
                          </label>
                          <PartidaExpandedPanel
                            item={item}
                            saveStatus={saveStatus}
                            budgetId={initialBudget.id}
                            initialComponentCount={item.components?.length ?? 0}
                            canEdit={["borrador", "enviado"].includes(initialBudget.status)}
                            onUpdate={(field, value) =>
                              handleUpdateItem(item.id, field, value)
                            }
                            onUpdateCatalog={() => handleUpdateCatalog(item)}
                            onUpdateCatalogDescription={() =>
                              handleUpdateCatalogDescription(item)
                            }
                            onComponentsChanged={() => refreshItemTotals(item.id)}
                            onSavedToCatalog={(catalogPartidaId) =>
                              marcarConMolde(item.id, catalogPartidaId)
                            }
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
                    {/* Antes decía "Se guardara automaticamente en el catalogo".
                        Era mentira a medias: mandaba al catálogo un molde VACÍO,
                        sin el desglose (que todavía no existe al crear) y sin
                        quedar enganchado a esta partida. Ahora al catálogo se
                        sube a conciencia, ya con el desglose armado. */}
                    <span className="text-xs text-gray-400">
                      Después la podés guardar al catálogo, con su desglose
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
        </>
          )}
        </ChapterDragBox>
      ))}
      </div>
      </SortableContext>
      {/* Fantasma que sigue al cursor mientras se arrastra una partida. Es una
          versión liviana de la fila (nombre + total), suficiente para que MJ
          vea qué está moviendo sin arrastrar toda la tabla. */}
      <DragOverlay>
        {activeDragChapter ? (
          <div className="flex items-center gap-3 bg-gray-200 border border-gray-400 rounded shadow-sm px-3 py-1.5 text-xs">
            <span className="text-gray-500">⋮⋮</span>
            <span className="font-bold text-gray-900 uppercase tracking-wide truncate max-w-[320px]">
              {activeDragChapter.name}
            </span>
          </div>
        ) : activeDragItem ? (
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

      {/* "+ Capítulo": crea un capítulo nuevo. Un presupuesto arranca SIN
          capítulos; los 8 de siempre siguen a mano acá como sugerencia (un
          click y listo) pero se puede escribir cualquier nombre. */}
      {canEditDetail && (
        <div className="relative" ref={chapterPickerRef}>
          <button
            onClick={() => setShowChapterPicker((s) => !s)}
            className="text-sm text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors"
          >
            + Capítulo
          </button>
          {showChapterPicker && (
            <div className="absolute z-10 mt-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden min-w-[300px]">
              <div className="px-4 pt-3 pb-2">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Nombre del capítulo
                </label>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newChapterName}
                    onChange={(e) => setNewChapterName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") crearCapitulo(newChapterName);
                      if (e.key === "Escape") setShowChapterPicker(false);
                    }}
                    placeholder="Ej: TERRAZA Y JARDIN"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm uppercase focus:outline-none focus:border-gray-900"
                  />
                  <button
                    onClick={() => crearCapitulo(newChapterName)}
                    disabled={!newChapterName.trim()}
                    className="px-3 py-1 text-sm font-medium bg-gray-900 text-white rounded disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    Crear
                  </button>
                </div>
              </div>
              {sugerenciasDisponibles.length > 0 && (
                <>
                  <div className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-wider text-gray-500 border-t border-gray-100">
                    Los de siempre
                  </div>
                  <div className="pb-2 max-h-64 overflow-y-auto">
                    {sugerenciasDisponibles.map((nombre) => (
                      <button
                        key={nombre}
                        onClick={() => crearCapitulo(nombre)}
                        className="w-full text-left px-4 py-1.5 text-sm hover:bg-gray-50 transition-colors"
                      >
                        {nombre}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
              // suma de cost{X} × quantity en todos los items COBRABLES —
              // las "NO COBRADO" van aparte, igual que en el costo directo.
              const sumByType = itemsCobrables.reduce(
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
                  {/* Lo que BLARQ absorbe. Va DEBAJO del costo directo y con el
                      ámbar de las partidas NO COBRADO: no suma al cliente, pero
                      es plata que sale igual y MJ tiene que verla. */}
                  {totalNoCobrado > 0 && (
                    <div className="flex items-center justify-between text-sm pt-1.5">
                      <span className="text-amber-700">No cobrado (lo absorbe BLARQ)</span>
                      <span className="tabular-nums font-medium text-amber-700">
                        {formatCLP(totalNoCobrado)}
                      </span>
                    </div>
                  )}
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

      {/* Condiciones que salen en el PDF (antes: texto fijo en el código) */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CondicionesEditor
          modo="cotizacion"
          tipo="obra"
          budgetId={initialBudget.id}
          inicial={initialBudget.conditions}
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
