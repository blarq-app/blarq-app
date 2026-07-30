/**
 * Nombre visible del ambiente de un artefacto (baño, cocina, lavadero…).
 *
 * EL PROBLEMA QUE RESUELVE (2026-07-30): el ambiente se guarda como TEXTO
 * LIBRE. Además de las seis claves históricas de acá abajo, MJ crea ambientes
 * propios desde "+ Nuevo ambiente" y quedan guardados tal cual los escribió,
 * con guiones bajos: `baño_2`, `baño_3_servicio`, `logia`, `baño_principal_1`.
 *
 * Hasta ahora cada pantalla y cada PDF tenía su propia copia del mapa de
 * abajo y hacía `MAPA[room] ?? room`, así que cualquier ambiente que no
 * estuviera en la lista salía CRUDO a la vista: "BAÑO_PRINCIPAL_1" en la
 * tabla del editor y, peor, "Total artefactos baño_principal_1" en el PDF que
 * se le manda al cliente. Encima el mapa tiene las claves escritas SIN ñ
 * (`bano_principal`) y los datos reales sí la tienen (`baño_principal`), así
 * que ni siquiera acertaba en los casos que supuestamente cubría.
 *
 * La regla ahora: si la clave está en el mapa, se usa esa etiqueta; si no,
 * se muestra el texto libre legible (guiones bajos → espacios, primera letra
 * en mayúscula). Es SOLO presentación — no se toca el valor guardado, que
 * sigue siendo la clave y es lo que usan el orden, los filtros y el agrupado.
 */

// Claves históricas, de cuando el ambiente era una lista cerrada. Se quedan
// porque hay cotizaciones viejas guardadas con la versión sin ñ.
export const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

// Orden de los ambientes conocidos. Los inventados por MJ no están acá y
// caen al final, ordenados como ya venían (ver ArtefactosEditor).
export const ROOM_ORDER = [
  "bano_principal",
  "bano_secundario",
  "bano_visita",
  "cocina",
  "lavadero",
  "otro",
];

export function roomLabel(room: string): string {
  const conocido = ROOM_LABELS[room];
  if (conocido) return conocido;
  const limpio = room.replace(/_/g, " ").trim();
  if (!limpio) return room;
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}
