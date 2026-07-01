import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderObraHTML } from "@/lib/pdf/ObraPDF.html";
import { renderMueblesHTML } from "@/lib/pdf/MueblesPDF.html";
import { renderMueblistaHTML } from "@/lib/pdf/MueblistaPDF.html";
import {
  renderArtefactosHTML,
  buildArtefactosFooter,
} from "@/lib/pdf/ArtefactosPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";
import {
  getObraBaselineItems,
  computeChangeMarkers,
} from "@/lib/presupuesto/versionDiff";
import { requireSession } from "@/lib/apiAuth";

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
    const tipo = request.nextUrl.searchParams.get("tipo");

    const budget = await prisma.budgetVersion.findUnique({
      where: { id },
      include: {
        project: true,
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
        },
        items: budget.obraItems.map((it) => ({
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
          herrajes: ch.items.flatMap((i) =>
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
      html = renderMueblesHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          observations: budget.observations,
        },
        chapters: budget.muebleChapters.map((ch) => ({
          chapterNumber: ch.chapterNumber,
          name: ch.name,
          items: ch.items.map((i) => ({
            itemNumber: i.itemNumber,
            name: i.name,
            descriptionGeneral: i.descriptionGeneral,
            quantity: i.quantity,
            clientPriceIva: i.clientPriceIva,
            details: i.details.map((d) => ({
              name: d.name,
              material: d.material,
            })),
            herrajes: i.herrajes.map((h) => ({
              sector: h.sector,
              name: h.name,
              measure: h.measure,
              finish: h.finish,
              quantity: h.quantity,
            })),
          })),
        })),
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      filename = `BLARQ_Muebles_${baseName}_${budget.version}.pdf`;
    } else {
      html = renderArtefactosHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          observations: budget.observations,
        },
        items: budget.artefactoItems,
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      footer = buildArtefactosFooter(budget.version, budget.date);
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
    const isBrandObra =
      budget.type === "obra" ||
      (budget.type === "muebles" && tipo !== "mueblista");
    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: !useNewFormat,
      headerTemplate: useNewFormat ? undefined : "<div></div>",
      footerTemplate: useNewFormat ? undefined : footer,
      margin: isBrandObra
        ? { top: "14mm", bottom: "14mm", left: "0", right: "0" }
        : useNewFormat
          ? { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" }
          : { top: "14mm", bottom: "16mm", left: "15mm", right: "15mm" },
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
