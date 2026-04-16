import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import EstadoPagoPDF from "@/lib/pdf/EstadoPagoPDF";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const variant =
      url.searchParams.get("variant") === "interno" ? "interno" : "maestro";

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: {
        project: { include: { maestro: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!ep) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const prevEps = await prisma.estadoPago.findMany({
      where: { projectId: ep.projectId, number: { lt: ep.number } },
      include: { items: true },
    });
    const prevPaidAccum: Record<string, number> = {};
    prevEps.forEach((p) =>
      p.items.forEach((i) => {
        prevPaidAccum[i.obraItemId] = Math.max(
          prevPaidAccum[i.obraItemId] || 0,
          i.pctAccumulated
        );
      })
    );

    const pdf = (
      <EstadoPagoPDF
        project={ep.project}
        ep={{ number: ep.number, date: ep.date, notes: ep.notes }}
        items={ep.items}
        prevPaidAccum={prevPaidAccum}
        variant={variant}
      />
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(pdf as any);

    const filename = `BLARQ_EP${ep.number}_${ep.project.name.replace(
      /\s+/g,
      "_"
    )}_${variant}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generando PDF EP:", error);
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    );
  }
}
