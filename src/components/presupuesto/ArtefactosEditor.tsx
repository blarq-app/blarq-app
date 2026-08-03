"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AddArtefactoFromCatalog, {
  type ArtefactoFromCatalog,
} from "./AddArtefactoFromCatalog";
import ActualizarDesdeCatalogo, {
  type CatalogApplyPatch,
} from "./ActualizarDesdeCatalogo";
import DuplicarArtefactos from "./DuplicarArtefactos";
import RevisarPreciosArtefactos, {
  type ArtefactoPricePatch,
} from "./RevisarPreciosArtefactos";
import { ROOM_ORDER, roomLabel } from "@/lib/presupuesto/ambientes";

// Input numérico con separadores de miles. Sin foco muestra "5.488.460",
// con foco muestra "5488460" para edición. onChange devuelve el número crudo.
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

interface ArtefactoItem {
  id: string;
  room: string;
  subcategory: string;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null; // decimal 0..1 (BD)
  clientPrice: number; // unitario neto del cliente (lista x (1 - dcto))
  realCostBlarq: number | null; // unitario, costo real BLARQ
  referenceLink: string | null; // URL del producto en la tienda (mk.cl, sodimac, easy)
  imageUrl: string | null; // URL de imagen (auto-extraída o pegada manual)
  catalogId: string | null; // si fue agregado desde el catálogo BLARQ
  // El descuento de esta línea lo puso MJ, no la tienda: el catálogo actualiza
  // el precio de lista pero respeta este porcentaje (ver schema.prisma).
  discountOverridden: boolean;
  sortOrder: number;
}

interface PaymentTerm {
  id: string;
  stage: string;
  percentage: number;
  amount: number | null;
}

interface Budget {
  id: string;
  version: string;
  observations: string | null;
  artefactoItems: ArtefactoItem[];
  paymentTerms: PaymentTerm[];
}

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Artefactos sanitarios",
  cocina: "Artefactos cocina",
  iluminacion: "Artefactos iluminación",
};
const SUBCATEGORY_ORDER = ["sanitario", "cocina", "iluminacion"];

const DEFAULT_PAYMENT = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Despacho", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

// Calcula el clientPrice unitario a partir de lista y descuento decimal.
function calcClientPrice(listPrice: number, discount: number | null): number {
  return listPrice * (1 - (discount ?? 0));
}

// Línea (serie) y color/terminación a partir del nombre del artefacto. Los
// artefactos vienen del catálogo, donde el nombre ya trae la línea y el color;
// acá los derivamos solo para MOSTRARLOS como columnas en la cotización (no se
// guardan). Misma lógica que el parser del catálogo. Línea en MAYÚSCULA.
const LINEA_RULES: Array<[RegExp, string]> = [
  [/NEW DELFOS/, "New Delfos"], [/NEW HOME/, "New Home"], [/STYLE-?N|\bSTYLE\b/, "Style"],
  [/ASIS/, "Asis"], [/URBAN/, "Urban"], [/STELLAR/, "Stellar"], [/ATLAS/, "Atlas"],
  [/\bHOME\b/, "Home"], [/LUXOR/, "Luxor"], [/TRENTO/, "Trento"], [/\bZEN\b/, "Zen"],
  [/BROOKLIN/, "Brooklin"], [/NIZA/, "Niza"], [/BRIZO/, "Brizo"], [/ATENAS/, "Atenas"],
  [/ALBANY/, "Albany"], [/DELFOS/, "Delfos"], [/QUEEN/, "Queen"], [/NEPAL/, "Nepal"],
  [/AMANTIA/, "Amantia"], [/ARES/, "Ares"], [/ASTORIA/, "Astoria"],
];
const COLOR_RULES: Array<[RegExp, string]> = [
  [/BRUSHED NICKEL/, "Brushed Nickel"], [/GUN GREY/, "Gun Grey"], [/NEGRO MATE/, "Negro Mate"],
  [/RUSTIC OAK/, "Rustic Oak"], [/WHITE OAK/, "White Oak"], [/MINK GREY/, "Mink Grey"],
  [/MOON GREY/, "Moon Grey"], [/BRUSHED/, "Brushed"], [/CROMAD[OA]|CROMO/, "Cromo"],
  [/BLANCO/, "Blanco"], [/\bINOX|INOXIDABLE/, "Inox"],
];
function lineaDe(name: string, detail?: string | null): string {
  const n = `${name} ${detail ?? ""}`.toUpperCase();
  for (const [re, v] of LINEA_RULES) if (re.test(n)) return v;
  return "";
}
function colorDe(name: string, detail?: string | null): string {
  const n = `${name} ${detail ?? ""}`.toUpperCase();
  for (const [re, v] of COLOR_RULES) if (re.test(n)) return v;
  return "";
}

