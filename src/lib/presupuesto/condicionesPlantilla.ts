/**
 * Lectura/escritura de la PLANTILLA de condiciones (server-only).
 *
 * Va aparte de `condiciones.ts` porque toca prisma: el editor del navegador
 * importa los tipos y el parser de allá, pero la plantilla la pide por API.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CONDICIONES_SEMILLA,
  parseCondiciones,
  type Condicion,
  type TipoCondiciones,
} from "@/lib/presupuesto/condiciones";

/**
 * Prisma tipa las columnas Json como objeto-o-primitivo y no acepta un array
 * tipado directo. La lista ya viene validada por parseCondiciones.
 */
function aJson(items: Condicion[]): Prisma.InputJsonValue {
  return items as unknown as Prisma.InputJsonValue;
}

/**
 * Devuelve la plantilla del tipo. La primera vez que se pide, la siembra en
 * la base con el texto histórico del PDF — así queda editable desde la app y
 * nadie tiene que tocar código para cambiar una condición.
 */
export async function getPlantillaCondiciones(
  type: TipoCondiciones
): Promise<Condicion[]> {
  const fila = await prisma.conditionTemplate.findUnique({ where: { type } });
  const guardadas = fila ? parseCondiciones(fila.items) : null;
  if (guardadas) return guardadas;

  const semilla = CONDICIONES_SEMILLA[type];
  await prisma.conditionTemplate.upsert({
    where: { type },
    create: { type, items: aJson(semilla) },
    update: { items: aJson(semilla) },
  });
  return semilla;
}

export async function setPlantillaCondiciones(
  type: TipoCondiciones,
  items: Condicion[]
): Promise<Condicion[]> {
  await prisma.conditionTemplate.upsert({
    where: { type },
    create: { type, items: aJson(items) },
    update: { items: aJson(items) },
  });
  return items;
}

/**
 * Agrega UNA condición al final de la plantilla, sin tocar las demás. Es lo
 * que hace el tilde "dejarla también para las próximas cotizaciones" cuando
 * MJ agrega una condición dentro de una cotización. Si ya existe una con el
 * mismo texto, no la duplica.
 */
export async function agregarCondicionAPlantilla(
  type: TipoCondiciones,
  condicion: Condicion
): Promise<Condicion[]> {
  const actuales = await getPlantillaCondiciones(type);
  const yaEsta = actuales.some(
    (c) => c.text.trim().toLowerCase() === condicion.text.trim().toLowerCase()
  );
  if (yaEsta) return actuales;
  return setPlantillaCondiciones(type, [...actuales, condicion]);
}
