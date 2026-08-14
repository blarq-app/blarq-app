// Separa lo que MJ escribe al mandar el comprobante de un traspaso:
// "Sena obra" → obra "Sena", concepto "obra".
//
// Por qué el concepto se saca del texto ANTES de buscar la obra: el matcher de
// proyectos cuenta cuántas palabras del nombre de la obra aparecen en el texto
// (ver matchProjectCategory.ts). Si dejáramos "obra" adentro, cualquier
// proyecto que tuviera esa palabra en el nombre sumaría un punto de gratis y
// podría ganarle a la obra correcta.

import type { ConceptoTraspaso } from "@/lib/banco/internalTransferTags";

/** minúsculas, sin tildes, solo letras — para comparar palabra a palabra. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

export interface TextoTraspaso {
  concepto: ConceptoTraspaso | null;
  // true cuando el texto menciona los DOS conceptos. Un traspaso es de uno o
  // del otro —un movimiento no se parte por la mitad—, así que el bot lo dice
  // en vez de elegir uno.
  ambos: boolean;
  // El texto sin las palabras de concepto: lo que se matchea contra las obras.
  resto: string;
}

export function parseTraspasoTexto(texto: string): TextoTraspaso {
  const palabras = texto.split(/\s+/).filter(Boolean);
  let obra = false;
  let muebles = false;
  const resto: string[] = [];

  for (const p of palabras) {
    const n = norm(p);
    if (n === "obra" || n === "obras") {
      obra = true;
      continue;
    }
    if (n === "mueble" || n === "muebles") {
      muebles = true;
      continue;
    }
    resto.push(p);
  }

  if (obra && muebles) {
    return { concepto: null, ambos: true, resto: resto.join(" ") };
  }
  return {
    concepto: obra ? "obra" : muebles ? "muebles" : null,
    ambos: false,
    resto: resto.join(" "),
  };
}
