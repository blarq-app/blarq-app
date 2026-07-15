---
name: costo-artefactos
description: >-
  Carga a mano el costo real que un proveedor (MK, Kitchen House, u otro) le cobra
  a BLARQ por cada artefacto de una cotización, y lo compara contra el precio que
  BLARQ le cobró al cliente para ver el margen por ítem y total. Usá esta skill
  siempre que MJ diga cosas como "llegó la cotización de MK", "cargá los costos de
  los artefactos", "cuánto me está ganando este proyecto en artefactos", "costo vs
  venta de los artefactos", o cuando pegue/adjunte una cotización de proveedor y
  quiera ver la ganancia. Escribe el campo realCostBlarq de cada ArtefactoItem en
  la base viva, siempre con dry-run y OK de MJ antes de escribir.
---

# Costo real de artefactos (costo proveedor vs precio cliente)

## Qué resuelve

Cada artefacto de una cotización (`ArtefactoItem`) tiene dos números:
- **`clientPrice`** — lo que BLARQ le cobra al cliente, **unitario y CON IVA** (es
  `listPrice × (1 − descuento)`).
- **`realCostBlarq`** — lo que BLARQ le paga al proveedor, unitario. Es el campo que
  esta skill carga. Editable también en la UI (columna "costo BLARQ" del editor de
  artefactos) prendiendo "Mostrar columnas internas".

Con los dos, el margen por ítem = precio cliente − costo. MJ hace esto seguido
(cada vez que un proveedor le manda una cotización nueva), por eso está la skill.

## El flujo (repetible)

### 1. Reunir el input
Necesitás tres cosas de MJ:
- **La cotización del proveedor** — PDF o las líneas pegadas con precios. NO la
  tenés; la aporta MJ. Si es PDF, extraé las líneas (patrón de
  `scripts/diag-dump-pdf.ts`: inflar el stream, cortar en "MONTO NETO", el valor de
  cada línea es la cifra antes del próximo código). Necesitás por línea: nombre/
  modelo/marca y el **costo NETO unitario** (sin IVA).
- **El proyecto** (ej. "Paseo del Sena").
- **La versión de artefactos** a cargar. NO la asumas — confirmala (paso 2).

### 2. Confirmar la versión vigente
Corré, desde la raíz del repo:
```
npx tsx .claude/skills/costo-artefactos/scripts/listar-items.ts "Paseo del Sena"
```
Imprime todas las versiones de artefactos y marca la **VIGENTE** (la que
`metrics.ts` lee para el resultado y las alertas). La regla de "vigente" está en
`src/lib/projects/selectVersion.ts`: gana la más reciente **enviada o aprobada**;
un **borrador nunca gana**. Consecuencia importante que hay que decirle a MJ:

> Si cargás el costo en una versión **borrador**, NO cambia el resultado ni las
> alertas del proyecto hasta que esa versión pase a enviada/aprobada.

Si la versión donde MJ quiere cargar no es la vigente, decíselo y confirmá con ella
cuál quiere (la vigente, que impacta hoy; o el borrador que está armando).

### 3. Volcar los ítems y emparejar
Con la versión elegida:
```
npx tsx .claude/skills/costo-artefactos/scripts/listar-items.ts "Paseo del Sena" V2
```
Da `itemId`, nombre, marca, modelo, cantidad, precio cliente, costo actual y
`catalogId` de cada ítem. Emparejá **cada línea de la cotización** con su ítem por
nombre / marca / modelo / `catalogId`. El emparejamiento es a criterio (los nombres
vienen sucios) — no lo automatices a ciegas. Mostrá siempre a MJ:
- los que emparejaste con confianza,
- **los que NO matchean** (línea de la cotización sin ítem, o ítem sin línea) para
  resolver a mano.

### 4. Decidir la base de IVA — importa, no la saltees
`realCostBlarq` puede guardarse de dos formas y **cambia todos los números**:
- **`net` (SIN IVA)** — correcto para `metrics.ts`: ahí el costo se compara contra
  `clientPrice/1,19` y contra el gasto real de facturas, que va en **neto**
  (`netAmount`, el IVA se recupera como crédito). Guardar neto deja las **alertas
  de desviación** (Cocina/Baño/Iluminación) coherentes.
