/**
 * "Extraer" de HERRAJES: pegar el link del producto y traer nombre, marca y
 * foto, más el costo SOLO cuando es seguro (pendiente 188, 2026-09-29).
 *
 * GET /api/catalogo/herrajes/extract?url=<link>&proveedor=<DPH|HBT|…>&sku=<opcional>
 *
 * Hasta acá los dos formularios de herraje (alta en la partida y catálogo)
 * usaban el extraer de ARTEFACTOS y ponían como costo el precio público de la
 * tienda. Dos problemas de plata, los dos reales:
 *
 *   1. HBT: el costo es el precio que MJ NEGOCIÓ, no el público. Merivobox E:
 *      BLARQ paga $64.000, hbt.cl publica $89.990 → entraba $26.000 más caro,
 *      sin aviso, y de ahí derecho a la partida.
 *   2. DPH: el precio público SÍ es el costo, pero el de la variante correcta.
 *      Los productos de DPH vienen en varias medidas y la página muestra el de
 *      otra: el cajón 119mm daba $26.100 cuando el de 500mm (el que se compra)
 *      es $26.900.
 *
 * Por eso el costo lo decide el server:
 *   - Solo si `extraerLlenaCosto` (proveedor DPH y link no de otro proveedor).
 *   - Y solo con el precio EXACTO de la variante: `fetchHerrajePrice` (el mismo
 *     lector que "Comparar con la tienda web"), que la busca por SKU o toma la
 *     única que haya. Si hay varias y no hay SKU, no adivina: costo vacío y se
 *     dice por qué.
 *
 * Y si la página no se puede leer, se dice el motivo real (ver MotivoFalla):
 * "la tienda no nos deja entrar desde el servidor" no es lo mismo que "el
 * link está mal".
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import {
  fetchArtefactoDataConMotivo,
  type MotivoFalla,
} from "@/lib/catalog/fetchArtefactoData";
import { fetchHerrajePrice } from "@/lib/catalog/fetchHerrajePrice";
import { aprenderTienda, permitirHostDeFoto } from "@/lib/catalog/tiendas";
import {
  avisoCostoSinLlenar,
  extraerLlenaCosto,
  normalizarProveedor,
} from "@/lib/presupuesto/herrajeProveedores";

export const runtime = "nodejs";
// hbt.cl tarda ~10 s en contestar (medido desde Santiago); el fetch corta a
// 25 s. Mismo techo que el extraer de artefactos.
export const maxDuration = 60;

function mensajeDeFalla(motivo: MotivoFalla | null, host: string): string {
  switch (motivo) {
    case "bloqueado":
      return `${host} no deja entrar a la app desde el servidor (bloquea la conexión). El link está bien: cargá nombre, foto y costo a mano.`;
    case "sin-respuesta":
      return `${host} no respondió a tiempo. Probá de nuevo en un rato, o cargá los datos a mano.`;
    case "no-existe":
      return "Ese link no existe en la tienda (la página da error). Revisá el link.";
    case "sin-conexion":
      return `No se pudo conectar con ${host}. Revisá el link, o cargá los datos a mano.`;
    case "error-tienda":
      return `${host} dio un error al abrir la página. Probá de nuevo en un rato, o cargá los datos a mano.`;
    default:
      return "La página abrió, pero no trae los datos del producto. Cargá los campos a mano.";
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const url = (request.nextUrl.searchParams.get("url") ?? "").trim();
  const proveedor = normalizarProveedor(request.nextUrl.searchParams.get("proveedor") ?? "");
  const sku = (request.nextUrl.searchParams.get("sku") ?? "").trim() || null;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return NextResponse.json({ error: "Eso no es un link (tiene que empezar con https://)." }, { status: 400 });
  }

  try {
    // Igual que artefactos: la app aprende la tienda si es nueva (no frena si falla).
    await aprenderTienda(url).catch(() => null);

    const r = await fetchArtefactoDataConMotivo(url);
    if (!r.data) {
      // Queda en el log de Vercel: sin esto no hay forma de saber desde
      // afuera si fue bloqueo, demora o link roto.
      console.warn(`[herrajes/extract] ${host} → ${r.motivo} (status ${r.status ?? "—"}, ${r.ms} ms)`);
      return NextResponse.json(
        { error: mensajeDeFalla(r.motivo, host), motivo: r.motivo, status: r.status, ms: r.ms },
        { status: 422 }
      );
    }
    await permitirHostDeFoto(r.data.imageUrl).catch(() => null);

    // ── El costo: solo DPH y solo con la variante exacta ─────────────────
    let costNet: number | null = null;
    let avisoCosto: string | null = null;
    if (extraerLlenaCosto(proveedor, url)) {
      const { costNet: exacto } = await fetchHerrajePrice({
        supplier: "DPH",
        referenceLink: url,
        sku,
      }).catch(() => ({ costNet: null }));
      if (exacto != null) {
        costNet = exacto;
      } else {
        avisoCosto = sku
          ? `No encontré el SKU ${sku} en la página de DPH: revisá el SKU o escribí el costo a mano.`
          : "Este producto de DPH viene en varias medidas y la página no dice cuál: escribí el SKU de la medida y volvé a extraer, o el costo a mano.";
      }
    } else {
      avisoCosto = avisoCostoSinLlenar(proveedor, url, r.data.listPrice);
    }

    return NextResponse.json({
      name: r.data.name,
      brand: r.data.brand,
      imageUrl: r.data.imageUrl,
      costNet,
      avisoCosto,
    });
  } catch (error) {
    console.error("Error extrayendo herraje:", error);
    return NextResponse.json({ error: "Error al extraer datos del producto" }, { status: 500 });
  }
}
