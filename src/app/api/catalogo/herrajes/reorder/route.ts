import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Reordenar herrajes dentro de un (proveedor, categoría).
// Body: { items: [{ id: string, sortOrder: number }] }
export async function PATCH(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { items } = (await request.json()) as {
      items: { id: string; sortOrder: number }[];
    };
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "items debe ser un array" },
        { status: 400 },
      );
    }

    await prisma.$transaction(
      items.map((it) =>
        prisma.herrajeCatalog.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        }),
      ),
    );

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (error) {
    console.error("Error reordering herrajes:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
