# ADR — Descripción dual cliente / maestro por partida

- **Fecha**: 2026-04-26
- **Estado**: aceptado (schema), parcialmente aplicado (poblado del catálogo pendiente).
- **Autor**: MJ.

## Contexto

Una partida del presupuesto Obra (ej: "1.3 RETIRO PISO CERAMICO") se imprime en dos documentos completamente distintos:

1. **PDF presupuesto al cliente** (`ObraPDF`): el cliente quiere saber qué se hace, en términos de alcance y resultado. "Se retira el cerámico existente del baño principal y se prepara la base para el nuevo revestimiento."
2. **PDF estado de pago al maestro** (`EstadoPagoPDF`): el maestro quiere saber **cómo** ejecutar y a qué prestar atención. "Retiro a piqueta, cuidando bajada de agua. Limpieza de adhesivo previo. Verificar nivel."

Cuando el campo era único (`description`), el resultado era:

- Si la descripción se escribía para el cliente, el maestro recibía algo demasiado vago.
- Si se escribía para el maestro, el cliente recibía detalles innecesarios o jerga incomprensible.

MJ decidió que cada partida debe poder tener **dos descripciones independientes**.

## Decisión

Modelo:

```prisma
model PartidaCatalog {
  description         String?  // descriptionCliente (para PDFs al cliente)
  descriptionMaestro  String?  // para PDFs al maestro y editor de EP
  // ...
}

model ObraItem {
  description         String?
  descriptionMaestro  String?
  // ...
}

model EstadoPagoItem {
  descriptionMaestro  String?  // snapshot independiente al crear el EP
  // ...
}
```

- `description` (en código a veces aliased como `descriptionCliente`) → PDF cliente.
- `descriptionMaestro` → PDF EP + editor de EP.
- Las descripciones se **independizan** al crear un EP: si el catálogo cambia después, el EP no se ve afectado salvo que el usuario apruebe el cambio vía sync.

## Alternativas descartadas

- **Un solo campo** con un toggle "modo cliente / modo maestro" en el render. Rechazado: frágil, no permite que un mismo PDF tenga partidas con texto distinto según sea al cliente vs al maestro.
- **Plantillas tipo Mustache** que rinden distinto según contexto. Rechazado: complejidad alta para una necesidad simple.
- **Solo descripción cliente, el maestro se entera por boca**. Rechazado: MJ quiere que el PDF EP sea autosuficiente (cuadrillas remotas, problemas de comunicación verbal).

## Consecuencias

**Positivas**:
- Cada lector recibe el texto pensado para él. PDFs significativamente más útiles.
- El maestro puede ver instrucciones técnicas sin que el cliente las lea.
- El editor de EP (`EditorEP.tsx`) ya muestra ambas descripciones — operativo.

**Costos / contras**:
- **Estado actual de poblado** (verificado 2026-04-26): `PartidaCatalog` tiene 206 partidas, **34 con `description`** (cliente) y **0 con `descriptionMaestro`**. El campo está en schema pero el backfill nunca se hizo.
- Mientras el catálogo no se pueble, los EPs nuevos arrancan con `descriptionMaestro = null`. Hoy MJ los completa caso a caso al editar el EP.
- Cualquier import de presupuesto desde Excel debe mapear ambas descripciones por separado o aceptar que `descriptionMaestro` queda vacío.

**Deuda generada**: backfill del catálogo de 206 partidas con sus descripciones de maestro. Pendiente de prioridad explícita.

## Referencias

- Schema: `PartidaCatalog`, `ObraItem`, `EstadoPagoItem` en `prisma/schema.prisma`.
- Editor: `src/components/ep/EditorEP.tsx`.
- PDFs: `src/lib/pdf/EstadoPagoPDF.html.ts` (usa `descriptionMaestro`).
- Memoria del estado de poblado: ver historia git de `prisma/schema.prisma` y commits ~2026-04-26.
