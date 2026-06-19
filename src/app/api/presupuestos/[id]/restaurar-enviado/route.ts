/**
 * "Volver a lo enviado": restaura la versión a su foto (sentSnapshot).
 * Úsalo cuando, tras editar a mano una versión enviada, MJ quiere deshacer
 * y dejarla EXACTAMENTE como se mandó al cliente. Soportado: obra y artefactos.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  restoreObraFromSnapshot,
  restoreArtefactosFromSnapshot,
} from "@/lib/catalog/budgetSnapshot";
import { requireSession } from "@/lib/apiAuth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const bv = await prisma.budgetVersion.findUnique({
      where: { id },
      select: { sentSnapshot: true, type: true },
    });
    if (!bv) return NextResponse.json({ error: "Versión no encontrada" }, { status: 404 });
    if (!bv.sentSnapshot) {
      return NextResponse.json(
        { error: "Esta versión no tiene foto guardada (nunca se envió)" },
        { status: 400 }
      );
    }
    if (bv.type !== "obra" && bv.type !== "artefactos") {
      return NextResponse.json(
        { error: "Volver a lo enviado está implementado para obra y artefactos" },
        { status: 400 }
      );
    }
    const res =
      bv.type === "obra"
        ? await restoreObraFromSnapshot(id)
        : await restoreArtefactosFromSnapshot(id);
    return NextResponse.json({ ok: true, ...res });
  } catch (error) {
    console.error("Error restaurando a lo enviado:", error);
    return NextResponse.json({ error: "Error al restaurar" }, { status: 500 });
  }
}
