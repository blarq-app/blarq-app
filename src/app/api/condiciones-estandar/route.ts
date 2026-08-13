/**
 * Plantilla de condiciones por tipo de cotización.
 *
 * GET  → { obra: [...], muebles: [...], artefactos: [...] }
 * GET  ?tipo=obra → { items: [...] }
 * PUT  { tipo, items }      → reemplaza la lista completa (pantalla de Configuración)
 * POST { tipo, condicion }  → agrega UNA al final (tilde "dejarla para las próximas")
 *
 * Nada de esto toca cotizaciones ya creadas: solo cambia con qué texto
 * arrancan las nuevas.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import {
  esTipoCondiciones,
  parseCondiciones,
  TIPOS_CONDICIONES,
} from "@/lib/presupuesto/condiciones";
import {
  agregarCondicionAPlantilla,
  getPlantillaCondiciones,
  setPlantillaCondiciones,
} from "@/lib/presupuesto/condicionesPlantilla";

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const tipo = request.nextUrl.searchParams.get("tipo");
  if (tipo) {
    if (!esTipoCondiciones(tipo)) {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }
    return NextResponse.json({ items: await getPlantillaCondiciones(tipo) });
  }

  const entradas = await Promise.all(
    TIPOS_CONDICIONES.map(
      async (t) => [t, await getPlantillaCondiciones(t)] as const
    )
  );
  return NextResponse.json(Object.fromEntries(entradas));
}

export async function PUT(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  if (!esTipoCondiciones(data.tipo)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  const items = parseCondiciones(data.items);
  if (!items) {
    return NextResponse.json(
      { error: "items debe ser una lista" },
      { status: 400 }
    );
  }
  return NextResponse.json({ items: await setPlantillaCondiciones(data.tipo, items) });
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  if (!esTipoCondiciones(data.tipo)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  const [condicion] = parseCondiciones([data.condicion]) ?? [];
  if (!condicion) {
    return NextResponse.json(
      { error: "La condición no puede estar vacía" },
      { status: 400 }
    );
  }
  return NextResponse.json({
    items: await agregarCondicionAPlantilla(data.tipo, condicion),
  });
}
