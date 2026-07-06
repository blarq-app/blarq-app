import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { fetchIndicadoresMes } from "@/lib/contabilidad/indicadores";

// Topes por default cuando se crea el primer mes y no hay ninguno previo del
// que arrastrar. Salen de mayo 2026 (validado). Cambian ~1 vez al año.
const TOPE_GRATIFICACION_DEFAULT = 213354;
const TOPE_SALUD_UF_DEFAULT = 90;

// "Asegura" el indicador de un mes: si no existe, trae UF/UTM automáticamente
// de mindicador.cl y arrastra los dos topes del último mes conocido (o los
// defaults). Si ya existe, lo devuelve tal cual (salvo refetch=true, que vuelve
// a traer UF/UTM de internet sin tocar los topes).
//
// Body: { year, month, refetch?: boolean }
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  const year = Number(data.year);
  const month = Number(data.month);
  const refetch = Boolean(data.refetch);
  if (!year || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
  }

  const existente = await prisma.indicadorMensual.findUnique({
    where: { year_month: { year, month } },
  });

  if (existente && !refetch) {
    return NextResponse.json(existente);
  }

  // Traer UF/UTM de internet.
  let uf: number, utm: number;
  try {
    const fetched = await fetchIndicadoresMes(year, month);
    uf = fetched.uf;
    utm = fetched.utm;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo traer UF/UTM";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (existente) {
    // refetch: solo refrescamos UF/UTM, conservamos los topes editados.
    const updated = await prisma.indicadorMensual.update({
      where: { id: existente.id },
      data: { uf, utm },
    });
    return NextResponse.json(updated);
  }

  // Mes nuevo: arrastramos los topes del último indicador conocido.
  const ultimo = await prisma.indicadorMensual.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const created = await prisma.indicadorMensual.create({
    data: {
      year,
      month,
      uf,
      utm,
      gratificacionTopeMensual:
        ultimo?.gratificacionTopeMensual ?? TOPE_GRATIFICACION_DEFAULT,
      topeImponibleSaludUF: ultimo?.topeImponibleSaludUF ?? TOPE_SALUD_UF_DEFAULT,
    },
  });
  return NextResponse.json(created);
}
