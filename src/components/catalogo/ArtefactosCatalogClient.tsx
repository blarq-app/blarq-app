"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber, edadRevisionPrecio } from "@/lib/utils";
import { fileToThumbnailDataUrl } from "@/lib/imageThumbnail";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CatalogItem {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  subcategory: string;
  tag: string | null;
  line: string | null; // línea comercial (Asis, Urban, Stellar…) — solo etiqueta
  finish: string | null; // color/terminación (Cromo, Brushed…) — solo etiqueta
  subgroup: string | null; // CARPETA manual dentro del tipo (null = sin carpeta)
  supplier: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  listPrice: number; // precio web / lista
  discountPercent: number | null; // legacy
  realCostBlarq: number | null; // mi costo (lo que paga BLARQ)
  isStandard: boolean;
  sortOrder: number;
  lastPriceCheck: Date | string | null;
}

// Total a cliente = precio lista menos el descuento. Es lo que paga el
// cliente (como la columna TOTAL del Excel de MJ). Si no hay descuento,
// el total es la lista tal cual.
function clientTotal(it: {
  listPrice: number;
  discountPercent: number | null;
}): number {
  return Math.round(it.listPrice * (1 - (it.discountPercent ?? 0)));
}

// "2026-07-14" → "14-07". Para los avisos de la revisión de precios.
function fechaCorta(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Src a usar para mostrar una imagen. Las externas (mk.cl / CDN de la tienda)
// se sirven a través de NUESTRO proxy, para que ningún bloqueador del
// navegador las frene. Las subidas (data:) y las relativas van directo.
function imgSrc(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/catalogo/img-proxy?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// Fila que devuelve el endpoint "Revisar precios" (guardado vs web ahora).
interface PriceReviewRow {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  referenceLink: string;
  storedListPrice: number;
  storedDiscount: number;
  storedTotal: number;
  webListPrice: number | null;
  webDiscount: number | null; // decimal 0..1
  webTotal: number | null; // lo que pagaría el cliente con el web de hoy
  delta: number | null; // webTotal - storedTotal
  // La tienda publica lista Y precio de venta (VTEX/Shopify). Si es false, el
  // descuento leído no es confiable y NO se pisa el que ya está guardado.
  discountKnown?: boolean;
  changed?: boolean; // hay algo que aplicar (lista, dcto o total difieren)
  status: "ok" | "sin-precio" | "error";
  // Cuando no se puede leer: qué decía la tienda la última vez que sí se pudo,
  // y desde cuándo está así. MK da de baja los productos sin stock y los
  // repone, así que esto NO es un link roto que MJ tenga que arreglar.
  ultimaLecturaBuena?: { listPrice: number | null; salePrice: number | null; cuando: string } | null;
  sinLeerDesde?: string | null;
  applied?: boolean; // marcada como aplicada en esta sesión
}

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Sanitario",
  cocina: "Cocina",
  iluminacion: "Iluminación",
};

const SUBCATEGORY_OPTIONS = ["sanitario", "cocina", "iluminacion"];

// Los tipos para agrupar (Accesorios, Griferías, WC…) son el campo "tag" del
// artefacto. Antes vivían fijos acá (TIPO_OPTIONS_BY_SUB); ahora son editables
// por MJ y viven en la tabla ArtefactoTipo. La lista por pestaña llega como
// `initialTipos` y se maneja con tiposDe()/tiposInTab dentro del componente.
// Los tipos iniciales (los de antes) se siembran con scripts/setup-artefacto-tipos.ts.

// A partir de cuántos ítems tiene un tipo, sus carpetas arrancan COLAPSADAS por
// default. La idea: en tipos largos (ej. Accesorios) MJ ve primero el "índice"
// de carpetas y abre la que busca.
const SUBGROUP_COLLAPSE_THRESHOLD = 8;

// Subgrupo de un tipo = una CARPETA manual (campo subgroup). Los ítems sin
// carpeta caen en "Sin carpeta / Otros" (hasName=false), que va al final.
interface Subgroup {
  key: string;
  name: string; // nombre de la carpeta ("" = sin carpeta)
  hasName: boolean;
  items: CatalogItem[];
}

// Parte los ítems de un tipo en CARPETAS (campo subgroup). El orden lo da
// `orderOf` (orden manual que MJ arrastró, guardado en ArtefactoSubgroupOrder):
// las carpetas con orden guardado van primero por ese número; las que no tienen
// caen al fallback alfabético, con "Sin carpeta / Otros" al final. Editar la
// línea o el color YA NO mueve de carpeta — la carpeta es independiente.
function buildSubgroups(
  groupItems: CatalogItem[],
  orderOf?: (name: string) => number | undefined
): Subgroup[] {
  const byKey = new Map<string, Subgroup>();
  for (const it of groupItems) {
    const name = (it.subgroup ?? "").trim();
    const hasName = !!name;
    const key = hasName ? name : "__sincarpeta__";
    const existing = byKey.get(key);
    if (existing) existing.items.push(it);
    else byKey.set(key, { key, name, hasName, items: [it] });
  }
  return [...byKey.values()].sort((a, b) => {
    const oa = orderOf?.(a.name);
    const ob = orderOf?.(b.name);
    if (oa != null && ob != null) return oa - ob;
    if (oa != null) return -1; // las que tienen orden manual, primero
    if (ob != null) return 1;
    if (a.hasName !== b.hasName) return a.hasName ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── IDs para el drag & drop unificado ──────────────────────────────────────
// Todo (tipos, carpetas, artefactos) vive en UN solo DndContext para poder
// arrastrar un artefacto de una carpeta/tipo a otro. Para saber qué se está
// arrastrando y sobre qué se soltó, cada id lleva prefijo: "T#"=tipo,
// "S#"=carpeta, "I#"=artefacto. Las carpetas no tienen id propio, así que su id
// se arma con tipo + nombre de carpeta (separados por un carácter que no
// aparece en los datos).
const SUB_SEP = "\u0001";
const tipoSortId = (tipoId: string) => `T#${tipoId}`;
const itemSortId = (itemId: string) => `I#${itemId}`;
const subgroupSortId = (tag: string, name: string) =>
  `S#${tag}${SUB_SEP}${name}`;
function parseSubgroupId(id: string): { tag: string; name: string } {
  const [tag, name] = id.slice(2).split(SUB_SEP);
  return { tag: tag ?? "", name: name ?? "" };
}

// Chevron monocromático (sin dependencias de íconos): apunta a la derecha y se
// rota 90° cuando el subgrupo está abierto.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-gray-400 shrink-0 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// Sugerencia de "nombre corto" a partir del título extraído del producto.
// Saca la marca del final (ej. "... Teka") y lo pasa a mayúsculas, igual que
// los nombres de la carga automática. Es solo una sugerencia: MJ la edita.
function sugerirNombreCorto(
  titulo?: string | null,
  marca?: string | null
): string {
  if (!titulo) return "";
  let s = titulo.trim();
  if (marca && s.toLowerCase().endsWith(marca.toLowerCase())) {
    s = s.slice(0, -marca.length).trim();
  }
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

// Layout de columnas compartido entre el encabezado y cada fila. La primera
// columna angosta es la manija para arrastrar.
// 14 columnas: manija · img · nombre/marca · LÍNEA · COLOR · detalle/link ·
// subcat/tipo · lista · dcto · total · mi costo · gan · std · editar. Nombre y
// detalle envuelven a 2 líneas (no se cortan) en vez de truncar.
const GRID_COLS =
  "grid-cols-[1.25rem_3.25rem_minmax(9rem,1.5fr)_5rem_5rem_minmax(6rem,1.1fr)_4.25rem_2.5rem_5rem_4.5rem_4.5rem_2rem_4.25rem]";

// Input numérico con separadores de miles.
function ThousandsInput({
  value,
  onChange,
  className = "",
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value === 0
      ? ""
      : String(value)
    : value === 0
    ? ""
    : formatNumber(value);
  return (
    <input
      type={focused ? "number" : "text"}
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={className}
    />
  );
}

// Tipo editable del catálogo (antes vivía fijo en TIPO_OPTIONS_BY_SUB).
interface ArtefactoTipo {
  id: string;
  subcategory: string;
  name: string;
  sortOrder: number;
}

// Orden manual de una CARPETA dentro de un tipo. subgroup "" = "Sin carpeta /
// Otros".
interface SubgroupOrder {
  subcategory: string;
  tag: string;
  subgroup: string;
  sortOrder: number;
}

export default function ArtefactosCatalogClient({
  initialItems,
  initialTipos,
  initialSubgroupOrders,
}: {
  initialItems: CatalogItem[];
  initialTipos: ArtefactoTipo[];
  initialSubgroupOrders: SubgroupOrder[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialItems);
  // Tipos editables por pestaña. Reemplazan a la lista fija del código.
  const [tipos, setTipos] = useState<ArtefactoTipo[]>(initialTipos);
  // Orden manual de los subgrupos (línea+color) que MJ arrastró. Lo que no
  // está acá cae a orden alfabético (ver buildSubgroups).
  const [subgroupOrders, setSubgroupOrders] = useState<SubgroupOrder[]>(
    initialSubgroupOrders
  );
  const [activeTab, setActiveTab] = useState<string>("sanitario");
  const [onlyStandard, setOnlyStandard] = useState(false);
  const [adding, setAdding] = useState(false);
  // Búsqueda por texto libre dentro de la pestaña: matchea cualquier palabra
  // contra nombre, marca, detalle, línea, color y tipo (ej. "mampara",
  // "brushed"). Cada palabra tiene que aparecer (AND).
  const [search, setSearch] = useState("");
  // Ref del formulario de alta para hacer scroll cuando se abre desde el
  // botón "+ agregar" de un grupo (que vive abajo en la lista).
  const addFormRef = useRef<HTMLFormElement>(null);
  // Filtros por tipo, línea y color (se eligen del listado de la pestaña activa).
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterLine, setFilterLine] = useState<string | null>(null);
  const [filterFinish, setFilterFinish] = useState<string | null>(null);
  // Si está seteado, el formulario está editando ese artefacto (no creando).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Subgrupos línea+color que MJ abrió/cerró a mano. La clave guarda el estado
  // "abierto" (true) y pisa el default (colapsado en tipos largos). Lo que no
  // está acá usa el default por cantidad de ítems del tipo.
  const [openSubgroups, setOpenSubgroups] = useState<Record<string, boolean>>(
    {}
  );
  // Renombrar una CARPETA. Guarda la clave de la carpeta en edición y el nombre
  // tipeado; al guardar se aplica a todos sus artefactos (cambia su campo
  // subgroup). Si el nombre nuevo coincide con otra carpeta, se fusionan.
  const [renamingSubKey, setRenamingSubKey] = useState<string | null>(null);
  const [renameFolder, setRenameFolder] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  // Mover una carpeta entera a otro tipo. Guarda la clave de la carpeta cuyo
  // selector de "mover a" está abierto.
  const [movingSubKey, setMovingSubKey] = useState<string | null>(null);
  // Manejo de tipos: alta nueva + renombrado del encabezado.
  const [creatingTipo, setCreatingTipo] = useState(false);
  const [newTipoName, setNewTipoName] = useState("");
  const [renamingTipoId, setRenamingTipoId] = useState<string | null>(null);
  const [renameTipoName, setRenameTipoName] = useState("");
  const [tipoBusy, setTipoBusy] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    detail: "",
    brand: "",
    subcategory: "sanitario",
    tag: "",
    line: "",
    finish: "",
    supplier: "",
    referenceLink: "",
    imageUrl: "",
    listPrice: 0,
    realCostBlarq: 0,
    discountPercent: 0,
    isStandard: false,
  });
  const [extractingForNew, setExtractingForNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── "Revisar precios" ─────────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewRows, setReviewRows] = useState<PriceReviewRow[]>([]);
  const [reviewResumen, setReviewResumen] = useState<{
    conLink: number;
    cambiaron: number;
    noLeidos: number;
    // Fotos que se repusieron solas en esta pasada porque el link a la foto del
    // proveedor ya no cargaba. No hay nada que aplicar: ya quedaron guardadas.
    fotosReparadas?: number;
  } | null>(null);

  // ── Conteo por pestaña (sobre el universo completo, sin filtros) ──────
  const countsByTab = useMemo(() => {
    const c: Record<string, number> = { sanitario: 0, cocina: 0, iluminacion: 0 };
    for (const it of items) {
      if (c[it.subcategory] !== undefined) c[it.subcategory]++;
    }
    return c;
  }, [items]);

  // ── Items de la pestaña activa, ordenados por sortOrder ───────────────
  // Este es el orden "real" del tab (sin filtros) — la base para arrastrar.
  const tabItems = useMemo(() => {
    return items
      .filter((it) => it.subcategory === activeTab)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [items, activeTab]);

  // Si hay búsqueda, filtro de estándares, o filtro de línea/color activo, no
  // se puede arrastrar (estaríamos reordenando sobre una vista parcial). El
  // arrastre se hace sobre la lista completa de la pestaña.
  const isFiltering =
    !!search.trim() ||
    !!filterTag ||
    onlyStandard ||
    !!filterLine ||
    !!filterFinish;

  // Líneas y colores disponibles en la pestaña activa (para los chips).
  const linesInTab = useMemo(
    () =>
      Array.from(new Set(tabItems.map((it) => it.line).filter(Boolean))).sort(
        (a, b) => (a as string).localeCompare(b as string)
      ) as string[],
    [tabItems]
  );
  const finishesInTab = useMemo(
    () =>
      Array.from(new Set(tabItems.map((it) => it.finish).filter(Boolean))).sort(
        (a, b) => (a as string).localeCompare(b as string)
      ) as string[],
    [tabItems]
  );
  // Nombres de los tipos de una pestaña, en orden (desde la BD/estado).
  // Reemplaza a la vieja tipoOptionsFor() que leía de la lista fija.
  const tiposDe = (sub: string): string[] =>
    tipos
      .filter((t) => t.subcategory === sub)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((t) => t.name);

  // Tipos (objetos) de la pestaña activa, en orden — para el manejo (renombrar,
  // borrar, arrastrar) y para mostrar también los tipos vacíos.
  const tiposInTab = useMemo(
    () =>
      tipos
        .filter((t) => t.subcategory === activeTab)
        .sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
        ),
    [tipos, activeTab]
  );

  // Tipos presentes en la pestaña activa, en el orden del desplegable de la
  // pestaña (para el filtro "Tipo": Accesorios, Griferías, WC…).
  const tagsInTab = useMemo(() => {
    const present = Array.from(
      new Set(tabItems.map((it) => (it.tag ?? "").trim()).filter(Boolean))
    );
    const orden = tiposDe(activeTab);
    return present.sort((a, b) => {
      const ia = orden.indexOf(a);
      const ib = orden.indexOf(b);
      return (ia >= 0 ? ia : 9999) - (ib >= 0 ? ib : 9999) || a.localeCompare(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabItems, activeTab, tipos]);

  // ── Lista visible: estándares + línea + color sobre tabItems ───────────
  const visible = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return tabItems.filter((it) => {
      if (onlyStandard && !it.isStandard) return false;
      if (filterTag && (it.tag ?? "").trim() !== filterTag) return false;
      if (filterLine && it.line !== filterLine) return false;
      if (filterFinish && it.finish !== filterFinish) return false;
      // Búsqueda por texto: cada palabra tiene que aparecer en algún campo.
      if (words.length) {
        const hay = [
          it.name,
          it.brand,
          it.detail,
          it.line,
          it.finish,
          it.tag,
          it.supplier,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [tabItems, onlyStandard, filterTag, filterLine, filterFinish, search]);

  // Cuántos de los que están a la vista tienen link (son los que "Revisar
  // precios" va a consultar). Se muestra en el botón para que MJ vea de una
  // que respeta el filtro: en Cocina + "teka" dirá (3), no (121).
  const revisablesCount = useMemo(
    () => visible.filter((it) => it.referenceLink).length,
    [visible]
  );

  // ── Drag & drop ───────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Lookup del orden manual de subgrupos para un tipo (lo usa buildSubgroups).
  // Devuelve el sortOrder guardado de una carpeta, o undefined.
  function subgroupOrderOf(tag: string) {
    return (name: string): number | undefined =>
      subgroupOrders.find(
        (r) =>
          r.subcategory === activeTab && r.tag === tag && r.subgroup === name
      )?.sortOrder;
  }

  // Persiste el orden de los artefactos de un subgrupo (0..n). Solo guarda; la
  // actualización optimista del estado la hace quien llama.
  async function persistItemOrder(ordered: CatalogItem[]) {
    try {
      await fetch("/api/catalogo/artefactos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: ordered.map((it, i) => ({ id: it.id, sortOrder: i })),
        }),
      });
    } catch {
      alert("Error al guardar el orden");
      router.refresh();
    }
  }

  // Reordenar artefactos DENTRO de una misma carpeta (mismo tipo y carpeta).
  // Reasigna sortOrder 0..n a esa carpeta.
  function reorderItemWithinSubgroup(moved: CatalogItem, overItemId: string) {
    const tag = (moved.tag ?? "").trim();
    const sub = (moved.subgroup ?? "").trim();
    const groupItems = tabItems.filter(
      (it) =>
        (it.tag ?? "").trim() === tag && (it.subgroup ?? "").trim() === sub
    );
    const oldIdx = groupItems.findIndex((it) => it.id === moved.id);
    const newIdx = groupItems.findIndex((it) => it.id === overItemId);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(groupItems, oldIdx, newIdx);
    const orderMap = new Map(reordered.map((it, i) => [it.id, i]));
    setItems((prev) =>
      prev.map((it) =>
        orderMap.has(it.id) ? { ...it, sortOrder: orderMap.get(it.id)! } : it
      )
    );
    persistItemOrder(reordered);
  }

  // Mover UN artefacto a otra carpeta/tipo: en el fondo es un relabel que cambia
  // su tag (tipo) y su subgroup (carpeta). NO toca línea ni color — solo cambia
  // de carpeta. Queda al final de la carpeta destino.
  async function moveItemToSubgroup(
    moved: CatalogItem,
    destTag: string,
    destName: string
  ) {
    const tag = destTag || null;
    const subgroup = destName || null;
    // sortOrder = al final de la carpeta destino (max + 1).
    const destItems = tabItems.filter(
      (it) =>
        it.id !== moved.id &&
        (it.tag ?? "").trim() === destTag &&
        (it.subgroup ?? "").trim() === destName
    );
    const newOrder =
      destItems.reduce((m, it) => Math.max(m, it.sortOrder), -1) + 1;
    // Optimista.
    setItems((prev) =>
      prev.map((it) =>
        it.id === moved.id ? { ...it, tag, subgroup, sortOrder: newOrder } : it
      )
    );
    try {
      const res = await fetch("/api/catalogo/artefactos/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [moved.id], tag, subgroup }),
      });
      if (!res.ok) throw new Error();
      // relabel no toca sortOrder: lo persistimos aparte para que quede al final.
      await fetch("/api/catalogo/artefactos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: moved.id, sortOrder: newOrder }] }),
      });
    } catch {
      alert("No se pudo mover el artefacto.");
      router.refresh();
    }
  }

  // Reordenar las CARPETAS de un tipo. Reasigna 0..n a TODAS las carpetas de ese
  // tipo y las guarda en ArtefactoSubgroupOrder.
  async function reorderSubgroups(tag: string, aName: string, oName: string) {
    const groupItems = tabItems.filter((it) => (it.tag ?? "").trim() === tag);
    const subs = buildSubgroups(groupItems, subgroupOrderOf(tag));
    const oldIdx = subs.findIndex((s) => s.name === aName);
    const newIdx = subs.findIndex((s) => s.name === oName);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(subs, oldIdx, newIdx);
    const nuevos: SubgroupOrder[] = reordered.map((s, i) => ({
      subcategory: activeTab,
      tag,
      subgroup: s.name,
      sortOrder: i,
    }));
    // Optimista: reemplaza las filas de este (subcategory, tag) por las nuevas.
    setSubgroupOrders((prev) => [
      ...prev.filter((r) => !(r.subcategory === activeTab && r.tag === tag)),
      ...nuevos,
    ]);
    try {
      await fetch("/api/catalogo/artefactos/subgroup-order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcategory: activeTab,
          tag,
          items: reordered.map((s, i) => ({ subgroup: s.name, sortOrder: i })),
        }),
      });
    } catch {
      alert("No se pudo guardar el orden de las carpetas.");
      router.refresh();
    }
  }

  // Reordenar tipos (arrastrar el encabezado de tipo).
  function reorderTipos(activeId: string, overId: string) {
    const oldIdx = tiposInTab.findIndex((t) => t.id === activeId);
    const newIdx = tiposInTab.findIndex((t) => t.id === overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(tiposInTab, oldIdx, newIdx);
    const orderMap = new Map(reordered.map((t, i) => [t.id, i]));
    setTipos((prev) =>
      prev.map((t) =>
        orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
      )
    );
    fetch("/api/catalogo/tipos/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: reordered.map((t, i) => ({ id: t.id, sortOrder: i })),
      }),
    }).catch(() => {
      alert("No se pudo guardar el orden de los tipos.");
      router.refresh();
    });
  }

  // ── Drag & drop unificado ──────────────────────────────────────────────
  // Un solo handler para los tres niveles. Decide qué hacer según el prefijo
  // del id de lo que se arrastró (active) y de lo que está debajo (over):
  //   T# tipo · S# subgrupo · I# artefacto.
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;
    const aType = a[0];
    const oType = o[0];

    // Tipo sobre tipo → reordenar tipos.
    if (aType === "T" && oType === "T") {
      reorderTipos(a.slice(2), o.slice(2));
      return;
    }

    // Carpeta sobre carpeta (mismo tipo) → reordenar carpetas.
    if (aType === "S" && oType === "S") {
      const A = parseSubgroupId(a);
      const B = parseSubgroupId(o);
      if (A.tag !== B.tag) return; // entre tipos distintos no se reordena
      reorderSubgroups(A.tag, A.name, B.name);
      return;
    }

    // Artefacto arrastrado → mover o reordenar según dónde se suelte.
    if (aType === "I") {
      const moved = items.find((it) => it.id === a.slice(2));
      if (!moved) return;

      let destTag: string;
      let destName: string; // carpeta destino
      let overItemId: string | null = null;

      if (oType === "I") {
        // Sobre otro artefacto: hereda su tipo y su carpeta.
        overItemId = o.slice(2);
        const target = items.find((it) => it.id === overItemId);
        if (!target) return;
        destTag = (target.tag ?? "").trim();
        destName = (target.subgroup ?? "").trim();
      } else if (oType === "S") {
        // Sobre el encabezado de una carpeta: ese tipo y esa carpeta.
        const B = parseSubgroupId(o);
        destTag = B.tag;
        destName = B.name;
      } else if (oType === "T") {
        // Sobre el encabezado de un tipo: ese tipo, conservando su carpeta.
        const t = tipos.find((x) => x.id === o.slice(2));
        if (!t) return;
        destTag = t.name;
        destName = (moved.subgroup ?? "").trim();
      } else {
        return;
      }

      const same =
        (moved.tag ?? "").trim() === destTag &&
        (moved.subgroup ?? "").trim() === destName;
      if (same) {
        // Misma carpeta: si soltó sobre otro artefacto, reordena.
        if (overItemId) reorderItemWithinSubgroup(moved, overItemId);
        return;
      }
      // Cambió de carpeta/tipo: relabel.
      moveItemToSubgroup(moved, destTag, destName);
    }
  }

  // ── Mutaciones ────────────────────────────────────────────────────────
  // Guarda y devuelve lo que respondió el servidor (o null si falló), para
  // poder refrescar los campos que él calcula.
  async function guardarItem(
    item: CatalogItem
  ): Promise<{ lastPriceCheck?: string | null } | null> {
    try {
      const res = await fetch(`/api/catalogo/artefactos/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // Guarda un cambio y refresca lo que el SERVIDOR calcula.
  //
  // Antes esto disparaba el guardado dentro del updater de setItems y se
  // quedaba con el objeto mergeado en el cliente. El problema: hay campos que
  // el cliente no sabe calcular — `lastPriceCheck` lo pone el backend cuando
  // llega un precio nuevo — así que la fila seguía mostrando el valor viejo
  // hasta recargar la página. MJ le puso el link al portarrollo, el precio
  // quedó bien guardado, y la pantalla igual decía "revisado hace más de un
  // mes" en ámbar (2026-08-03).
  //
  // Ahora se pinta el cambio enseguida (para que se sienta instantáneo) y
  // cuando responde el servidor se traen SOLO los campos que él calcula — no
  // el resto, para no pisar lo que MJ haya seguido escribiendo mientras tanto.
  async function updateItem(id: string, patch: Partial<CatalogItem>) {
    const actual = items.find((it) => it.id === id);
    if (!actual) return;
    const merged = { ...actual, ...patch };
    setItems((prev) => prev.map((it) => (it.id === id ? merged : it)));

    const devuelto = await guardarItem(merged);
    if (!devuelto) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              lastPriceCheck: devuelto.lastPriceCheck ?? it.lastPriceCheck,
            }
          : it
      )
    );
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Borrar este item del catálogo?")) return;
    try {
      await fetch(`/api/catalogo/artefactos/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      alert("Error al borrar");
    }
  }

  async function handleAddNew() {
    if (!newItem.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/catalogo/artefactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error");
      }
      const created = await res.json();
      setItems((prev) => [...prev, created]);
      // Saltar a la pestaña donde quedó el artefacto recién creado.
      setActiveTab(created.subcategory);
      setNewItem({
        name: "",
        detail: "",
        brand: "",
        subcategory: activeTab,
        tag: "",
        line: "",
        finish: "",
        supplier: "",
        referenceLink: "",
        imageUrl: "",
        listPrice: 0,
        realCostBlarq: 0,
        discountPercent: 0,
        isStandard: false,
      });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Cierra el formulario (sea de alta o edición) y lo deja en blanco.
  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setError(null);
    setNewItem({
      name: "",
      detail: "",
      brand: "",
      subcategory: activeTab,
      tag: "",
      line: "",
      finish: "",
      supplier: "",
      referenceLink: "",
      imageUrl: "",
      listPrice: 0,
      realCostBlarq: 0,
      discountPercent: 0,
      isStandard: false,
    });
  }

  // Abre el alta con el tipo (tag) y la pestaña ya puestos — desde el botón
  // "+ agregar" de cada grupo, así MJ no tiene que elegir la subcategoría/tipo
  // a mano. Hace scroll al formulario (que está arriba).
  function openAddForTag(tag: string) {
    closeForm();
    setNewItem((prev) => ({ ...prev, subcategory: activeTab, tag }));
    setAdding(true);
    setTimeout(
      () =>
        addFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50
    );
  }

  // Abre el formulario completo cargado con los datos de un artefacto.
  function openEdit(item: CatalogItem) {
    setAdding(false);
    setError(null);
    setEditingId(item.id);
    setNewItem({
      name: item.name,
      detail: item.detail ?? "",
      brand: item.brand ?? "",
      subcategory: item.subcategory,
      tag: item.tag ?? "",
      line: item.line ?? "",
      finish: item.finish ?? "",
      supplier: item.supplier ?? "",
      referenceLink: item.referenceLink ?? "",
      imageUrl: item.imageUrl ?? "",
      listPrice: item.listPrice ?? 0,
      realCostBlarq: item.realCostBlarq ?? 0,
      discountPercent: item.discountPercent ?? 0,
      isStandard: item.isStandard,
    });
  }

  // Guarda los cambios del artefacto en edición (PUT).
  async function handleSaveEdit() {
    if (!editingId) return;
    if (!newItem.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    const patch = {
      name: newItem.name,
      detail: newItem.detail || null,
      brand: newItem.brand || null,
      subcategory: newItem.subcategory,
      tag: newItem.tag || null,
      line: newItem.line || null,
      finish: newItem.finish || null,
      supplier: newItem.supplier || null,
      referenceLink: newItem.referenceLink || null,
      imageUrl: newItem.imageUrl || null,
      listPrice: newItem.listPrice,
      discountPercent: newItem.discountPercent || null,
      realCostBlarq: newItem.realCostBlarq || null,
      isStandard: newItem.isStandard,
    };
    try {
      const res = await fetch(`/api/catalogo/artefactos/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al guardar");
      }
      // Se toma lo que devuelve el servidor, no solo el patch: `lastPriceCheck`
      // lo calcula él al recibir un precio nuevo, y quedarse con el valor viejo
      // hacía que la fila siguiera diciendo "revisado hace más de un mes"
      // después de actualizarla (le pasó a MJ con el portarrollo, 2026-08-03).
      const guardado = await res.json().catch(() => null);
      setItems((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? { ...it, ...patch, ...(guardado?.lastPriceCheck ? { lastPriceCheck: guardado.lastPriceCheck } : {}) }
            : it
        )
      );
      setActiveTab(newItem.subcategory);
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Extraer datos al pegar URL en el formulario de "nuevo item".
  async function handleExtractForNew() {
    if (!newItem.referenceLink) {
      setError("Pegá un link primero.");
      return;
    }
    setExtractingForNew(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/catalogo/artefactos/extract?url=${encodeURIComponent(
          newItem.referenceLink
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo extraer");
        return;
      }
      setNewItem((prev) => ({
        ...prev,
        // Sugerir el nombre corto SOLO si está vacío (no pisa lo que MJ escribió).
        name: prev.name.trim()
          ? prev.name
          : sugerirNombreCorto(data.name, data.brand),
        imageUrl: data.imageUrl ?? prev.imageUrl,
        detail: data.name ?? prev.detail,
        brand: data.brand ?? prev.brand,
        listPrice: data.listPrice ?? prev.listPrice,
        // El DESCUENTO vigente en la tienda entra desde el arreglo 2026-07-31:
        // antes el producto en oferta se guardaba con el precio rebajado como
        // lista y 0%. Si la tienda no lo publica, `discountPercent` viene null
        // y se conserva lo que hubiera.
        discountPercent: data.discountPercent ?? prev.discountPercent,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtractingForNew(false);
    }
  }

  // ── Revisar precios: trae el precio web de hoy y compara ──────────────
  async function handleRevisarPrecios() {
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewRows([]);
    setReviewResumen(null);
    try {
      // Respeta lo que MJ tiene a la vista: revisa SOLO los artefactos visibles
      // (pestaña activa + buscador + chips de tipo/línea/color) que tengan link.
      // Así, parada en Cocina buscando "teka", revisa esos y no los 121.
      const ids = visible
        .filter((it) => it.referenceLink)
        .map((it) => it.id);
      const res = await fetch("/api/catalogo/artefactos/revisar-precios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setReviewRows(data.rows ?? []);
      setReviewResumen(data.resumen ?? null);
    } catch {
      setReviewRows([]);
      setReviewResumen(null);
      alert("No se pudieron revisar los precios.");
    } finally {
      setReviewLoading(false);
    }
  }

  // Aplica el precio del web a un artefacto: actualiza el precio lista y el
  // descuento (los dos vienen del web). El Total se recalcula solo. El costo
  // (realCostBlarq) NO se toca — es cotización aparte.
  //
  // Excepción (auditoría 2026-07-31): si la tienda NO publica lista y precio de
  // venta por separado (`discountKnown === false`), el descuento leído no vale
  // nada — se actualiza SOLO la lista y se conserva el descuento guardado. Antes
  // se mandaba a 0 en silencio.
  function applyReviewRow(row: PriceReviewRow) {
    if (row.webListPrice == null) return;
    const dctoConfiable = row.discountKnown !== false;
    updateItem(row.id, {
      listPrice: row.webListPrice,
      ...(dctoConfiable && {
        discountPercent:
          row.webDiscount && row.webDiscount > 0 ? row.webDiscount : null,
      }),
    });
    setReviewRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, applied: true } : r))
    );
  }

  function applyAllChanged() {
    for (const row of reviewRows) {
      if (row.status === "ok" && row.changed && !row.applied) {
        applyReviewRow(row);
      }
    }
  }

  // ── Agrupado real por tipo ────────────────────────────────────────────
  // Junta TODOS los artefactos del mismo tipo bajo un solo encabezado. El orden
  // de los grupos lo fija ahora la lista de tipos editable (tiposInTab). Se
  // muestran también los tipos VACÍOS (recién creados, sin artefactos) para que
  // MJ los vea y pueda manejarlos — salvo cuando está filtrando/buscando, donde
  // solo importan los que tienen resultados. `tipoId` viene del tipo manejable;
  // los tags viejos que no son un tipo (legacy) y "sin tipo" van sin id.
  const groups: { tag: string; tipoId: string | null; items: CatalogItem[] }[] =
    (() => {
      const byTag = new Map<string, CatalogItem[]>();
      for (const it of visible) {
        const key = (it.tag ?? "").trim();
        const arr = byTag.get(key);
        if (arr) arr.push(it);
        else byTag.set(key, [it]);
      }
      const result: {
        tag: string;
        tipoId: string | null;
        items: CatalogItem[];
      }[] = [];

      // 1) Tipos manejables, en su orden. Vacíos solo si NO estás filtrando.
      for (const t of tiposInTab) {
        const its = byTag.get(t.name) ?? [];
        if (its.length === 0 && isFiltering) continue;
        result.push({ tag: t.name, tipoId: t.id, items: its });
        byTag.delete(t.name);
      }
      // 2) Tags presentes que NO son un tipo manejable (legacy), alfabético.
      const leftover = [...byTag.entries()].filter(([k]) => k !== "");
      leftover.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [tag, its] of leftover) {
        result.push({ tag, tipoId: null, items: its });
      }
      // 3) "Sin tipo" al final.
      const sinTipo = byTag.get("");
      if (sinTipo && sinTipo.length) {
        result.push({ tag: "", tipoId: null, items: sinTipo });
      }
      return result;
    })();

  // ── Subgrupos (línea+color) dentro de cada tipo ────────────────────────
  // Default: colapsados solo en tipos largos. Si MJ está buscando/filtrando,
  // se ven abiertos (ya acotó lo que quiere ver). Un toggle manual pisa todo.
  function isSubgroupCollapsed(key: string, tagItemCount: number): boolean {
    const manual = openSubgroups[key];
    if (manual !== undefined) return !manual;
    if (isFiltering) return false;
    return tagItemCount > SUBGROUP_COLLAPSE_THRESHOLD;
  }
  function toggleSubgroup(key: string, currentlyCollapsed: boolean) {
    // Al togglear guardamos el estado "abierto" = lo contrario de lo actual.
    setOpenSubgroups((prev) => ({ ...prev, [key]: currentlyCollapsed }));
  }

  // Abre el editor de renombrado de una carpeta, precargado con su nombre.
  function openRename(key: string, sub: Subgroup) {
    setRenamingSubKey(key);
    setRenameFolder(sub.name);
  }
  function cancelRename() {
    setRenamingSubKey(null);
    setRenameFolder("");
  }
  // Aplica el nombre nuevo de carpeta a TODOS los artefactos del grupo (cambia
  // su campo subgroup). Si el nombre nuevo ya es el de otra carpeta, se fusionan.
  async function saveRename(sub: Subgroup) {
    const ids = sub.items.map((it) => it.id);
    const subgroup = renameFolder.trim() || null;
    // Sin cambios reales: cerrar y listo.
    if (subgroup === (sub.name || null)) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    try {
      const res = await fetch("/api/catalogo/artefactos/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, subgroup }),
      });
      if (!res.ok) throw new Error();
      const idSet = new Set(ids);
      setItems((prev) =>
        prev.map((it) => (idSet.has(it.id) ? { ...it, subgroup } : it))
      );
      cancelRename();
    } catch {
      alert("No se pudo renombrar la carpeta.");
    } finally {
      setSavingRename(false);
    }
  }

  // Mueve TODOS los artefactos de una carpeta a otro tipo (cambia su `tag`).
  // La carpeta se mantiene, ahora bajo el tipo destino.
  async function moveSubgroup(sub: Subgroup, newTag: string) {
    const ids = sub.items.map((it) => it.id);
    setMovingSubKey(null);
    try {
      const res = await fetch("/api/catalogo/artefactos/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, tag: newTag }),
      });
      if (!res.ok) throw new Error();
      const idSet = new Set(ids);
      setItems((prev) =>
        prev.map((it) => (idSet.has(it.id) ? { ...it, tag: newTag } : it))
      );
    } catch {
      alert("No se pudo mover la carpeta de tipo.");
    }
  }

  // ── Manejo de tipos (crear / renombrar / borrar / reordenar) ───────────
  async function createTipo() {
    const name = newTipoName.trim();
    if (!name) return;
    setTipoBusy(true);
    try {
      const res = await fetch("/api/catalogo/tipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcategory: activeTab, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudo crear el tipo.");
        return;
      }
      setTipos((prev) => [...prev, data]);
      setNewTipoName("");
      setCreatingTipo(false);
    } catch {
      alert("No se pudo crear el tipo.");
    } finally {
      setTipoBusy(false);
    }
  }

  function openRenameTipo(t: ArtefactoTipo) {
    setRenamingTipoId(t.id);
    setRenameTipoName(t.name);
  }
  async function saveRenameTipo(t: ArtefactoTipo) {
    const name = renameTipoName.trim();
    if (!name || name === t.name) {
      setRenamingTipoId(null);
      return;
    }
    setTipoBusy(true);
    try {
      const res = await fetch(`/api/catalogo/tipos/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudo renombrar el tipo.");
        return;
      }
      // Renombrar el tipo y arrastrar el nombre nuevo a los artefactos (su tag).
      setTipos((prev) => prev.map((x) => (x.id === t.id ? { ...x, name } : x)));
      setItems((prev) =>
        prev.map((it) =>
          it.subcategory === t.subcategory && (it.tag ?? "") === t.name
            ? { ...it, tag: name }
            : it
        )
      );
      setRenamingTipoId(null);
    } catch {
      alert("No se pudo renombrar el tipo.");
    } finally {
      setTipoBusy(false);
    }
  }

  async function deleteTipo(t: ArtefactoTipo) {
    if (!confirm(`¿Borrar el tipo "${t.name}"?`)) return;
    try {
      const res = await fetch(`/api/catalogo/tipos/${t.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = tiene artefactos: el backend manda el aviso para mover primero.
        alert(data.error || "No se pudo borrar el tipo.");
        return;
      }
      setTipos((prev) => prev.filter((x) => x.id !== t.id));
    } catch {
      alert("No se pudo borrar el tipo.");
    }
  }

  // Filas de un subgrupo (o de un tipo plano). Van en su propio SortableContext
  // — pero TODO comparte el mismo DndContext de afuera, así un artefacto se
  // puede arrastrar a otro subgrupo/tipo. Los ids llevan prefijo "I#".
  function renderItemRows(rowItems: CatalogItem[]) {
    return (
      <SortableContext
        items={rowItems.map((it) => itemSortId(it.id))}
        strategy={verticalListSortingStrategy}
      >
        {rowItems.map((item) => (
          <CatalogItemRow
            key={item.id}
            sortId={itemSortId(item.id)}
            item={item}
            canReorder={!isFiltering}
            onUpdate={(patch) => updateItem(item.id, patch)}
            onEdit={() => openEdit(item)}
            onDelete={() => deleteItem(item.id)}
          />
        ))}
      </SortableContext>
    );
  }

  return (
    <div>
      {/* Sugerencias para los campos Línea / Color (filas y formulario). */}
      <datalist id="lineas-list">
        {linesInTab.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="colores-list">
        {finishesInTab.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {/* Pestañas de subcategoría */}
      <div className="flex items-center gap-2 mb-4">
        {SUBCATEGORY_OPTIONS.map((s) => {
          const active = activeTab === s;
          return (
            <button
              key={s}
              onClick={() => {
                setActiveTab(s);
                // Los tipos/líneas/colores difieren por pestaña: limpiamos los
                // filtros para no esconder todo con un filtro de otra pestaña.
                setFilterTag(null);
                setFilterLine(null);
                setFilterFinish(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {SUBCATEGORY_LABELS[s]}
              <span
                className={`ml-2 tabular-nums ${
                  active ? "text-gray-300" : "text-gray-400"
                }`}
              >
                {countsByTab[s] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: buscador + filtros + nuevo. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        {/* Buscador por texto libre dentro de la pestaña activa. Matchea
            cualquier palabra (nombre, marca, detalle, línea, color, tipo). */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar… (ej. mampara, brushed)"
            className="w-64 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:border-gray-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 text-sm leading-none"
              title="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
        {/* Filtro por tipo (Accesorios, Griferías, WC…) de la pestaña activa. */}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span className="text-gray-500">Tipo</span>
          <select
            value={filterTag ?? ""}
            onChange={(e) => setFilterTag(e.target.value || null)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none cursor-pointer focus:border-gray-500"
            title="Mostrar solo un tipo"
          >
            <option value="">Todos</option>
            {tagsInTab.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyStandard}
            onChange={(e) => setOnlyStandard(e.target.checked)}
            className="accent-gray-900"
          />
          Solo paleta estándar BLARQ
        </label>
        <button
          onClick={handleRevisarPrecios}
          disabled={reviewLoading || revisablesCount === 0}
          className="ml-auto text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:border-gray-500 disabled:opacity-50"
          title="Trae el precio web de hoy para los artefactos con link que tenés a la vista (respeta la pestaña y el buscador) y te muestra los cambios"
        >
          {reviewLoading
            ? "Revisando…"
            : `Revisar precios${revisablesCount > 0 ? ` (${revisablesCount})` : ""}`}
        </button>
        {/* Crear un tipo nuevo en esta pestaña. */}
        {creatingTipo ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={newTipoName}
              onChange={(e) => setNewTipoName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createTipo();
                if (e.key === "Escape") {
                  setCreatingTipo(false);
                  setNewTipoName("");
                }
              }}
              placeholder="Nombre del tipo"
              className="w-40 px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:border-gray-500"
            />
            <button
              onClick={createTipo}
              disabled={tipoBusy || !newTipoName.trim()}
              className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              Crear
            </button>
            <button
              onClick={() => {
                setCreatingTipo(false);
                setNewTipoName("");
              }}
              className="text-sm text-gray-500 px-1 hover:text-gray-900"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingTipo(true)}
            className="text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:border-gray-500"
            title="Crear un tipo nuevo en esta pestaña"
          >
            + Nuevo tipo
          </button>
        )}
        <button
          onClick={() => {
            if (adding) {
              closeForm();
              return;
            }
            // Abrir alta en blanco (cierra una edición si la había).
            closeForm();
            setNewItem((prev) => ({ ...prev, subcategory: activeTab }));
            setAdding(true);
          }}
          className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
        >
          {adding ? "Cancelar" : "+ Nuevo artefacto"}
        </button>
      </div>

      {/* Panel de revisión de precios */}
      {reviewOpen && (
        <PriceReviewPanel
          loading={reviewLoading}
          rows={reviewRows}
          resumen={reviewResumen}
          onApply={applyReviewRow}
          onApplyAll={applyAllChanged}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {/* Formulario de alta / edición. Es un <form> para que Enter guarde. */}
      {(adding || editingId) && (
        <form
          ref={addFormRef}
          onSubmit={(e) => {
            e.preventDefault();
            if (editingId) handleSaveEdit();
            else handleAddNew();
          }}
          className="bg-white rounded-xl border border-gray-200 p-5 mb-4"
        >
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            {editingId ? "Editar artefacto" : "Nuevo artefacto"}
          </h2>

          {/* Atajo: link del producto + extraer */}
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Atajo — pegá link del producto y extraé todo de una
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={newItem.referenceLink}
                onChange={(e) =>
                  setNewItem({ ...newItem, referenceLink: e.target.value })
                }
                placeholder="https://www.mk.cl/…"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
              />
              <button
                type="button"
                onClick={handleExtractForNew}
                disabled={extractingForNew || !newItem.referenceLink}
                className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
              >
                {extractingForNew ? "Buscando…" : "Extraer"}
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Trae imagen, nombre, marca y precio lista. Después podés ajustar.
            </p>
          </div>

          {error && (
            <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Nombre (corto) *
              </label>
              <input
                type="text"
                value={newItem.name}
                onChange={(e) =>
                  setNewItem({ ...newItem, name: e.target.value })
                }
                placeholder="WC ATENAS"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Detalle / modelo
              </label>
              <input
                type="text"
                value={newItem.detail}
                onChange={(e) =>
                  setNewItem({ ...newItem, detail: e.target.value })
                }
                placeholder="WC Two Piece ATENAS DESCARGA A MURO"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Marca
              </label>
              <input
                type="text"
                value={newItem.brand}
                onChange={(e) =>
                  setNewItem({ ...newItem, brand: e.target.value })
                }
                placeholder="KLIPEN"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Línea
              </label>
              <input
                type="text"
                list="lineas-list"
                value={newItem.line}
                onChange={(e) =>
                  setNewItem({ ...newItem, line: e.target.value })
                }
                placeholder="Urban, Stellar, Asis…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Color / terminación
              </label>
              <input
                type="text"
                list="colores-list"
                value={newItem.finish}
                onChange={(e) =>
                  setNewItem({ ...newItem, finish: e.target.value })
                }
                placeholder="Cromo, Brushed, Gun Grey…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Proveedor / tienda
              </label>
              <input
                type="text"
                value={newItem.supplier}
                onChange={(e) =>
                  setNewItem({ ...newItem, supplier: e.target.value })
                }
                placeholder="MK"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Subcategoría *
              </label>
              <select
                value={newItem.subcategory}
                onChange={(e) =>
                  setNewItem({ ...newItem, subcategory: e.target.value })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                {SUBCATEGORY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SUBCATEGORY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Tipo (para agrupar)
              </label>
              <select
                value={newItem.tag}
                onChange={(e) =>
                  setNewItem({ ...newItem, tag: e.target.value })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                <option value="">Sin tipo</option>
                {tiposDe(newItem.subcategory).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Precio lista (sin dcto)
              </label>
              <ThousandsInput
                value={newItem.listPrice}
                onChange={(v) => setNewItem({ ...newItem, listPrice: v })}
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Dcto % al cliente
              </label>
              <input
                type="number"
                value={
                  newItem.discountPercent
                    ? Math.round(newItem.discountPercent * 100)
                    : ""
                }
                onChange={(e) =>
                  setNewItem({
                    ...newItem,
                    discountPercent: (parseFloat(e.target.value) || 0) / 100,
                  })
                }
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Mi costo (oculto al cliente)
              </label>
              <ThousandsInput
                value={newItem.realCostBlarq}
                onChange={(v) => setNewItem({ ...newItem, realCostBlarq: v })}
                placeholder="lo que pago"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Foto — subí un archivo o pegá una URL
              </label>
              <div className="flex items-center gap-2">
                {newItem.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgSrc(newItem.imageUrl)}
                    alt="preview"
                    className="w-12 h-12 object-contain bg-white border border-gray-200 rounded shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 shrink-0">
                    —
                  </div>
                )}
                <label className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 cursor-pointer whitespace-nowrap">
                  Subir foto
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        const dataUrl = await fileToThumbnailDataUrl(file);
                        setNewItem((prev) => ({ ...prev, imageUrl: dataUrl }));
                      } catch {
                        setError("No se pudo procesar la imagen.");
                      }
                    }}
                  />
                </label>
                <input
                  type="url"
                  value={newItem.imageUrl.startsWith("data:") ? "" : newItem.imageUrl}
                  onChange={(e) =>
                    setNewItem({ ...newItem, imageUrl: e.target.value })
                  }
                  placeholder="…o pegá https://…/imagen.jpg"
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
                />
              </div>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newItem.isStandard}
                  onChange={(e) =>
                    setNewItem({ ...newItem, isStandard: e.target.checked })
                  }
                  className="accent-gray-900"
                />
                Agregar a la paleta estándar BLARQ
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={closeForm}
              className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
            >
              {editingId ? "Guardar cambios" : "Guardar en catálogo"}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div
          className={`grid ${GRID_COLS} items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider`}
        >
          <div></div>
          <div className="text-center">Img</div>
          <div>Nombre / marca</div>
          {/* Línea — encabezado con desplegable de filtro. */}
          <div className="leading-tight">
            Línea
            <select
              value={filterLine ?? ""}
              onChange={(e) => setFilterLine(e.target.value || null)}
              className="mt-0.5 w-full bg-white border border-gray-200 rounded text-[10px] font-normal normal-case tracking-normal text-gray-600 px-0.5 py-0.5 outline-none cursor-pointer focus:border-gray-400"
              title="Filtrar por línea"
            >
              <option value="">todas</option>
              {linesInTab.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {/* Color — encabezado con desplegable de filtro. */}
          <div className="leading-tight">
            Color
            <select
              value={filterFinish ?? ""}
              onChange={(e) => setFilterFinish(e.target.value || null)}
              className="mt-0.5 w-full bg-white border border-gray-200 rounded text-[10px] font-normal normal-case tracking-normal text-gray-600 px-0.5 py-0.5 outline-none cursor-pointer focus:border-gray-400"
              title="Filtrar por color"
            >
              <option value="">todos</option>
              {finishesInTab.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>Detalle</div>
          <div className="text-right">Lista</div>
          <div className="text-center">Dcto</div>
          <div className="text-right">Total</div>
          <div className="text-right bg-gray-100/70 -my-2 py-2 px-1" title="No lo ve el cliente">
            Mi costo
          </div>
          <div className="text-right bg-gray-100/70 -my-2 py-2 px-1" title="No lo ve el cliente">
            Gan.
          </div>
          <div className="text-center">Std</div>
          <div></div>
        </div>

        {!isFiltering && tabItems.length > 1 && (
          <div className="px-4 py-1.5 bg-white border-b border-gray-100 text-[11px] text-gray-400">
            Los artefactos del mismo tipo quedan juntos, en carpetas que armás
            vos (clic en la carpeta para abrir/cerrar). La carpeta es estable:
            editar la Línea o el Color de un artefacto ya NO lo mueve de carpeta.
            Arrastrá desde la manija (⋮⋮): la de cada fila reordena los
            artefactos; la del encabezado de una carpeta reordena las carpetas;
            la del encabezado de un tipo reordena los tipos. Para mover UN
            artefacto a otra carpeta o tipo, arrastralo y soltalo sobre el
            encabezado del destino (o sobre un artefacto de ahí). "Renombrar" en
            una carpeta la renombra (y si le ponés el nombre de otra, se
            fusionan). Para cambiar de pestaña, usá el botón Editar.
          </div>
        )}

        {visible.length === 0 && groups.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {tabItems.length === 0
              ? "Todavía no hay artefactos en esta pestaña. Apretá '+ Nuevo artefacto' para empezar."
              : "No hay resultados con esos filtros."}
          </div>
        ) : (
          <DndContext
            id="catalogo-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
          <SortableContext
            items={groups
              .filter((g) => g.tipoId)
              .map((g) => tipoSortId(g.tipoId as string))}
            strategy={verticalListSortingStrategy}
          >
          {groups.map((g) => (
            <Fragment key={g.tipoId || g.tag || "__sin_tipo__"}>
              {g.tipoId ? (
                // Tipo manejable: arrastrable, renombrable, borrable.
                <SortableTipoHeader
                  tipo={tipos.find((t) => t.id === g.tipoId)!}
                  count={g.items.length}
                  busy={tipoBusy}
                  canDrag={!isFiltering}
                  isRenaming={renamingTipoId === g.tipoId}
                  renameValue={renameTipoName}
                  onRenameChange={setRenameTipoName}
                  onSave={() =>
                    saveRenameTipo(tipos.find((t) => t.id === g.tipoId)!)
                  }
                  onCancel={() => setRenamingTipoId(null)}
                  onOpenRename={() =>
                    openRenameTipo(tipos.find((t) => t.id === g.tipoId)!)
                  }
                  onDelete={() =>
                    deleteTipo(tipos.find((t) => t.id === g.tipoId)!)
                  }
                  onAdd={() => openAddForTag(g.tag)}
                />
              ) : g.tag ? (
                // Tipo "viejo" presente en artefactos pero no en la lista
                // editable (legacy): se muestra, sin manejo, para no esconderlo.
                <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    {g.tag}
                    <span className="ml-1.5 normal-case tracking-normal text-gray-300">
                      (sin tipo propio)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => openAddForTag(g.tag)}
                    className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    title={`Agregar un artefacto en ${g.tag}`}
                  >
                    + agregar
                  </button>
                </div>
              ) : (
                <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  Sin tipo
                </div>
              )}
              {(() => {
                const subs = buildSubgroups(g.items, subgroupOrderOf(g.tag));
                // Una sola carpeta (o todo "Sin carpeta"): no agrega ruido, se
                // muestra plano.
                if (subs.length <= 1) return renderItemRows(g.items);
                return (
                  <SortableContext
                    items={subs.map((sg) => subgroupSortId(g.tag, sg.name))}
                    strategy={verticalListSortingStrategy}
                  >
                {subs.map((sg) => {
                  const key = `${g.tag}::${sg.key}`;
                  const collapsed = isSubgroupCollapsed(key, g.items.length);
                  return (
                    <Fragment key={key}>
                      <SortableSubgroupHeader
                        sortId={subgroupSortId(g.tag, sg.name)}
                        sub={sg}
                        collapsed={collapsed}
                        canDrag={!isFiltering}
                        canMove={
                          tiposDe(activeTab).filter((t) => t !== g.tag).length > 0
                        }
                        onToggle={() => toggleSubgroup(key, collapsed)}
                        onOpenRename={() => openRename(key, sg)}
                        onToggleMove={() =>
                          setMovingSubKey(movingSubKey === key ? null : key)
                        }
                      />
                      {movingSubKey === key && (
                        <div className="pl-9 pr-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-gray-500">
                            Mover los {sg.items.length} artefactos a
                          </span>
                          <select
                            autoFocus
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) moveSubgroup(sg, e.target.value);
                            }}
                            className="px-2 py-1 border border-gray-300 rounded text-xs bg-white outline-none cursor-pointer focus:border-gray-500"
                          >
                            <option value="" disabled>
                              elegí un tipo…
                            </option>
                            {tiposDe(activeTab)
                              .filter((t) => t !== g.tag)
                              .map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setMovingSubKey(null)}
                            className="text-xs text-gray-500 hover:text-gray-900"
                          >
                            cancelar
                          </button>
                        </div>
                      )}
                      {renamingSubKey === key && (
                        <div className="pl-9 pr-4 py-2 bg-gray-50 border-b border-gray-200 flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                              Nombre de la carpeta
                            </label>
                            <input
                              autoFocus
                              type="text"
                              value={renameFolder}
                              onChange={(e) => setRenameFolder(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRename(sg);
                                if (e.key === "Escape") cancelRename();
                              }}
                              placeholder="Sin carpeta"
                              className="w-48 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                            />
                          </div>
                          <span className="text-[10px] text-gray-500 mb-1.5">
                            Se aplica a los {sg.items.length} artefactos de esta
                            carpeta. Si ya existe una carpeta con ese nombre, se
                            fusionan.
                          </span>
                          <div className="flex gap-2 ml-auto mb-0.5">
                            <button
                              type="button"
                              onClick={cancelRename}
                              className="text-xs text-gray-600 px-2 py-1 hover:text-gray-900"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => saveRename(sg)}
                              disabled={savingRename}
                              className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-800 disabled:opacity-50"
                            >
                              {savingRename ? "Guardando…" : "Guardar"}
                            </button>
                          </div>
                        </div>
                      )}
                      {!collapsed && renderItemRows(sg.items)}
                    </Fragment>
                  );
                })}
                  </SortableContext>
                );
              })()}
            </Fragment>
          ))}
          </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

// ─── Componente: encabezado de carpeta (arrastrable para reordenar) ───────
// Es la fila con el nombre de la carpeta dentro de un tipo. Tiene su propia
// manija de arrastre (⋮⋮) para reordenar las carpetas del tipo, y sirve también
// de destino: soltar un artefacto sobre este encabezado lo mueve a esta carpeta.
function SortableSubgroupHeader({
  sortId,
  sub,
  collapsed,
  canDrag,
  canMove,
  onToggle,
  onOpenRename,
  onToggleMove,
}: {
  sortId: string;
  sub: Subgroup;
  collapsed: boolean;
  canDrag: boolean;
  canMove: boolean;
  onToggle: () => void;
  onOpenRename: () => void;
  onToggleMove: () => void;
}) {
  const sortable = useSortable({ id: sortId, disabled: !canDrag });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    background: sortable.isDragging ? "#F9FAFB" : undefined,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="group w-full flex items-center gap-1.5 pl-4 pr-4 py-1 bg-white border-b border-gray-100 hover:bg-gray-50"
    >
      {/* Manija de arrastre del subgrupo. */}
      {canDrag ? (
        <span
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab text-gray-300 hover:text-gray-600 select-none text-[11px]"
          title="Arrastrar para reordenar esta carpeta dentro del tipo"
        >
          ⋮⋮
        </span>
      ) : (
        <span
          className="text-gray-200 select-none text-[11px]"
          title="Sacá la búsqueda/filtros para reordenar las carpetas"
        >
          ⋮⋮
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
      >
        <Chevron open={!collapsed} />
        <span className="text-[10px] font-medium text-gray-500 tracking-wide uppercase">
          {sub.hasName ? sub.name : "Sin carpeta / Otros"}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          · {sub.items.length}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenRename}
        className="shrink-0 text-[10px] uppercase tracking-wider text-gray-400 hover:text-gray-900 opacity-0 group-hover:opacity-100 focus:opacity-100"
        title="Renombrar esta carpeta (se aplica a todos sus artefactos)"
      >
        renombrar
      </button>
      {/* Mover toda la carpeta a otro tipo. Solo si hay otros tipos. */}
      {canMove && (
        <button
          type="button"
          onClick={onToggleMove}
          className="shrink-0 text-[10px] uppercase tracking-wider text-gray-400 hover:text-gray-900 opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="Mover toda esta carpeta a otro tipo"
        >
          mover a…
        </button>
      )}
    </div>
  );
}

// ─── Componente: encabezado de tipo (arrastrable, renombrable, borrable) ──
function SortableTipoHeader({
  tipo,
  count,
  busy,
  canDrag,
  isRenaming,
  renameValue,
  onRenameChange,
  onSave,
  onCancel,
  onOpenRename,
  onDelete,
  onAdd,
}: {
  tipo: ArtefactoTipo;
  count: number;
  busy: boolean;
  canDrag: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onOpenRename: () => void;
  onDelete: () => void;
  onAdd: () => void;
}) {
  // id con prefijo "T#": comparte DndContext con subgrupos e items, así un
  // artefacto se puede soltar sobre el encabezado del tipo para moverlo ahí.
  const s = useSortable({ id: tipoSortId(tipo.id), disabled: !canDrag });
  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
    opacity: s.isDragging ? 0.5 : 1,
    zIndex: s.isDragging ? 10 : ("auto" as const),
    background: s.isDragging ? "#F3F4F6" : undefined,
  };
  return (
    <div
      ref={s.setNodeRef}
      style={style}
      className="group flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-200"
    >
      {canDrag ? (
        <span
          {...s.attributes}
          {...s.listeners}
          className="cursor-grab text-gray-300 hover:text-gray-600 select-none text-[11px]"
          title="Arrastrar para reordenar el tipo"
        >
          ⋮⋮
        </span>
      ) : (
        <span
          className="text-gray-200 select-none text-[11px]"
          title="Sacá la búsqueda/filtros para reordenar los tipos"
        >
          ⋮⋮
        </span>
      )}
      {isRenaming ? (
        <div className="flex items-center gap-1.5 flex-1">
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancel();
            }}
            className="w-44 px-2 py-0.5 border border-gray-300 rounded text-[11px] font-semibold uppercase tracking-wider outline-none focus:border-gray-500"
          />
          <button
            onClick={onSave}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            onClick={onCancel}
            className="text-[10px] text-gray-500 hover:text-gray-900"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex-1">
            {tipo.name}
            <span className="ml-1.5 text-gray-400 tabular-nums">· {count}</span>
          </span>
          <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={onOpenRename}
              className="text-[10px] uppercase tracking-wider text-gray-400 hover:text-gray-900"
              title="Renombrar el tipo (cambia también el tipo de sus artefactos)"
            >
              renombrar
            </button>
            <button
              onClick={onDelete}
              className="text-[10px] uppercase tracking-wider text-gray-400 hover:text-red-600"
              title="Borrar el tipo (bloqueado si tiene artefactos)"
            >
              borrar
            </button>
          </div>
          <button
            onClick={onAdd}
            className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-900"
            title={`Agregar un artefacto en ${tipo.name}`}
          >
            + agregar
          </button>
        </>
      )}
    </div>
  );
}

// ─── Componente: fila editable + arrastrable ────────────────────────────
function CatalogItemRow({
  item,
  sortId,
  canReorder,
  onUpdate,
  onEdit,
  onDelete,
}: {
  item: CatalogItem;
  sortId: string;
  canReorder: boolean;
  onUpdate: (patch: Partial<CatalogItem>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // id con prefijo "I#" (comparte DndContext con tipos y subgrupos).
  const sortable = useSortable({ id: sortId, disabled: !canReorder });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // URL de imagen que no cargó (rota): mostramos el "+" para subir otra en vez
  // del ícono roto. Ej.: links de mk.cl que ya no existen o están bloqueados.
  const [failedImg, setFailedImg] = useState<string | null>(null);

  // Sube una foto desde la compu: la achica a miniatura y la guarda.
  async function handlePhotoFile(file: File | undefined | null) {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const dataUrl = await fileToThumbnailDataUrl(file);
      onUpdate({ imageUrl: dataUrl });
    } catch {
      alert("No se pudo procesar la imagen. Probá con otra.");
    } finally {
      setUploadingPhoto(false);
    }
  }
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    background: sortable.isDragging ? "#FAFAFA" : undefined,
  };

  // Hace cuánto se revisó este precio contra la web (auditoría 2026-07-31).
  const edadPrecio = edadRevisionPrecio(item.lastPriceCheck);

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`grid ${GRID_COLS} items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
    >
      {/* Manija de arrastre */}
      <div className="flex justify-center">
        {canReorder ? (
          <span
            {...sortable.attributes}
            {...sortable.listeners}
            className="cursor-grab text-gray-300 hover:text-gray-700 select-none"
            title="Arrastrar para reordenar"
          >
            ⋮⋮
          </span>
        ) : (
          <span
            className="text-gray-200 select-none"
            title="Sacá la búsqueda y el filtro de estándares para poder reordenar"
          >
            ⋮⋮
          </span>
        )}
      </div>

      <div className="flex justify-center">
        {/* Subir foto desde la compu: click abre el selector de archivo; la
            imagen se achica a miniatura y se guarda (como pidió MJ). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handlePhotoFile(e.target.files?.[0]);
            e.target.value = ""; // permite re-subir el mismo archivo
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Click para subir / cambiar la foto"
          className="group relative w-12 h-12"
        >
          {item.imageUrl && failedImg !== item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc(item.imageUrl)}
              alt={item.name}
              onError={() => setFailedImg(item.imageUrl)}
              className="w-12 h-12 object-contain bg-white border border-gray-200 rounded"
            />
          ) : (
            <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-lg">
              +
            </div>
          )}
          <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/40 rounded text-white text-[9px] uppercase tracking-wider text-center leading-tight px-0.5">
            {uploadingPhoto ? "subiendo…" : "subir foto"}
          </span>
        </button>
      </div>

      <div className="min-w-0">
        {/* Nombre: la caja crece sola a su contenido (field-sizing:content) para
            que el nombre completo se vea sin scroll, por largo que sea. */}
        <textarea
          rows={1}
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="w-full bg-transparent border-0 p-0 font-semibold text-gray-900 text-[11px] leading-tight resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        {/* Marca y proveedor lado a lado (no apilados). */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={item.brand ?? ""}
            placeholder="marca"
            onChange={(e) => onUpdate({ brand: e.target.value })}
            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-gray-500 text-[10px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
          />
          <span className="text-gray-300 text-[10px] select-none">·</span>
          <input
            type="text"
            value={item.supplier ?? ""}
            placeholder="proveedor"
            onChange={(e) => onUpdate({ supplier: e.target.value })}
            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-gray-400 text-[10px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
          />
        </div>
      </div>

      {/* Línea (editable). Se muestra en MAYÚSCULA. La caja crece a 2 líneas en
          vez de cortar el texto (ej. "BAJO CUBIERTA"). Es textarea, no input,
          por eso no trae la lista de sugerencias. */}
      <div className="min-w-0">
        <textarea
          rows={1}
          value={item.line ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate({ line: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 text-[11px] font-medium uppercase leading-tight break-words resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Color / terminación (editable). Mismo criterio: 2 líneas, no cortar. */}
      <div className="min-w-0">
        <textarea
          rows={1}
          value={item.finish ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate({ finish: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-600 text-[11px] leading-tight break-words resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      <div className="min-w-0">
        {/* Detalle: la caja crece sola a su contenido para verlo completo. */}
        <textarea
          rows={1}
          value={item.detail ?? ""}
          placeholder="modelo / detalle"
          onChange={(e) => onUpdate({ detail: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 text-[11px] leading-tight resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        {item.referenceLink && (
          <a
            href={item.referenceLink}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-gray-400 hover:text-gray-700 underline mt-0.5 inline-block truncate max-w-full"
          >
            ↗ {item.referenceLink.replace(/^https?:\/\//, "").slice(0, 40)}
          </a>
        )}
      </div>

      {/* Precio lista (sin descuento) + hace cuánto se revisó contra la web */}
      <div>
        <ThousandsInput
          value={item.listPrice}
          onChange={(v) => onUpdate({ listPrice: v })}
          placeholder="0"
          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
        {/* Solo tiene sentido en los que se pueden revisar (con link): en los
            cargados a mano el aviso sería ruido permanente sin acción posible. */}
        {item.referenceLink && (
          <div
            className={`text-[10px] text-right leading-tight ${
              edadPrecio.vencido ? "text-amber-700" : "text-gray-400"
            }`}
            title={
              edadPrecio.vencido
                ? "Las tiendas cambian sus ofertas: conviene correr Revisar precios antes de cotizar."
                : undefined
            }
          >
            {edadPrecio.texto}
          </div>
        )}
      </div>

      {/* Descuento al cliente (auto del web cuando lo haya; editable) */}
      <div className="flex items-center justify-center gap-0.5">
        <input
          type="number"
          value={
            item.discountPercent
              ? Math.round(item.discountPercent * 100)
              : ""
          }
          onChange={(e) => {
            const pct = parseFloat(e.target.value);
            onUpdate({
              discountPercent: pct ? pct / 100 : null,
            });
          }}
          placeholder="0"
          className="w-9 bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
        <span className="text-gray-400 text-[10px]">%</span>
      </div>

      {/* Total = lo que paga el cliente (lista − dcto) */}
      <div className="text-right tabular-nums font-semibold text-gray-900">
        {formatCLP(clientTotal(item))}
      </div>

      {/* Mi costo (oculto al cliente) */}
      <div className="bg-gray-50 -my-2 py-2 px-1">
        <ThousandsInput
          value={item.realCostBlarq ?? 0}
          onChange={(v) => onUpdate({ realCostBlarq: v || null })}
          placeholder="—"
          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Ganancia = Total − Mi costo (oculto al cliente) */}
      <div className="bg-gray-50 -my-2 py-2 px-1 text-right tabular-nums">
        {item.realCostBlarq != null ? (
          <span
            className={
              clientTotal(item) - item.realCostBlarq > 0
                ? "text-green-700"
                : clientTotal(item) - item.realCostBlarq < 0
                ? "text-red-600"
                : "text-gray-500"
            }
          >
            {formatCLP(clientTotal(item) - item.realCostBlarq)}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </div>

      <div className="flex justify-center">
        <label className="cursor-pointer" title="Paleta estándar BLARQ">
          <input
            type="checkbox"
            checked={item.isStandard}
            onChange={(e) => onUpdate({ isStandard: e.target.checked })}
            className="accent-gray-900"
          />
        </label>
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={onEdit}
          className="text-[10px] text-gray-500 border border-gray-300 rounded px-1.5 py-0.5 hover:border-gray-500 hover:text-gray-900"
          title="Editar (abre el cuadro completo)"
        >
          Editar
        </button>
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-600 text-lg leading-none"
          title="Borrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Panel "Revisar precios": guardado vs web ahora ─────────────────────
function PriceReviewPanel({
  loading,
  rows,
  resumen,
  onApply,
  onApplyAll,
  onClose,
}: {
  loading: boolean;
  rows: PriceReviewRow[];
  resumen: {
    conLink: number;
    cambiaron: number;
    noLeidos: number;
    fotosReparadas?: number;
  } | null;
  onApply: (row: PriceReviewRow) => void;
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const COLS = "grid-cols-[minmax(0,1fr)_5.5rem_3.5rem_8rem_5rem]";
  // Por default mostramos SOLO lo que cambió (lo que MJ quiere revisar). El
  // resto (sin cambio / no se pudo leer) queda detrás de "ver todos".
  const [showAll, setShowAll] = useState(false);
  const changedRows = rows.filter((r) => r.status === "ok" && !!r.changed);
  const displayRows = showAll ? rows : changedRows;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Revisar precios
        </h2>
        <button
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          Cerrar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          Trayendo precios de la web…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No hay artefactos con link para revisar.
        </p>
      ) : (
        <>
          {resumen && (
            <div className="flex items-center justify-between gap-3 mb-3 text-xs text-gray-600">
              <span>
                {resumen.conLink} con link ·{" "}
                <span className="text-gray-900 font-medium">
                  {resumen.cambiaron} cambiaron
                </span>
                {resumen.noLeidos > 0
                  ? ` · ${resumen.noLeidos} no se pudieron leer`
                  : ""}
                {resumen.fotosReparadas
                  ? ` · ${resumen.fotosReparadas} ${
                      resumen.fotosReparadas === 1 ? "foto repuesta" : "fotos repuestas"
                    }`
                  : ""}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                {/* Alterna entre ver solo los cambios (default) y la lista
                    completa, sin tocar qué hace "aplicar". */}
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-gray-500 underline hover:text-gray-900"
                >
                  {showAll
                    ? "Ver solo los que cambiaron"
                    : `Ver todos (${rows.length})`}
                </button>
                {resumen.cambiaron > 0 && (
                  <button
                    onClick={onApplyAll}
                    className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800"
                  >
                    Aplicar todos los cambios
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div
              className={`grid ${COLS} gap-2 px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold`}
            >
              <div>Artefacto</div>
              <div className="text-right">Lista web</div>
              <div className="text-center">Dcto</div>
              <div className="text-right">Total (antes → web)</div>
              <div></div>
            </div>
            {displayRows.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                Ningún precio cambió.{" "}
                <button
                  onClick={() => setShowAll(true)}
                  className="text-gray-600 underline hover:text-gray-900"
                >
                  Ver todos ({rows.length})
                </button>
              </div>
            ) : (
              displayRows.map((r) => {
              const changed = r.status === "ok" && !!r.changed;
              return (
                <div
                  key={r.id}
                  className={`grid ${COLS} gap-2 px-3 py-2 border-t border-gray-100 text-xs items-center`}
                >
                  <div className="min-w-0" title={[r.name, r.brand, r.detail].filter(Boolean).join(" · ")}>
                    <div className="truncate text-gray-900 font-medium">
                      {r.name}
                      {r.brand ? (
                        <span className="text-gray-400 font-normal"> · {r.brand}</span>
                      ) : null}
                    </div>
                    {r.detail ? (
                      <div className="truncate text-[11px] text-gray-500">
                        {r.detail}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right tabular-nums text-gray-700">
                    {r.webListPrice != null ? formatCLP(r.webListPrice) : "—"}
                  </div>
                  <div className="text-center tabular-nums text-gray-700">
                    {r.webDiscount != null && r.webDiscount > 0
                      ? `${Math.round(r.webDiscount * 100)}%`
                      : r.status === "ok"
                      ? "—"
                      : ""}
                  </div>
                  <div className="text-right tabular-nums">
                    {r.status !== "ok" || r.webTotal == null ? (
                      <span className="text-gray-400 text-[11px] leading-tight inline-block text-right">
                        {r.ultimaLecturaBuena?.salePrice != null ? (
                          <>
                            <span className="block">
                              no está en la tienda ahora
                            </span>
                            <span className="block tabular-nums">
                              el {fechaCorta(r.ultimaLecturaBuena.cuando)} estaba a{" "}
                              {formatCLP(r.ultimaLecturaBuena.salePrice)}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-700">
                            nunca se pudo leer — revisá el link
                          </span>
                        )}
                      </span>
                    ) : (
                      <span>
                        <span className="text-gray-400 line-through">
                          {formatCLP(r.storedTotal)}
                        </span>{" "}
                        <span
                          className={`font-semibold ${
                            r.delta == null || r.delta === 0
                              ? "text-gray-900"
                              : r.delta < 0
                              ? "text-green-700"
                              : "text-red-600"
                          }`}
                        >
                          {formatCLP(r.webTotal)}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    {r.applied ? (
                      <span className="text-[11px] text-green-700">
                        aplicado
                      </span>
                    ) : changed ? (
                      <button
                        onClick={() => onApply(r)}
                        className="text-[11px] border border-gray-300 rounded px-2 py-0.5 hover:border-gray-500"
                      >
                        aplicar
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </div>
                </div>
              );
              })
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Al aplicar se actualiza el precio lista y el descuento con lo del
            web. El Total se recalcula. Tu costo no se toca (es cotización
            aparte).
          </p>
        </>
      )}
    </div>
  );
}
