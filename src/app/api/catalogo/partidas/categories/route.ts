import { prisma } from "@/lib/prisma";
import { compareCatalogCategories } from "@/lib/utils";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const categories = await prisma.partidaCatalog.findMany({
      select: { category: true },
      distinct: ["category"],
    });

    const sorted = categories
      .map((c) => c.category)
      .sort(compareCatalogCategories);

    return NextResponse.json(sorted);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "Error al obtener categorías" },
      { status: 500 }
    );
  }
}
