import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderObraHTML } from "@/lib/pdf/ObraPDF.html";
import { renderMueblesHTML } from "@/lib/pdf/MueblesPDF.html";
import { renderMueblistaHTML } from "@/lib/pdf/MueblistaPDF.html";
import {
  renderArtefactosHTML,
  buildArtefactosFooter,
} from "@/lib/pdf/ArtefactosPDF.html";
import {
  renderOrdenCompraArtefactosHTML,
  ordenCompraFilename,
} from "@/lib/pdf/OrdenCompraArtefactosPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";
import {
  getObraBaselineItems,
  computeChangeMarkers,
} from "@/lib/presupuesto/versionDiff";
import { requireSession } from "@/lib/apiAuth";
import {
  esTipoCondiciones,
  parseCondiciones,
} from "@/lib/presupuesto/condiciones";
import { getPlantillaCondiciones } from "@/lib/presupuesto/condicionesPlantilla";
import {
  agruparConAlternativas,
  soloPrincipales,
} from "@/lib/presupuesto/muebleItems";
import { marcaParaCliente } from "@/lib/presupuesto/herrajeMarca";

// Lo que el PDF de muebles necesita de una partida (base o alternativa): sin
// costos internos ni proveedor. `marcas` es catalogId → brand del catálogo de
// herrajes: la línea de la cotización no guarda la marca (es un snapshot de
// nombre/medida/color/costo), así que se lee del catálogo al generar el PDF.
// Al cliente solo se le muestra si es una marca de verdad, no el proveedor
// (ver marcaParaCliente).
function muebleItemParaPDF(
  i: {
    itemNumber: string;
    name: string;
    descriptionGeneral: string | null;
    quantity: number;
    clientPriceIva: number;
    details: { name: string; material: string }[];
    herrajes: {
      sector: string;
      name: string;
      measure: string | null;
      finish: string | null;
      quantity: number;
      supplier: string;
      catalogId: string | null;
    }[];
  },
  marcas: Map<string, string | null>,
) {
  return {
    itemNumber: i.itemNumber,
    name: i.name,
    descriptionGeneral: i.descriptionGeneral,
    quantity: i.quantity,
    clientPriceIva: i.clientPriceIva,
    details: i.details.map((d) => ({ name: d.name, material: d.material })),
    herrajes: i.herrajes.map((h) => ({
      sector: h.sector,
      name: h.name,
      measure: h.measure,
      finish: h.finish,
      quantity: h.quantity,
      brand: marcaParaCliente(
        h.catalogId ? marcas.get(h.catalogId) : null,
        h.supplier,
      ),
    })),
  };
}