export default function ArtefactosEditor({
  budget: initialBudget,
  projectId,
}: {
  budget: Budget;
  projectId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ArtefactoItem[]>(
    initialBudget.artefactoItems
  );
  const [observations, setObservations] = useState(
    initialBudget.observations || ""
  );
  const [paymentTerms, setPaymentTerms] = useState(
    initialBudget.paymentTerms.length > 0
      ? initialBudget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        }))
      : DEFAULT_PAYMENT
  );
  const [saving, setSaving] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [addingTo, setAddingTo] = useState<
    null | { subcategory: string; room: string }
  >(null);
  const [showActualizarCat, setShowActualizarCat] = useState(false);
  const [showRevisarWeb, setShowRevisarWeb] = useState(false);
  const [showDuplicar, setShowDuplicar] = useState(false);
  // Modal de "Agregar del catálogo" de nivel superior (sirve también cuando
  // la cotización está vacía, donde no hay rooms con su botón "+ agregar").
  const [showAgregar, setShowAgregar] = useState(false);
  // Ambiente con el que arranca el modal: "bano_principal" para el alta normal,
  // o "__custom__" cuando se abre desde "+ Nuevo ambiente" (campo libre listo).
  const [agregarInitialRoom, setAgregarInitialRoom] = useState("bano_principal");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Totales globales ─────────────────────────────────────────────────
  const totalCliente = items.reduce(
    (s, i) => s + i.clientPrice * i.quantity,
    0
  );
  const totalCostoBlarq = items.reduce(
    (s, i) => s + (i.realCostBlarq ?? 0) * i.quantity,
    0
  );
  const totalUtilidad = totalCliente - totalCostoBlarq;

  // ── Agrupación: subcategoría → habitación → items ────────────────────
  type RoomGroup = {
    key: string;
    label: string;
    items: ArtefactoItem[];
    subtotal: number;
    subtotalCostoBlarq: number;
  };
  type SubcatGroup = {
    key: string;
    label: string;
    rooms: RoomGroup[];
    subtotal: number;
    subtotalCostoBlarq: number;
  };

  const subcatBuckets = new Map<string, ArtefactoItem[]>();
  for (const it of items) {
    const k = it.subcategory || "sanitario";
    const arr = subcatBuckets.get(k) ?? [];
    arr.push(it);
    subcatBuckets.set(k, arr);
  }

  const subcats: SubcatGroup[] = Array.from(subcatBuckets.keys())
    .sort((a, b) => {
      const ia = SUBCATEGORY_ORDER.indexOf(a);
      const ib = SUBCATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((subKey) => {
      const subItems = subcatBuckets.get(subKey) ?? [];
      const roomBuckets = new Map<string, ArtefactoItem[]>();
      for (const it of subItems) {
        const r = it.room || "otro";
        const arr = roomBuckets.get(r) ?? [];
        arr.push(it);
        roomBuckets.set(r, arr);
      }
      // Orden de los ambientes (bloques): por el sortOrder MÍNIMO de sus
      // items. Antes era por ROOM_ORDER (lista fija) y caía a orden de
      // aparición para los nombres libres; como los items llegan ordenados
      // por sortOrder, el orden visible es el mismo, pero ahora es explícito
      // y reordenable (arrastrar un ambiente renumera el sortOrder). Empate
      // → orden de aparición (sort estable).
      const roomMinOrder = new Map<string, number>();
      for (const [rk, arr] of roomBuckets) {
        roomMinOrder.set(rk, Math.min(...arr.map((i) => i.sortOrder)));
      }
      const rooms = Array.from(roomBuckets.keys())
        .sort((a, b) => roomMinOrder.get(a)! - roomMinOrder.get(b)!)
        .map((rkey) => {
          const rItems = (roomBuckets.get(rkey) ?? []).sort(
            (a, b) => a.sortOrder - b.sortOrder
          );
          const subtotal = rItems.reduce(
            (s, it) => s + it.clientPrice * it.quantity,
            0
          );
          const subtotalCostoBlarq = rItems.reduce(
            (s, it) => s + (it.realCostBlarq ?? 0) * it.quantity,
            0
          );
          return {
            key: rkey,
            label: roomLabel(rkey),
            items: rItems,
            subtotal,
            subtotalCostoBlarq,
          };
        });
      const subtotal = rooms.reduce((s, r) => s + r.subtotal, 0);
      const subtotalCostoBlarq = rooms.reduce(
        (s, r) => s + r.subtotalCostoBlarq,
        0
      );
      return {
        key: subKey,
        label: SUBCATEGORY_LABELS[subKey] ?? subKey,
        rooms,
        subtotal,
        subtotalCostoBlarq,
      };
    });

  // ── Mutaciones ───────────────────────────────────────────────────────
  async function persistItem(item: ArtefactoItem) {
    await guardarItem(item);
  }

  // Guarda una línea y dice si lo logró. Separado de `persistItem` porque hay
  // un caso donde el resultado IMPORTA: aplicar precios desde un modal. Ahí no
  // alcanza con disparar el guardado y seguir — hay que esperarlo y avisar si
  // falló (ver applyOnlinePatches).
  async function guardarItem(
    item: ArtefactoItem,
    extra?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos/${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(extra ? { ...item, ...extra } : item),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  // Campos que se sincronizan entre todas las copias del mismo catalogId
  // dentro del budget (mismo WC en baño principal y baño secundario =
  // datos idénticos). Incluye realCostBlarq porque la cotización de la
  // vendedora se hace por proyecto — si MJ carga el costo en una copia,
  // debe aplicarse al WC ATENAS en todos los baños del mismo proyecto.
  // (Al catálogo BLARQ global solo sube name/precio web/imagen — eso lo
  // maneja el backend, acá solo nos importa la propagación local.)
  // NO sincronizamos: quantity, room, subcategory, sortOrder.
  const SYNC_FIELDS: Array<keyof ArtefactoItem> = [
    "name",
    "detail",
    "brand",
    "listPrice",
    "discountPercent",
    "clientPrice",
    "referenceLink",
    "imageUrl",
    "realCostBlarq",
  ];

  // Campos que se copian a otros artefactos con el MISMO NOMBRE dentro
  // de la cotización (mismo producto aunque NO vengan del catálogo —
  // caso típico: WC importados de un Excel). Así MJ carga el link de un
  // "WC ATENAS" una sola vez y se completa en todos los baños.
  // NO incluye `name` (es la clave que los agrupa) ni `realCostBlarq`
  // (costo interno, puede variar por item).
  const NAME_SYNC_FIELDS: Array<keyof ArtefactoItem> = [
    "detail",
    "brand",
    "listPrice",
    "discountPercent",
    "clientPrice",
    "referenceLink",
    "imageUrl",
  ];

  function updateItem(itemId: string, patch: Partial<ArtefactoItem>) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === itemId);
      if (!target) return prev;
      const merged = { ...target, ...patch };
      if (
        patch.listPrice !== undefined ||
        patch.discountPercent !== undefined
      ) {
        merged.clientPrice = calcClientPrice(
          merged.listPrice,
          merged.discountPercent
        );
      }
      persistItem(merged);

      const priceRecalced =
        patch.listPrice !== undefined || patch.discountPercent !== undefined;

      // Propagación a las copias del mismo catalogId (SYNC_FIELDS).
      const catalogPatch: Partial<ArtefactoItem> = {};
      let hasCatalog = false;
      for (const k of SYNC_FIELDS) {
        if (k in patch || (k === "clientPrice" && priceRecalced)) {
          (catalogPatch as Record<string, unknown>)[k] = merged[k];
          hasCatalog = true;
        }
      }

      // Propagación a los artefactos con el mismo nombre (NAME_SYNC_FIELDS).
      const namePatch: Partial<ArtefactoItem> = {};
      let hasName = false;
      for (const k of NAME_SYNC_FIELDS) {
        if (k in patch || (k === "clientPrice" && priceRecalced)) {
          (namePatch as Record<string, unknown>)[k] = merged[k];
          hasName = true;
        }
      }

      const mergedName = merged.name.trim().toLowerCase();

      return prev.map((it) => {
        if (it.id === itemId) return merged;
        // Mismo catalogId — gana sobre el match por nombre.
        if (
          hasCatalog &&
          merged.catalogId &&
          it.catalogId === merged.catalogId
        ) {
          return { ...it, ...catalogPatch };
        }
        // Mismo nombre dentro de la cotización.
        if (
          hasName &&
          mergedName &&
          it.name.trim().toLowerCase() === mergedName
        ) {
          return { ...it, ...namePatch };
        }
        return it;
      });
    });
  }

  // Cambia el AMBIENTE (room) de TODO un bloque: reasigna el room de cada
  // artefacto de ese grupo. Sirve para corregir un bloque mal cargado (ej.
  // artefactos de cocina que quedaron en "Baño principal") o para renombrar
  // un ambiente. Si el nuevo room coincide con otro bloque existente de la
  // misma subcategoría, los dos bloques se fusionan (es lo esperado).
  // `room` no está en SYNC_FIELDS ni NAME_SYNC_FIELDS, así que reusar
  // updateItem no contagia el cambio a copias del mismo producto en otros
  // ambientes — solo mueve las filas de ESTE bloque.
  function changeRoomForGroup(
    subKey: string,
    oldRoomKey: string,
    newRoom: string
  ) {
    if (!newRoom || newRoom === oldRoomKey) return;
    const targets = items.filter(
      (i) => (i.subcategory || "sanitario") === subKey && (i.room || "otro") === oldRoomKey
    );
    for (const it of targets) updateItem(it.id, { room: newRoom });
  }

  // Aplica los cambios que vienen del modal "Comparar con mi catálogo": baja
  // costo / precio a cliente / foto desde el producto del catálogo. Va por un
  // endpoint propio (NO el PUT por-ítem) para no disparar la heurística de
  // "despegar del catálogo" — bajar del catálogo no despega la línea. Cada
  // fila del modal es un ítem distinto (las copias del mismo producto en
  // otros baños aparecen como filas propias), así que no hace falta propagar.
  async function applyCatalogPatches(patches: CatalogApplyPatch[]) {
    if (patches.length === 0) return;
    const res = await fetch(
      `/api/presupuestos/${initialBudget.id}/artefactos/actualizar-catalogo`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches }),
      }
    );
    if (!res.ok) {
      alert("No se pudieron aplicar los cambios del catálogo.");
      return;
    }
    const { updated } = (await res.json()) as {
      updated: Array<
        Pick<
          ArtefactoItem,
          | "id"
          | "listPrice"
          | "discountPercent"
          | "clientPrice"
          | "realCostBlarq"
          | "imageUrl"
          | "referenceLink"
        >
      >;
    };
    const byId = new Map(updated.map((u) => [u.id, u]));
    setItems((prev) =>
      prev.map((it) => (byId.has(it.id) ? { ...it, ...byId.get(it.id)! } : it))
    );
  }

  // Aplica los cambios que vienen del modal "Comparar con la tienda web":
  // baja el precio de lista, el DESCUENTO vigente en la tienda y/o la foto que
  // MJ marcó.
  //
  // El descuento viaja desde el arreglo 2026-07-31 (auditoría de precios):
  // antes solo bajaba la lista y el precio a cliente se recalculaba con el
  // descuento VIEJO de la línea, así que una oferta nueva nunca llegaba. Si la
  // tienda no publica descuento (no es VTEX ni Shopify), el modal no lo manda
  // y acá se conserva el guardado.
  //
  // A diferencia de "Comparar con mi catálogo", esto SÍ va por `updateItem`
  // (o sea, por el PUT por-ítem) y por lo tanto DESPEGA la línea del catálogo.
  // Es lo correcto: el precio pasa a venir de la tienda, no del catálogo, así
  // que si no se despegara, la próxima sincronización del catálogo lo pisaría
  // en silencio. De paso `updateItem` recalcula el precio a cliente y propaga
  // a las copias del mismo producto.
  async function applyOnlinePatches(patches: ArtefactoPricePatch[]) {
    if (patches.length === 0) return;

    // OJO con el patrón que había acá (arreglado 2026-08-02): esto llamaba a
    // `updateItem`, que dispara el guardado DENTRO del updater de setItems y no
    // lo espera. Dos problemas: (1) el modal se cerraba antes de que los PUT
    // terminaran — cada uno tarda unos segundos, y con diez marcados eso es
    // bastante rato en el que cerrar la página o navegar los deja a medias; y
    // (2) hacer un fetch adentro de un updater de estado es un efecto en una
    // función que React espera pura, así que puede ejecutarse dos veces o
    // ninguna. En los dos casos MJ ve el modal cerrarse como si hubiera
    // funcionado y los precios siguen viejos.
    //
    // Ahora: se arman las filas nuevas, se guardan ESPERANDO cada respuesta, y
    // recién después se refresca la pantalla y se avisa si algo falló.
    const porId = new Map(items.map((i) => [i.id, i]));
    const nuevos: ArtefactoItem[] = [];
    for (const p of patches) {
      const base = porId.get(p.itemId);
      if (!base) continue;
      const merged: ArtefactoItem = { ...base };
      if (p.listPrice !== undefined) merged.listPrice = p.listPrice;
      if (p.discountPercent !== undefined) merged.discountPercent = p.discountPercent;
      if (p.imageUrl !== undefined) merged.imageUrl = p.imageUrl;
      if (p.listPrice !== undefined || p.discountPercent !== undefined) {
        merged.clientPrice = calcClientPrice(merged.listPrice, merged.discountPercent);
      }
      nuevos.push(merged);
    }

    const fallaron: string[] = [];
    const guardados: ArtefactoItem[] = [];
    for (const item of nuevos) {
      // El descuento que se aplica acá viene de la TIENDA, no es una decisión
      // de MJ: se avisa para que la línea no quede marcada como "descuento
      // propio" y siga recibiendo los del catálogo.
      const ok = await guardarItem(item, { descuentoDeLaTienda: true });
      if (ok) guardados.push(item);
      else fallaron.push(item.name);
    }

    // Solo se refleja en pantalla lo que de verdad quedó guardado.
    if (guardados.length > 0) {
      const byId = new Map(guardados.map((i) => [i.id, i]));
      setItems((prev) => prev.map((i) => byId.get(i.id) ?? i));
    }
    if (fallaron.length > 0) {
      alert(
        `No se pudieron guardar ${fallaron.length} de ${nuevos.length}:\n\n${fallaron.join("\n")}\n\nEl resto sí quedó. Probá de nuevo con estos.`
      );
    }
  }

  // Devuelve una línea al descuento de la tienda: el backend va a buscar el
  // porcentaje al catálogo y recalcula el precio a cliente. A partir de ahí la
  // línea vuelve a refrescarse sola cuando cambie el catálogo.
  async function volverAlDctoDeLaTienda(itemId: string) {
    const actual = items.find((i) => i.id === itemId);
    if (!actual) return;
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos/${itemId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Campo propio de la ACCIÓN: no alcanza con mandar
          // discountOverridden en false, porque ese valor viaja en todos los
          // guardados normales (ver el comentario del PUT).
          body: JSON.stringify({ ...actual, volverAlDescuentoDeLaTienda: true }),
        }
      );
      if (!res.ok) throw new Error("Error");
      const actualizado: ArtefactoItem = await res.json();
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, ...actualizado } : i))
      );
    } catch {
      alert("No se pudo volver al descuento de la tienda.");
    }
  }

  async function deleteItem(itemId: string) {
    try {
      await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos/${itemId}`,
        { method: "DELETE" }
      );
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      alert("Error al eliminar");
    }
  }

  // Duplica un artefacto dentro de su mismo ambiente: crea una copia con
  // todos sus campos (incluido el costo BLARQ y el link al catálogo) y la
  // deja pegada al original. Reasigna el sortOrder de ese room para que la
  // copia quede justo debajo (el display ordena por sortOrder dentro del
  // room). MJ después la edita o le cambia la cantidad como cualquier fila.
  async function duplicateItem(source: ArtefactoItem) {
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subcategory: source.subcategory,
            room: source.room,
            name: source.name,
            detail: source.detail,
            brand: source.brand,
            quantity: source.quantity,
            listPrice: source.listPrice,
            discountPercent: source.discountPercent,
            clientPrice: source.clientPrice,
            realCostBlarq: source.realCostBlarq,
            referenceLink: source.referenceLink,
            imageUrl: source.imageUrl,
            catalogId: source.catalogId,
          }),
        }
      );
      if (!res.ok) throw new Error("Error");
      const created: ArtefactoItem = await res.json();

      // Inserta la copia justo después del original y renumera el sortOrder
      // de las filas de ese ambiente para que el orden quede prolijo.
      const idx = items.findIndex((i) => i.id === source.id);
      const withCopy = [
        ...items.slice(0, idx + 1),
        created,
        ...items.slice(idx + 1),
      ];
      const inRoom = (it: ArtefactoItem) =>
        it.room === source.room && it.subcategory === source.subcategory;
      let counter = 0;
      const reordered = withCopy.map((it) =>
        inRoom(it) ? { ...it, sortOrder: counter++ } : it
      );
      setItems(reordered);
      // Persistir el nuevo orden del room (PUT por ítem, ya guarda sortOrder).
      reordered.filter(inRoom).forEach((it) => persistItem(it));
    } catch {
      alert("Error al duplicar");
    }
  }

  // ── Orden de ambientes (bloques) + filas ─────────────────────────────
  // El sortOrder es GLOBAL dentro de la subcategoría: el orden de los bloques
  // de ambiente se decide por el sortOrder mínimo de cada uno, y dentro de
  // cada ambiente las filas van por sortOrder. Reordenar (filas o bloques) y
  // duplicar pasan por `applyOrder`, que renumera 0..n toda la subcategoría
  // según un orden de ambientes y el orden interno de cada uno. Así nunca se
  // pisan los rangos entre ambientes.

  // Orden actual de los ambientes de una subcategoría (por sortOrder mínimo).
  function roomOrderOf(subKey: string, base: ArtefactoItem[]): string[] {
    const min = new Map<string, number>();
    for (const it of base) {
      if ((it.subcategory || "sanitario") !== subKey) continue;
      const r = it.room || "otro";
      const cur = min.get(r);
      if (cur === undefined || it.sortOrder < cur) min.set(r, it.sortOrder);
    }
    return [...min.keys()].sort((a, b) => min.get(a)! - min.get(b)!);
  }

  // Agrupa los items de una subcategoría por ambiente, en su orden interno
  // actual (sortOrder asc).
  function groupRooms(subKey: string, base: ArtefactoItem[]) {
    const byRoom = new Map<string, ArtefactoItem[]>();
    const sub = base
      .filter((i) => (i.subcategory || "sanitario") === subKey)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const it of sub) {
      const r = it.room || "otro";
      if (!byRoom.has(r)) byRoom.set(r, []);
      byRoom.get(r)!.push(it);
    }
    return byRoom;
  }

  // Renumera el sortOrder de toda la subcategoría según un orden de ambientes
  // y el orden interno de cada uno; aplica al estado y persiste lo que cambió.
  function applyOrder(
    roomOrder: string[],
    itemsByRoom: Map<string, ArtefactoItem[]>,
    base: ArtefactoItem[]
  ) {
    let c = 0;
    const newSort = new Map<string, number>();
    for (const r of roomOrder)
      for (const it of itemsByRoom.get(r) ?? []) newSort.set(it.id, c++);
    const oldSort = new Map(base.map((it) => [it.id, it.sortOrder]));
    const updated = base.map((it) =>
      newSort.has(it.id) ? { ...it, sortOrder: newSort.get(it.id)! } : it
    );
    setItems(updated);
    for (const it of updated) {
      if (newSort.has(it.id) && oldSort.get(it.id) !== it.sortOrder) {
        persistItem(it);
      }
    }
  }

  // Arrastrar reordena las FILAS dentro de un ambiente; renumera la subcat
  // manteniendo el orden de los demás ambientes.
  function onDragEndRoom(
    e: DragEndEvent,
    subKey: string,
    roomKey: string,
    roomItems: ArtefactoItem[]
  ) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = roomItems.findIndex((it) => it.id === active.id);
    const newIdx = roomItems.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const byRoom = groupRooms(subKey, items);
    byRoom.set(roomKey, arrayMove(roomItems, oldIdx, newIdx));
    applyOrder(roomOrderOf(subKey, items), byRoom, items);
  }

  // Arrastrar reordena los BLOQUES de ambiente (ej. subir "Baño 3" sobre
  // "Baño 2"). Los ids de la lista de ambientes son "<subKey>::<roomKey>".
  function onDragEndRoomBlocks(e: DragEndEvent, subKey: string) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const roomOf = (id: string) => id.split("::").slice(1).join("::");
    const fromRoom = roomOf(String(active.id));
    const toRoom = roomOf(String(over.id));
    const order = roomOrderOf(subKey, items);
    const from = order.indexOf(fromRoom);
    const to = order.indexOf(toRoom);
    if (from < 0 || to < 0) return;
    applyOrder(arrayMove(order, from, to), groupRooms(subKey, items), items);
  }

  // Duplica un ambiente COMPLETO: copia todos sus artefactos a un ambiente
  // nuevo ("<nombre> (copia)") que queda justo debajo del original. MJ lo usa
  // para armar un baño igual a otro y después cambiarle el nombre.
  async function duplicateRoom(
    subKey: string,
    roomKey: string,
    roomLabel: string
  ) {
    const roomItems = items
      .filter(
        (i) =>
          (i.subcategory || "sanitario") === subKey &&
          (i.room || "otro") === roomKey
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (roomItems.length === 0) return;
    const newRoom = `${roomLabel} (copia)`;
    try {
      const created: ArtefactoItem[] = [];
      for (const src of roomItems) {
        const res = await fetch(
          `/api/presupuestos/${initialBudget.id}/artefactos`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subcategory: src.subcategory,
              room: newRoom,
              name: src.name,
              detail: src.detail,
              brand: src.brand,
              quantity: src.quantity,
              listPrice: src.listPrice,
              discountPercent: src.discountPercent,
              clientPrice: src.clientPrice,
              realCostBlarq: src.realCostBlarq,
              referenceLink: src.referenceLink,
              imageUrl: src.imageUrl,
              catalogId: src.catalogId,
            }),
          }
        );
        if (!res.ok) throw new Error("Error");
        created.push(await res.json());
      }
      // Insertar el ambiente nuevo justo después del original y renumerar.
      const order = roomOrderOf(subKey, items);
      const at = order.indexOf(roomKey);
      const newOrder = [
        ...order.slice(0, at + 1),
        newRoom,
        ...order.slice(at + 1),
      ];
      const byRoom = groupRooms(subKey, items);
      byRoom.set(newRoom, created); // copias en el mismo orden que el original
      applyOrder(newOrder, byRoom, [...items, ...created]);
    } catch {
      alert("Error al duplicar el ambiente");
    }
  }

  // Agrega un item al budget desde el payload del componente
  // AddArtefactoFromCatalog (puede venir del catálogo o tipeado manual).
  async function addItemFromPayload(
    subcategory: string,
    room: string,
    payload: ArtefactoFromCatalog
  ) {
    const clientPrice = calcClientPrice(
      payload.listPrice,
      payload.discountPercent
    );
    try {
      const res = await fetch(
        `/api/presupuestos/${initialBudget.id}/artefactos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subcategory,
            room,
            name: payload.name,
            detail: payload.detail,
            brand: payload.brand,
            quantity: payload.quantity,
            listPrice: payload.listPrice,
            discountPercent: payload.discountPercent,
            clientPrice,
            realCostBlarq: null,
            referenceLink: payload.referenceLink,
            imageUrl: payload.imageUrl,
            catalogId: payload.catalogId,
            // Alta manual: si MJ eligió "Desplegar al catálogo", el backend
            // crea/reutiliza la entrada y la vincula. Default = solo proyecto.
            promoteToCatalog: payload.promoteToCatalog ?? false,
            line: payload.line ?? null,
            finish: payload.finish ?? null,
          }),
        }
      );
      if (!res.ok) throw new Error("Error");
      const created = await res.json();
      setItems((prev) => [...prev, created]);
    } catch {
      alert("Error al agregar artefacto");
    }
  }


  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/presupuestos/${initialBudget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations }),
      });
      await fetch(`/api/presupuestos/${initialBudget.id}/forma-pago`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: paymentTerms.map((t) => ({
            stage: t.stage,
            percentage: t.percentage,
            amount: (totalCliente * t.percentage) / 100,
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

  // ── Layout de columnas: grid igual a un thead, reaprovechable por fila.
  // En "showCost" se agregan 2 columnas extra (NETO BLARQ + UTILIDAD) que
  // NO van al PDF — solo visibles internamente.
  // OJO: las clases de Tailwind tienen que aparecer LITERALES en el código
  // para que el tree-shaking las detecte. Por eso las defino como strings
  // constantes y no las interpolo.
  // La 1ª columna (1.5rem) es la manija de arrastre ⋮⋮, a la izquierda y
  // siempre visible (antes estaba al final de la fila, fuera de pantalla en
  // esta tabla ancha). El resto de las columnas no cambia.
  const gridColsCost =
    "grid grid-cols-[1.5rem_5rem_minmax(0,1.9fr)_4.5rem_4.5rem_minmax(0,1.4fr)_minmax(0,0.7fr)_2.25rem_5.5rem_3rem_6rem_5.5rem_5rem_3.5rem]";
  const gridColsClean =
    "grid grid-cols-[1.5rem_5rem_minmax(0,1.9fr)_4.5rem_4.5rem_minmax(0,1.4fr)_minmax(0,0.7fr)_2.25rem_5.5rem_3rem_6rem_3.5rem]";
  const gridCls = showCost ? gridColsCost : gridColsClean;

  return (
    <div className="space-y-6">
      {/* Toggle costo interno — banner editorial sutil arriba de todo */}
      <div className="flex items-start justify-between gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={showCost}
            onChange={(e) => setShowCost(e.target.checked)}
            className="accent-gray-900"
          />
          Mostrar columnas internas (costo BLARQ, utilidad) — no van al PDF cliente
        </label>
        {/* Con el sexto botón ("Comparar con la tienda web") la fila ya no
            entra en pantallas angostas. `flex-wrap` + `whitespace-nowrap` hace
            que los botones salten de renglón enteros, en vez de partirse cada
            uno en dos líneas. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => {
              setAgregarInitialRoom("bano_principal");
              setShowAgregar(true);
            }}
            className="text-sm bg-gray-900 text-white px-3 py-2 rounded-lg font-medium hover:bg-gray-800 whitespace-nowrap"
          >
            + Agregar del catálogo
          </button>
          {/* Abre el mismo modal pero con el campo de ambiente nuevo listo
              para escribir (ej. "Baño 3"). Antes esto estaba escondido dentro
              del desplegable "+ Otro ambiente…" y no se encontraba. */}
          <button
            onClick={() => {
              setAgregarInitialRoom("__custom__");
              setShowAgregar(true);
            }}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50 whitespace-nowrap"
          >
            + Nuevo ambiente
          </button>
          <button
            onClick={() => setShowDuplicar(true)}
            className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50 whitespace-nowrap"
          >
            Traer de otra cotización
          </button>
          {/* Los dos botones de precios van en espejo ("Comparar con…") para
              que se lea de un vistazo contra QUÉ compara cada uno: el catálogo
              interno de BLARQ o la tienda web de hoy. Decisión de MJ.
              Van envueltos en su propio flex para que, cuando la barra tenga
              que saltar de renglón, salten LOS DOS JUNTOS — separados dejan de
              leerse como par. */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowActualizarCat(true)}
              className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50 whitespace-nowrap"
            >
              Comparar con mi catálogo
            </button>
            <button
              onClick={() => setShowRevisarWeb(true)}
              className="text-sm border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-medium hover:bg-gray-50 whitespace-nowrap"
            >
              Comparar con la tienda web
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Cada subcategoría es un bloque editorial cerrado */}
      {subcats.map((sub) => (
        <div
          key={sub.key}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          {/* Banner negro con el nombre de la subcategoría */}
          <div className="bg-gray-900 text-white px-4 py-2 text-[11px] font-semibold uppercase tracking-wider">
            {sub.label}
          </div>

          {/* Los ambientes (bloques) son arrastrables entre sí: se agarra el
              banner por la manija ⋮⋮ y se sube/baja sobre otro ambiente. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => onDragEndRoomBlocks(e, sub.key)}
          >
            <SortableContext
              items={sub.rooms.map((r) => `${sub.key}::${r.key}`)}
              strategy={verticalListSortingStrategy}
            >
              {sub.rooms.map((room) => (
                <SortableRoomBlock
                  key={room.key}
                  id={`${sub.key}::${room.key}`}
                >
                  {(handle) => (
                    <>
                      {/* Banner del room: manija (arrastrar el ambiente) +
                          nombre editable directo (izq) · agregar + duplicar
                          (der). */}
                      <div className="bg-gray-100 px-4 py-1.5 border-b border-gray-300 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            {...handle.attributes}
                            {...handle.listeners}
                            className="cursor-grab text-gray-300 hover:text-gray-700 select-none leading-none shrink-0"
                            title="Arrastrar para reordenar el ambiente (subir/bajar el bloque entero)"
                          >
                            ⋮⋮
                          </span>
                          <RoomBanner
                            label={room.label}
                            onChange={(newRoom) =>
                              changeRoomForGroup(sub.key, room.key, newRoom)
                            }
                          />
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            onClick={() =>
                              setAddingTo({
                                subcategory: sub.key,
                                room: room.key,
                              })
                            }
                            className="text-gray-500 hover:text-gray-900"
                            title="Agregar un artefacto a este ambiente"
                          >
                            {/* El tamaño va en un <span>: hay una regla global
                                `button{font-size:.75rem !important}` que pisa
                                cualquier clase/estilo puesto en el botón. El
                                span no la matchea, así que acá sí achica. */}
                            <span
                              style={{ fontSize: "9px" }}
                              className="uppercase tracking-wider"
                            >
                              + agregar artefacto
                            </span>
                          </button>
                          {/* Duplicar el ambiente — mismo ícono que duplicar fila (⎘) */}
                          <button
                            onClick={() =>
                              duplicateRoom(sub.key, room.key, room.label)
                            }
                            className="text-gray-400 hover:text-gray-900 text-sm leading-none"
                            title="Duplicar este ambiente con todos sus artefactos"
                          >
                            ⎘
                          </button>
                        </div>
                      </div>

                      {/* Form de agregar — debajo del banner cuando está activo */}
                      {addingTo?.subcategory === sub.key &&
                        addingTo?.room === room.key && (
                          <AddArtefactoFromCatalog
                            roomLabel={room.label}
                            defaultSubcategory={sub.key}
                            onAdd={async (payload) => {
                              await addItemFromPayload(
                                sub.key,
                                room.key,
                                payload
                              );
                              setAddingTo(null);
                            }}
                            onCancel={() => setAddingTo(null)}
                          />
                        )}

                      {/* Header de columnas */}
                      <div
                        className={`${gridCls} items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white text-[10px] font-semibold text-gray-500 uppercase tracking-wider`}
                      >
                        {/* Columna de la manija de arrastre — sin título */}
                        <div></div>
                        <div className="text-center">Img</div>
                        <div>Item</div>
                        <div>Línea</div>
                        <div>Color</div>
                        <div>Detalle</div>
                        <div>Marca</div>
                        <div className="text-center">Cant.</div>
                        <div className="text-right">P. lista</div>
                        <div className="text-right">Dcto</div>
                        <div className="text-right">Total</div>
                        {showCost && (
                          <>
                            <div className="text-right text-red-700/80">
                              Costo BLARQ
                            </div>
                            <div className="text-right text-green-700/80">
                              Utilidad
                            </div>
                          </>
                        )}
                        <div></div>
                      </div>

                      {/* Items del room — arrastrables (manija ⋮⋮ a la izq) */}
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) =>
                          onDragEndRoom(e, sub.key, room.key, room.items)
                        }
                      >
                        <SortableContext
                          items={room.items.map((i) => i.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {room.items.map((item) => (
                            <SortableArtefactoRow
                              key={item.id}
                              item={item}
                              projectId={projectId}
                              showCost={showCost}
                              gridCls={gridCls}
                              onUpdate={(patch) => updateItem(item.id, patch)}
                              onVolverAlDctoDeLaTienda={() =>
                                volverAlDctoDeLaTienda(item.id)
                              }
                              onDelete={() => deleteItem(item.id)}
                              onDuplicate={() => duplicateItem(item)}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>

                      {/* Subtotal del room */}
                      <div
                        className={`${gridCls} items-center gap-3 px-4 py-2 bg-gray-50 border-t border-gray-900 text-xs font-semibold`}
                      >
                        <div className="col-span-10 text-gray-600 uppercase tracking-wider text-[10px]">
                          Total artefactos {room.label.toLowerCase()}
                        </div>
                        <div className="text-right tabular-nums text-gray-900">
                          {formatCLP(room.subtotal)}
                        </div>
                        {showCost && (
                          <>
                            <div className="text-right tabular-nums text-red-700">
                              {formatCLP(room.subtotalCostoBlarq)}
                            </div>
                            <div
                              className={`text-right tabular-nums ${
                                room.subtotal - room.subtotalCostoBlarq >= 0
                                  ? "text-green-700"
                                  : "text-red-700"
                              }`}
                            >
                              {formatCLP(
                                room.subtotal - room.subtotalCostoBlarq
                              )}
                            </div>
                          </>
                        )}
                        <div></div>
                      </div>
                    </>
                  )}
                </SortableRoomBlock>
              ))}
            </SortableContext>
          </DndContext>

          {/* Subtotal de subcategoría */}
          <div
            className={`${gridCls} items-center gap-3 px-4 py-2.5 bg-gray-100 border-t-2 border-gray-900 text-xs font-bold uppercase tracking-wider`}
          >
            <div className="col-span-10 text-gray-900">Total {sub.label.toLowerCase()}</div>
            <div className="text-right tabular-nums text-gray-900 text-sm">
              {formatCLP(sub.subtotal)}
            </div>
            {showCost && (
              <>
                <div className="text-right tabular-nums text-red-700">
                  {formatCLP(sub.subtotalCostoBlarq)}
                </div>
                <div
                  className={`text-right tabular-nums ${
                    sub.subtotal - sub.subtotalCostoBlarq >= 0
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {formatCLP(sub.subtotal - sub.subtotalCostoBlarq)}
                </div>
              </>
            )}
            <div></div>
          </div>
        </div>
      ))}

      {/* Si no hay items todavía, ofrecemos arrancar */}
      {subcats.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">
            No hay artefactos cargados. Agregá del catálogo, traé de otra
            cotización o importá desde un Excel.
          </p>
          <button
            onClick={() => setShowAgregar(true)}
            className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
          >
            + Agregar del catálogo
          </button>
        </div>
      )}

      {/* Total general */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4">
        <div className="max-w-md ml-auto space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 uppercase tracking-wider text-xs">
              Total cliente
            </span>
            <span className="font-bold tabular-nums text-gray-900">
              {formatCLP(totalCliente)}
            </span>
          </div>
          {showCost && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 uppercase tracking-wider">
                  Costo BLARQ
                </span>
                <span className="font-medium tabular-nums text-red-700">
                  {formatCLP(totalCostoBlarq)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t-2 border-gray-900 pt-2">
                <span className="text-gray-900 uppercase tracking-wider text-xs">
                  Utilidad
                </span>
                <span
                  className={`tabular-nums ${
                    totalUtilidad >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {formatCLP(totalUtilidad)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Forma de pago */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Forma de pago
        </h2>
        <div className="space-y-2 max-w-lg">
          {paymentTerms.map((term, index) => (
            <div
              key={index}
              className="grid grid-cols-12 gap-3 items-center text-xs"
            >
              <div className="col-span-5">
                <input
                  type="text"
                  value={term.stage}
                  onChange={(e) => {
                    const u = [...paymentTerms];
                    u[index] = { ...u[index], stage: e.target.value };
                    setPaymentTerms(u);
                  }}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                />
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={term.percentage}
                    onChange={(e) => {
                      const u = [...paymentTerms];
                      u[index] = {
                        ...u[index],
                        percentage: parseFloat(e.target.value) || 0,
                      };
                      setPaymentTerms(u);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none text-right tabular-nums focus:border-gray-500"
                  />
                  <span className="text-gray-500">%</span>
                </div>
              </div>
              <div className="col-span-3 text-right text-gray-700 tabular-nums">
                {formatCLP((totalCliente * term.percentage) / 100)}
              </div>
              <div className="col-span-1">
                <button
                  onClick={() =>
                    setPaymentTerms(paymentTerms.filter((_, i) => i !== index))
                  }
                  className="text-gray-300 hover:text-red-600"
                >
                  ×
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
              className="text-xs text-gray-600 hover:text-gray-900 font-medium"
            >
              + agregar etapa
            </button>
            <span className="text-xs text-gray-500">
              Total:{" "}
              {paymentTerms.reduce((s, t) => s + t.percentage, 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Observaciones
        </h2>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded text-xs outline-none resize-none focus:border-gray-500"
          placeholder="Notas adicionales que se incluirán en el PDF cliente…"
        />
      </div>

      {/* Modal: actualizar costo/precio/foto desde el catálogo BLARQ */}
      {showActualizarCat && (
        <ActualizarDesdeCatalogo
          budgetId={initialBudget.id}
          onApply={applyCatalogPatches}
          onClose={() => setShowActualizarCat(false)}
        />
      )}

      {/* Modal: comparar precio/foto contra la tienda web del link */}
      {showRevisarWeb && (
        <RevisarPreciosArtefactos
          budgetId={initialBudget.id}
          onApply={applyOnlinePatches}
          onClose={() => setShowRevisarWeb(false)}
        />
      )}

      {/* Modal: traer artefactos de otra cotización */}
      {showDuplicar && (
        <DuplicarArtefactos
          budgetId={initialBudget.id}
          onClose={() => setShowDuplicar(false)}
          onDone={(newItems) => {
            // Los items duplicados ya están en BD — los agregamos al
            // estado local sin recargar (router.refresh no reinicializa
            // el useState del editor).
            setItems((prev) => [...prev, ...newItems]);
            setShowDuplicar(false);
          }}
        />
      )}

      {/* Modal: agregar del catálogo (nivel superior — sirve con la
          cotización vacía). Elegís el ambiente y vas agregando varios. */}
      {showAgregar && (
        <AgregarArtefactosModal
          initialRoom={agregarInitialRoom}
          onAdd={addItemFromPayload}
          onClose={() => setShowAgregar(false)}
        />
      )}
    </div>
  );
}

// ─── Bloque de ambiente arrastrable ──────────────────────────────────────
//
// Envuelve un ambiente completo (banner + items + subtotal) para poder
// arrastrarlo y reordenarlo entre sus hermanos del mismo tipo (ej. subir
// "Baño 3" sobre "Baño 2"). La manija de arrastre (⋮⋮) va en el banner; el
// resto del bloque no arrastra. `children` recibe la manija para pintarla.
type RoomDragHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners"
>;
function SortableRoomBlock({
  id,
  children,
}: {
  id: string;
  children: (handle: RoomDragHandle) => ReactNode;
}) {
  const s = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
    opacity: s.isDragging ? 0.6 : 1,
    zIndex: s.isDragging ? 20 : ("auto" as const),
    position: "relative" as const,
    background: s.isDragging ? "#FFFFFF" : undefined,
  };
  return (
    <div
      ref={s.setNodeRef}
      style={style}
      className="border-b border-gray-200 last:border-b-0"
    >
      {children({ attributes: s.attributes, listeners: s.listeners })}
    </div>
  );
}

// ─── Banner de ambiente (room) — nombre editable directo ─────────────────
//
// El nombre del ambiente que titula cada bloque se edita EN EL LUGAR: se
// clickea sobre el texto y se escribe. Al salir del campo (blur) o apretar
// Enter, se guarda reasignando el ambiente de TODO el bloque
// (changeRoomForGroup, en el padre). Escape descarta. Antes había un botón
// "Editar ambiente" con un desplegable; MJ prefiere escribir el nombre
// directo, sin ese paso intermedio.
function RoomBanner({
  label,
  onChange,
}: {
  label: string;
  onChange: (newRoom: string) => void;
}) {
  // Se edita una copia local del nombre; recién al confirmar se persiste.
  // El padre remonta el bloque cuando cambia el ambiente (key=room.key), así
  // que el useState se reinicializa solo con el label nuevo.
  const [value, setValue] = useState(label);

  function commit() {
    const next = value.trim();
    // Vacío o sin cambios → volver al nombre actual, no tocar nada.
    if (!next || next === label) {
      setValue(label);
      return;
    }
    onChange(next);
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(label);
          e.currentTarget.blur();
        }
      }}
      title="Nombre del ambiente — clic para editar"
      className="flex-1 min-w-0 bg-transparent border-0 p-0 text-[11px] font-bold uppercase tracking-wider text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
    />
  );
}

// ─── Modal: agregar artefactos del catálogo ──────────────────────────────
//
// Punto de entrada de nivel superior para sumar artefactos al presupuesto.
// A diferencia del botón "+ agregar" de cada room (que vive dentro de un
// grupo y necesita que ya haya items), este modal se puede abrir siempre —
// incluido el caso de cotización vacía. MJ elige el AMBIENTE (baño, cocina…)
// y el TIPO (sanitario/cocina/iluminación), busca en el catálogo y va
// agregando; el modal queda abierto para sumar varios de una.
function AgregarArtefactosModal({
  initialRoom = "bano_principal",
  onAdd,
  onClose,
}: {
  initialRoom?: string;
  onAdd: (
    subcategory: string,
    room: string,
    payload: ArtefactoFromCatalog
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [customRoom, setCustomRoom] = useState("");
  const [sub, setSub] = useState("sanitario");
  const [count, setCount] = useState(0);

  // Ambiente efectivo: si MJ eligió "+ Otro ambiente…" usa el nombre que
  // escribió (texto libre, ej. "Baño 3", "Terraza"). El ambiente se guarda
  // como texto en la BD, así que no hace falta una lista cerrada de opciones.
  const isCustomRoom = room === "__custom__";
  const effectiveRoom = isCustomRoom ? customRoom.trim() : room;
  const effectiveRoomLabel = isCustomRoom
    ? customRoom.trim() || "nuevo ambiente"
    : roomLabel(room);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-4xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Agregar del catálogo
            {count > 0 && (
              <span className="ml-2 text-[11px] font-normal text-green-700 normal-case tracking-normal">
                {count} agregado{count === 1 ? "" : "s"}
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-gray-800"
          >
            Listo
          </button>
        </div>

        {/* Selectores: ambiente + tipo */}
        <div className="flex flex-wrap items-end gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Ambiente
            </label>
            <div className="flex items-center gap-2">
              <select
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:border-gray-500"
              >
                {ROOM_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {roomLabel(r)}
                  </option>
                ))}
                <option value="__custom__">+ Otro ambiente…</option>
              </select>
              {isCustomRoom && (
                <input
                  autoFocus
                  type="text"
                  value={customRoom}
                  onChange={(e) => setCustomRoom(e.target.value)}
                  placeholder="Ej. Baño 3, Baño suite, Terraza"
                  className="w-48 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:border-gray-500"
                />
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo
            </label>
            <div className="flex items-center gap-1">
              {SUBCATEGORY_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setSub(s)}
                  className={`text-[11px] px-2.5 py-1.5 rounded ${
                    sub === s
                      ? "bg-gray-900 text-white"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {SUBCATEGORY_LABELS[s]?.replace("Artefactos ", "") ?? s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Buscador del catálogo (reusa el componente existente). Cambia de
            subcategoría al tocar el tab → vuelve a buscar. */}
        <AddArtefactoFromCatalog
          key={sub}
          roomLabel={effectiveRoomLabel}
          defaultSubcategory={sub}
          onAdd={async (payload) => {
            if (!effectiveRoom) {
              alert("Escribí el nombre del nuevo ambiente.");
              return;
            }
            await onAdd(sub, effectiveRoom, payload);
            setCount((c) => c + 1);
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

// ─── Componente: fila de artefacto (arrastrable) ─────────────────────────
//
// La fila se puede arrastrar de la manija "⋮⋮" (a la derecha, junto a ×) para
// reordenar DENTRO del room. Borrar (×) queda visible. El resto de las celdas
// son los inputs editables de siempre.
function SortableArtefactoRow({
  item,
  projectId,
  showCost,
  gridCls,
  onUpdate,
  onVolverAlDctoDeLaTienda,
  onDelete,
  onDuplicate,
}: {
  item: ArtefactoItem;
  projectId: string;
  showCost: boolean;
  gridCls: string;
  onUpdate: (patch: Partial<ArtefactoItem>) => void;
  onVolverAlDctoDeLaTienda?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    background: sortable.isDragging ? "#FAFAFA" : undefined,
  };
  const totalCliente = item.clientPrice * item.quantity;
  const totalCosto = (item.realCostBlarq ?? 0) * item.quantity;
  const utilidad = totalCliente - totalCosto;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`${gridCls} items-center gap-3 px-4 py-1 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
    >
      {/* Manija de arrastre — 1ª columna, siempre visible. Arrastrar reordena
          la fila dentro de su mismo ambiente. */}
      <span
        {...sortable.attributes}
        {...sortable.listeners}
        className="cursor-grab text-gray-300 hover:text-gray-700 select-none leading-none text-center"
        title="Arrastrar para reordenar dentro del ambiente"
      >
        ⋮⋮
      </span>
      <ItemImageCell
        projectId={projectId}
        item={item}
        onUpdate={onUpdate}
      />
      {/* Item: textarea a 2 líneas para que el nombre no se corte. Si el
          producto tiene link a la tienda, una flechita ↗ al lado abre la
          página web del producto en una pestaña nueva. */}
      <div className="flex items-start gap-1">
        <textarea
          rows={2}
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="flex-1 bg-transparent border-0 p-0 font-semibold text-gray-900 text-[11px] leading-tight resize-none outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        {item.referenceLink && (
          <a
            href={item.referenceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 mt-0.5 text-gray-400 hover:text-gray-900 leading-none"
            title="Abrir el producto en la tienda (página web)"
          >
            ↗
          </a>
        )}
      </div>
      {/* Línea (derivada del nombre, en MAYÚSCULA) — solo lectura. */}
      <div className="text-[11px] font-medium text-gray-700 uppercase leading-tight">
        {lineaDe(item.name, item.detail) || "—"}
      </div>
      {/* Color (derivado del nombre/detalle) — solo lectura. */}
      <div className="text-[11px] text-gray-600 leading-tight">
        {colorDe(item.name, item.detail) || "—"}
      </div>
      {/* Detalle: 2 líneas para que el modelo largo no se corte. */}
      <textarea
        rows={2}
        value={item.detail ?? ""}
        placeholder="modelo…"
        onChange={(e) => onUpdate({ detail: e.target.value })}
        className="w-full bg-transparent border-0 p-0 text-gray-700 text-[11px] leading-tight resize-none outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
      />
      <input
        type="text"
        value={item.brand ?? ""}
        onChange={(e) => onUpdate({ brand: e.target.value })}
        className="w-full bg-transparent border-0 p-0 text-gray-600 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
      />
      <input
        type="number"
        value={item.quantity}
        onChange={(e) =>
          onUpdate({ quantity: parseInt(e.target.value) || 1 })
        }
        className="w-full bg-transparent border-0 p-0 text-center tabular-nums text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
      />
      <ThousandsInput
        value={item.listPrice}
        onChange={(v) => onUpdate({ listPrice: v })}
        placeholder="0"
        className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
      />
      {/* DCTO. Un solo casillero, como siempre, pero ahora se ve de quién es
          el número: si lo puso MJ queda resaltado y aparece la vuelta al de la
          tienda. Mientras sea de la tienda, el catálogo lo sigue refrescando. */}
      <div className="flex items-center justify-end gap-0.5">
        <input
          type="number"
          step="1"
          value={
            item.discountPercent !== null
              ? Math.round(item.discountPercent * 100)
              : ""
          }
          placeholder="0"
          title={
            item.discountOverridden
              ? "Este descuento lo pusiste vos. El catálogo actualiza el precio de lista pero no lo toca."
              : "Descuento de la tienda. Se actualiza solo desde el catálogo."
          }
          onChange={(e) =>
            onUpdate({
              discountPercent: (parseFloat(e.target.value) || 0) / 100,
            })
          }
          className={`w-8 bg-transparent border-0 p-0 text-right tabular-nums outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5 ${
            item.discountOverridden
              ? "font-semibold text-gray-900"
              : "text-gray-600"
          }`}
        />
        <span className={item.discountOverridden ? "text-gray-900" : "text-gray-400"}>
          %
        </span>
        {item.discountOverridden && (
          <button
            type="button"
            onClick={() => onVolverAlDctoDeLaTienda?.()}
            title="Volver al descuento de la tienda"
            className="text-gray-300 hover:text-gray-700 leading-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </div>
      <div className="text-right tabular-nums font-semibold text-gray-900">
        {formatCLP(totalCliente)}
      </div>
      {showCost && (
        <>
          <ThousandsInput
            value={item.realCostBlarq ?? 0}
            onChange={(v) => onUpdate({ realCostBlarq: v })}
            placeholder="—"
            className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-red-700 outline-none focus:bg-white focus:border focus:border-red-300 focus:rounded focus:px-1 focus:py-0.5"
          />
          <div
            className={`text-right tabular-nums font-semibold ${
              utilidad >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {formatCLP(utilidad)}
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={onDuplicate}
          className="text-gray-400 hover:text-gray-900 text-sm leading-none"
          title="Duplicar fila (otra igual en este ambiente)"
        >
          ⎘
        </button>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 text-sm leading-none"
          title="Eliminar fila"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Componente: celda de imagen del item ────────────────────────────────
//
// Muestra un thumbnail si hay imageUrl, o un placeholder "+ foto". Click
// abre un popover sencillo donde MJ puede:
//   - Pegar URL del producto (referenceLink) → click "Extraer" → auto-fetch
//     trae imagen + nombre + marca + precio lista del sitio (mk.cl / sodimac
//     / easy).
//   - Pegar URL de imagen manual (fallback cuando el sitio no es soportado
//     o el producto está descontinuado).
//
// El popover NO va al PDF — esto es solo edición.

function ItemImageCell({
  projectId,
  item,
  onUpdate,
}: {
  projectId: string;
  item: ArtefactoItem;
  onUpdate: (patch: Partial<ArtefactoItem>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState(item.referenceLink ?? "");
  const [imgDraft, setImgDraft] = useState(item.imageUrl ?? "");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el item cambió (otro item se renderizó), reset drafts.
  // Esto es importante porque ItemImageCell se re-monta por item (key),
  // pero como precaución leemos también del item.
  function openPopover() {
    setLinkDraft(item.referenceLink ?? "");
    setImgDraft(item.imageUrl ?? "");
    setError(null);
    setOpen(true);
  }

  async function handleExtract() {
    if (!linkDraft) {
      setError("Pegá primero el link del producto.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/proyectos/${projectId}/artefactos/extract?url=${encodeURIComponent(
          linkDraft
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ||
            "No se pudo extraer. Probá pegar la URL de imagen manualmente."
        );
        return;
      }
      // Aplicamos lo que vino del scraper. Si vienen vacíos algunos campos
      // (común en productos parcialmente catalogados), respetamos lo que
      // MJ ya tenía cargado.
      if (data.imageUrl) setImgDraft(data.imageUrl);
      const patch: Partial<ArtefactoItem> = {
        referenceLink: linkDraft,
        imageUrl: data.imageUrl ?? item.imageUrl ?? null,
      };
      if (data.name && !item.detail) patch.detail = data.name;
      if (data.brand && !item.brand) patch.brand = data.brand;
      if (data.listPrice && data.listPrice > 0 && !item.listPrice) {
        patch.listPrice = data.listPrice;
        // Junto con la lista entra el descuento vigente en la tienda (arreglo
        // 2026-07-31). Sin él, un producto en oferta quedaba con el precio
        // rebajado como lista y 0% — cobrándole al cliente el precio de oferta
        // como si fuera el de catálogo.
        if (data.discountPercent != null && !item.discountPercent) {
          patch.discountPercent = data.discountPercent;
        }
      }
      onUpdate(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtracting(false);
    }
  }

  function handleSave() {
    onUpdate({
      referenceLink: linkDraft || null,
      imageUrl: imgDraft || null,
    });
    setOpen(false);
  }

  function handleClear() {
    setLinkDraft("");
    setImgDraft("");
    onUpdate({ referenceLink: null, imageUrl: null });
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopover}
        className="w-[66px] h-[66px] mx-auto rounded border border-gray-200 hover:border-gray-500 bg-white flex items-center justify-center overflow-hidden transition-colors"
        title={item.imageUrl ? "Editar imagen" : "Agregar imagen"}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-gray-300 text-lg">+</span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">
              Imagen del artefacto
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Link del producto (mk.cl, chc.cl, byp.cl, ledstudio, ledconcept, sodimac, easy…)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    placeholder="https://www.mk.cl/…"
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                  />
                  <button
                    onClick={handleExtract}
                    disabled={extracting || !linkDraft}
                    className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {extracting ? "Buscando…" : "Extraer"}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  La app intentará traer imagen + nombre + marca + precio
                  lista. Si el producto está descontinuado, usá el campo de
                  abajo.
                </p>
              </div>

              {error && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  URL de imagen (manual, fallback)
                </label>
                <input
                  type="url"
                  value={imgDraft}
                  onChange={(e) => setImgDraft(e.target.value)}
                  placeholder="https://…/imagen.jpg"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Pegá un link directo a una foto (.jpg / .png / .webp).
                </p>
              </div>

              {imgDraft && (
                <div className="border border-gray-200 rounded p-2 bg-gray-50">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                    Vista previa
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgDraft}
                    alt="preview"
                    className="max-h-40 mx-auto object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.3";
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={handleClear}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                Borrar imagen
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
