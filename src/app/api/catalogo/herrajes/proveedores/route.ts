import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { proveedoresDe } from "@/lib/presupuesto/herrajeProveedores";

/**
 * GET /api/catalogo/herrajes/proveedores
 *   Las pestañas de proveedor de herrajes: los fijos (DPH, HBT) más cualquier
 *   otro que exista en el catálogo, en ese orden. Lo usa la ventana "Agregar
 *   del catálogo" de la partida de herrajes; la pantalla del catálogo lo
 *   deriva de los items que ya tiene cargados.
 */
export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const filas = await prisma.herrajeCatalog.groupBy({ by: ["supplier"] });
  return NextResponse.json(proveedoresDe(filas));
}