// catalogId → brand para todas las líneas de herraje de la versión, en una
// sola consulta.
async function marcasDeHerrajes(
  chapters: { items: { herrajes: { catalogId: string | null }[] }[] }[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(
    new Set(
      chapters
        .flatMap((c) => c.items)
        .flatMap((i) => i.herrajes)
        .map((h) => h.catalogId)
        .filter((id): id is string => !!id),
    ),
  );
  if (ids.length === 0) return new Map();
  const rows = await prisma.herrajeCatalog.findMany({
    where: { id: { in: ids } },
    select: { id: true, brand: true },
  });
  return new Map(rows.map((r) => [r.id, r.brand]));
}

// Forzar Node runtime (no edge) — Puppeteer/Chromium necesita Node.
export const runtime = "nodejs";
// La generación de PDF con Chromium headless puede tomar 10-30s. Default
// Vercel free tier es 10s, Pro 60s — subimos al máximo permitido.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    // tipo=mueblista → listado de herrajes por sector SIN precios (Fase 3).
    // tipo=orden-compra → orden de compra de artefactos SIN precios, una por
    // subcategoría (?sub=cocina|sanitario|iluminacion), para el proveedor.
    const tipo = request.nextUrl.searchParams.get("tipo");
    const sub = request.nextUrl.searchParams.get("sub");

    const budget = await prisma.budgetVersion.findUnique({
      where: { id },
      include: {
        project: true,
        obraChapters: { orderBy: { sortOrder: "asc" } },
        obraItems: { orderBy: { sortOrder: "asc" } },
        muebleChapters: {
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
              include: {
                details: { orderBy: { sortOrder: "asc" } },
                herrajes: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
        artefactoItems: { orderBy: { sortOrder: "asc" } },
        paymentTerms: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!budget) {
      return NextResponse.json(
        { error: "Presupuesto no encontrado" },
        { status: 404 }
      );
    }

    let html: string;
    // En obra ya no hay footer (match al template Excel). En muebles y
    // artefactos sí se mantiene blarq.cl + versión a pie de página.
    let footer: string = "";
    let filename: string;
    const baseName = budget.project.name.replace(/\s+/g, "_");

    // Condiciones ("Observaciones generales") del PDF: salen de la versión.
    // Null = versión anterior al cambio, que nunca tuvo condiciones propias:
    // ahí cae a la plantilla del tipo, que es exactamente el texto fijo que
    // esas cotizaciones venían imprimiendo. Lista vacía es otra cosa (MJ las
    // borró a propósito) y se respeta: el PDF sale sin el bloque.
    const condiciones =
      parseCondiciones(budget.conditions) ??
      (esTipoCondiciones(budget.type)
        ? await getPlantillaCondiciones(budget.type)
        : []);

    if (budget.type === "obra") {
      // Marca de cambio por partida contra la última versión enviada al
      // cliente. Si no hay versión base (ej. V1), markers quedan todos null
      // y no se pinta nada. Ver src/lib/presupuesto/versionDiff.ts.
      const baseline = await getObraBaselineItems(budget);
      const markers = computeChangeMarkers(budget.obraItems, baseline);
      html = renderObraHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          ggPercentage: budget.ggPercentage,
          utilityPercentage: budget.utilityPercentage,
          conditions: condiciones,
          coverTitle: budget.coverTitle,
          coverSubtitle: budget.coverSubtitle,
          coverNote: budget.coverNote,
        },
        chapters: budget.obraChapters,
        // Las partidas "NO COBRADO" (BLARQ las absorbe) son invisibles para el
        // cliente: no van en el PDF ni suman al total. El costo directo y el
        // total de la cotización se calculan sobre estos items filtrados.
        items: budget.obraItems
          .filter((it) => !it.noCobrado)
          .map((it) => ({
            ...it,
            changeMarker: markers.get(it.lineageId)?.marker ?? null,
          })),
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      filename = `BLARQ_Obra_${baseName}_${budget.version}.pdf`;
    } else if (budget.type === "muebles" && tipo === "mueblista") {
      // Listado para el mueblista: herrajes por sector, sin precios. Aplana las
      // líneas de herraje de todas las partidas de cada capítulo.
      html = renderMueblistaHTML({
        project: budget.project,
        budget: { version: budget.version, date: budget.date },
        chapters: budget.muebleChapters.map((ch) => ({
          name: ch.name,
          // Solo las partidas base: los herrajes de una alternativa para el
          // cliente todavía no son un pedido para el mueblista.
          herrajes: soloPrincipales(ch.items).flatMap((i) =>
            i.herrajes.map((h) => ({
              sector: h.sector,
              name: h.name,
              measure: h.measure,
              finish: h.finish,
              supplier: h.supplier,
              quantity: h.quantity,
            })),
          ),
        })),
      });
      filename = `BLARQ_Herrajes_Mueblista_${baseName}_${budget.version}.pdf`;
    } else if (budget.type === "muebles") {
      const marcas = await marcasDeHerrajes(budget.muebleChapters);
      html = renderMueblesHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          conditions: condiciones,
          coverTitle: budget.coverTitle,
          coverSubtitle: budget.coverSubtitle,
          coverNote: budget.coverNote,
        },
        // Las partidas base van numeradas y suman; las alternativas para el
        // cliente (pendiente 177) viajan colgadas de su base en `alternativas`
        // y el PDF las dibuja debajo con la diferencia, fuera de los totales.
        chapters: budget.muebleChapters.map((ch) => ({
          chapterNumber: ch.chapterNumber,
          name: ch.name,
          items: agruparConAlternativas(ch.items).map(({ base, alternativas }) => ({
            ...muebleItemParaPDF(base, marcas),
            alternativas: alternativas.map((a) => muebleItemParaPDF(a, marcas)),
          })),
        })),
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      filename = `BLARQ_Muebles_${baseName}_${budget.version}.pdf`;
    } else if (budget.type === "artefactos" && tipo === "orden-compra") {
      // Orden de compra para el proveedor: los mismos productos de la
      // cotización pero SIN precios, filtrados a UNA subcategoría (cada una se
      // le compra a una empresa distinta: cocina → Kitchen House, baño → MK).
      const subKey = sub ?? "";
      if (!["sanitario", "cocina", "iluminacion"].includes(subKey)) {
        return NextResponse.json(
          { error: "Subcategoría inválida. Usar sub=sanitario|cocina|iluminacion" },
          { status: 400 }
        );
      }
      html = renderOrdenCompraArtefactosHTML({
        project: budget.project,
        budget: { version: budget.version, date: budget.date },
        subcategory: subKey,
        // Los items ya vienen ordenados por sortOrder (el orden que MJ arrastró
        // en el editor). La subcategoría vacía cuenta como "sanitario", igual
        // que en el editor y en el PDF al cliente.
        items: budget.artefactoItems.filter(
          (it) => (it.subcategory || "sanitario") === subKey
        ),
      });
      filename = ordenCompraFilename(subKey, budget.project.name, budget.version);
    } else {
      html = renderArtefactosHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          conditions: condiciones,
          coverTitle: budget.coverTitle,
          coverSubtitle: budget.coverSubtitle,
          coverNote: budget.coverNote,
        },
        items: budget.artefactoItems,
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      footer = buildArtefactosFooter();
      filename = `BLARQ_Artefactos_${baseName}_${budget.version}.pdf`;
    }

    // Obra, muebles y artefactos usan la nueva línea editorial: sin footer +
    // márgenes 10mm/12mm.
    const useNewFormat =
      budget.type === "obra" ||
      budget.type === "muebles" ||
      budget.type === "artefactos";
    // Obra usa el diseño de marca v2 (Manual Claro). Márgenes verticales 14mm
    // en TODAS las páginas (para que la tabla, que fluye entre páginas, no se
    // corte contra el borde) y laterales 0 — el aire lateral lo pone el padding
    // de la plantilla. La portada calcula su alto contra estos 14mm+14mm.
    // Muebles/artefactos siguen con el formato previo hasta migrar.
    // El PDF mueblista (herrajes por sector, sin precios) sigue con el formato
    // previo; el de muebles al cliente ya usa la marca v2 como obra.
    // La orden de compra al proveedor es un documento corrido (sin portada) y
    // no define @page en su CSS: los márgenes se los tiene que poner la opción
    // `margin` de Puppeteer, no el CSS. Por eso queda FUERA de isBrandObra.
    const isBrandObra =
      budget.type === "obra" ||
      (budget.type === "artefactos" && tipo !== "orden-compra") ||
      (budget.type === "muebles" && tipo !== "mueblista");
    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      // La orden de compra sale en UNA SOLA HOJA de alto variable: se lee en
      // pantalla y ahí partirla en páginas solo estorba (decisión de MJ). El
      // ancho sigue siendo A4 por si alguna vez se imprime.
      singlePage: budget.type === "artefactos" && tipo === "orden-compra",
      displayHeaderFooter: !useNewFormat,
      headerTemplate: useNewFormat ? undefined : "<div></div>",
      footerTemplate: useNewFormat ? undefined : footer,
      // Marca v2: los márgenes los controla el CSS @page (portada full-bleed +
      // detalle con 14mm). El resto usa la opción margin clásica.
      ...(isBrandObra
        ? { preferCSSPageSize: true }
        : {
            margin: useNewFormat
              ? { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" }
              : { top: "14mm", bottom: "16mm", left: "15mm", right: "15mm" },
          }),
    });

    const body = new Uint8Array(pdfBuffer.byteLength);
    body.set(pdfBuffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    // Devolver el mensaje real del error para poder diagnosticar — vivo
    // en prod por ahora hasta que el PDF esté estable. Después se puede
    // ocultar de nuevo si MJ quiere.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { error: "Error al generar PDF", detail: message, stack },
      { status: 500 }
    );
  }
}