- **`gross` (CON IVA, neto×1,19)** — es lo que se hizo en JNC (2026-06-19, aprobado
  por MJ). Hace que la **ganancia que muestra la UI del editor** sea honesta, porque
  ahí la resta es `clientPrice(c/IVA) − realCostBlarq` sin dividir.

Las dos vistas no coinciden porque cada consumidor asume una base distinta —
tensión real del código, no la tapes. **Explicásela a MJ en una línea y que elija.**
Recomendación por defecto: preguntar qué mira más — si la columna de ganancia del
editor, `gross`; si le importa que las alertas de presupuesto no se inflen, `net`.
El reporte del paso 5 muestra el margen en **neto** en ambos casos, así que el
número de margen que ve MJ es el mismo; la base solo cambia lo que queda guardado.

### 5. Dry-run: tabla costo vs venta vs margen
Armá un JSON de emparejamiento (ver formato abajo) y corré SIN `--apply`:
```
npx tsx .claude/skills/costo-artefactos/scripts/cargar-costos.ts /ruta/costos.json
```
Imprime, por ítem: costo, precio cliente (neto), margen unitario y total; el total
del proyecto con % de margen; los ítems que quedarían **sin costo**; y filas del
JSON cuyo `itemId` no existe. **Mostrale esta tabla a MJ** (§4.10: aprueba por el
resultado, no por el código) y esperá su OK.

### 6. Aplicar (solo con OK de MJ)
```
npx tsx .claude/skills/costo-artefactos/scripts/cargar-costos.ts /ruta/costos.json --apply
```
Escribe `realCostBlarq` en la base viva. Es una acción sobre prod (§4.7): solo con
OK explícito. Volvé a mostrar el reporte final costo vs venta por ítem y total.

## Formato del JSON de emparejamiento
Guardalo en el scratchpad (no lo commitees; lleva datos de una cotización puntual).
```json
{
  "project": "Paseo del Sena",
  "version": "V2",
  "ivaBasis": "gross",
  "items": [
    { "itemId": "cmq9...", "costNet": 88085, "note": "MK F1491032, mueble base" }
  ]
}
```
- `costNet` = costo **NETO unitario** de la cotización (sin IVA). El script aplica
  la base de IVA elegida (`gross` = ×1,19; `net` = tal cual).
- `note` es opcional pero conviene: de qué factura/línea salió cada costo, para
  poder auditarlo después.

## Base de datos — siempre la viva
Los scripts leen `DATABASE_URL` directo de `.env.prod` (host `ep-shy-morning`) y
**no** usan `dotenv` a propósito: `import "dotenv/config"` carga `.env`, que apunta
a la copia **vieja** `ep-solitary-mud` (gotcha que ya mordió varias veces). Los
scripts imprimen el HOST y abortan si no es `ep-shy-morning`. Confirmá ese "VIVA ✓"
antes de sacar conclusiones.

## Ojo con `metrics.ts`
`realCostBlarq` NO cambia el resultado real del proyecto (ese sale de facturas vs
cobrado). Solo alimenta: (a) la ganancia que muestra el editor de artefactos, y
(b) el presupuesto base de las **alertas** de desviación Cocina/Baño/Iluminación.
Aun así, cambiar costos toca terreno de `metrics.ts` (§4.1): el reporte del dry-run
es tu snapshot antes/después — revisá que los totales tengan sentido.

## Precedentes (mismo patrón, ya hecho a mano)
- `scripts/backfill-sena-v2-costos.ts` — bajó `realCostBlarq` del catálogo a la V2
  de Sena por `catalogId` (molde más cercano; dry-run + `--apply`).
- `scripts/set-jnc-artefactos-costos-v6.ts` — costos de JNC V6 desde facturas, con
  IVA. `scripts/diag-jnc-artefactos-costo-vs-venta.ts` — el reporte costo vs venta.
- `scripts/audit-portofino-v6.ts` — Portofino V6.
