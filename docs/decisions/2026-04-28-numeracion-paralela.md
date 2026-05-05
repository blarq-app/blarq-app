# ADR — Numeración paralela cotización ↔ proyecto

- **Fecha**: 2026-04-28
- **Estado**: aceptado
- **Autor**: MJ (decisión de negocio), implementado en commit `9265bac`.

## Contexto

BLARQ trabaja con dos contadores que existen históricamente en el estudio:

1. **Cotizaciones** — todo lead que entra al embudo recibe un número (167, 168, 169...). Muchas no se aprueban.
2. **Proyectos** — solo los que efectivamente se ejecutan reciben número de proyecto (60, 61, 62...).

MJ y JT recuerdan los proyectos por su número. Es la **memoria espacial** del estudio: "El 60 es Portofino, el 61 es Lefevre". El número es identidad, no metadato.

Antes de esta decisión la app modelaba un único `Project` con un solo número, lo que obligaba a elegir: ¿el número se asigna al cotizar, o al aprobar? Cualquier opción tenía costos:

- Asignarlo al cotizar → en estadísticas de proyectos ejecutados aparecen "huecos" (cotizaciones rechazadas) confusos.
- Asignarlo al aprobar → no se puede referenciar una cotización por número antes de aprobar.

## Decisión

Cada `Project` tiene **dos campos correlativos paralelos**:

```prisma
numeroCotizacion Int?  @unique
numeroProyecto   Int?  @unique
isInternal       Boolean @default(false)
```

- `numeroCotizacion` se asigna **al crear** el Project (todo lead lo recibe).
- `numeroProyecto` se asigna **al pasar a estado `ejecucion`**.
- Una cotización rechazada queda con `numeroCotizacion` asignado y `numeroProyecto = null`.
- Un proyecto interno (BLARQ como entidad, autos, gastos generales) tiene **ambos en `null`** y se distingue con `isInternal = true`.
- Ambos contadores son **monotónicos** y **nunca se reusan**.

Consecuencia en UI: `/cotizaciones` filtra por `status='cotizacion'` y muestra `numeroCotizacion`. `/proyectos` filtra por `status='ejecucion'|'terminado'` y muestra `numeroProyecto`. El detalle del proyecto muestra ambos cuando ambos existen.

## Alternativas descartadas

- **Un solo número correlativo** (asignado al cotizar). Genera huecos visibles en listados de proyectos ejecutados ("¿qué pasó con el 161, 162, 165?"). Confunde a JT.
- **Un solo número, asignado al aprobar.** Imposibilidad de referenciar por número durante el proceso comercial — y MJ ya nombra cotizaciones por número en WhatsApp y mails.
- **Número compuesto** (`COT-167` → `PROJ-60` con conversión). Implica un mapeo manual ambiguo y rompe la simplicidad del integer.

## Consecuencias

**Positivas**:
- La memoria espacial del estudio se preserva tal cual.
- Estadísticas por embudo (cotizaciones recibidas, % aprobado) son triviales: contar `numeroCotizacion IS NOT NULL` vs `numeroProyecto IS NOT NULL`.
- El estado del proyecto puede leerse del par `(numeroCotizacion, numeroProyecto, status)`.

**Costos / contras**:
- Una cotización con varias rondas de re-cotización requiere decisión: ¿reusa número o se asigna nuevo? Hoy: nuevo número en cada re-cotización formal (cuando el cliente pide cambios materiales tras una pausa larga).
- Endpoint `PATCH /api/proyectos/[id]` tuvo que validar unicidad de `numeroProyecto` antes del update para evitar 500s feos. Resuelto.

**Deuda generada**: si en el futuro hay que migrar a un sistema externo, la doble numeración requiere convención de mapeo. Hoy no es problema.

## Referencias

- Commit principal: `9265bac` (28-abr-2026) — refactor + UI cotizaciones/proyectos separadas.
- Historia documentada: [REVIEW_autorevision_2026-04-29.md](../REVIEW_autorevision_2026-04-29.md).
- Schema: `prisma/schema.prisma` — modelo `Project`, comentarios in-line.
