# Business Model

Qué modela esta app, en lenguaje no técnico. Acá no hay código — la pareja técnica vive en [architecture.md](architecture.md).

## 1. Qué es BLARQ

**BLARQ** es un estudio chileno que hace **remodelaciones de casas y departamentos**, principalmente cocinas, baños y closets, con creciente apertura a construcción menor (paneles SIP). Lo arman dos socios:

- **María José Blanco (MJ)** — arquitecta, lidera muebles, interiorismo, terminaciones. Titular del cert digital ante el SII.
- **José Tomás Larraín (JT)** — lidera obra y construcción, supervisa terreno.

Equipo cercano:
- **Juan Pablo** — arquitecto jr., cubicaciones y dibujos. Sin acceso al sistema financiero.
- **Maestros** — 3 cuadrillas (1 que factura, 2 informales). Reciben EPs pero no usan la app.

Volumen: **~4 proyectos activos en paralelo**. Proyectos en fases distintas (algunos cotizando, otros en terminaciones).

## 2. Estructura de presupuesto: 3 documentos por proyecto

Toda cotización se entrega al cliente partida en **3 documentos separados**:

| Documento | Profesional a cargo | Lógica de precio | Cuotas típicas |
|---|---|---|---|
| **Obra** | JT (José Tomás) | Costo directo + GG (20%) + Utilidad (5-10%) + IVA (19%) | Anticipo 40% / Avance 25% / Avance 25% / Saldo 10% |
| **Muebles** | MJ | Mueble + Cubiertas + Herrajes. Utilidad NO declarada al cliente. Total c/IVA. | Anticipo 60% / Inicio instalación 30% / Saldo 10% |
| **Artefactos** (Cocina + Sanitarios) | MJ | Precios mercado − descuentos proveedor. Cocina y Sanitarios en docs separados. | Cuotas variables |

El formato de los PDFs replica fielmente el Excel V3 que BLARQ usaba pre-app (referencia: V3 Cristian Lefevre, abril 2026). Detalle de columnas y observaciones por tipo: ver `src/lib/pdf/{Obra,Muebles,Artefactos}PDF.html.ts`.

## 3. Flujo comercial — "vida de un proyecto"

```
Lead (referido / Instagram)
  → Reunión presencial (confianza)
  → Levantamiento (planos / medidas en obra)
  → Cotización V1 separada (Obra, Muebles, Artefactos)
  → Ida y vuelta con cliente (V2, V3...)
  → Cotización aprobada = contrato (letra chica, no muy formalizada)
  → EJECUCIÓN: facturas de proveedor + EPs a maestros + cobros al cliente
  → CIERRE: terminado, documentos archivados
```

### Numeración paralela cotización ↔ proyecto

Cada proyecto vive primero como **cotización** y, si se aprueba, recibe número de **proyecto**. Son dos contadores monotónicos paralelos, ambos correlativos, ninguno se reusa.

- Cotización 167, 168, 169... — todos los que entran al embudo.
- Proyecto 60, 61, 62... — solo los que se aprobaron.

Una cotización rechazada queda con `numeroCotizacion` asignado y `numeroProyecto = null`. Si más adelante el cliente vuelve, se recotiza con un nuevo `numeroCotizacion`. Decisión: ver ADR `2026-04-28-numeracion-paralela.md`.

**Excepción**: registros internos (BLARQ como entidad, centros de costo internos) tienen ambos en `null` y se marcan `isInternal=true`.

## 4. Estados del proyecto

| Status | Significado | UI |
|---|---|---|
| `cotizacion` | En etapa comercial. Aún no aprobado. | Sale en `/cotizaciones`. |
| `ejecucion` | Cotización aprobada, obra en curso. | Sale en `/proyectos` activos. |
| `terminado` | Obra entregada. | Archivado, sin tracking activo. |
| `archivado` | Cancelado / dropeado. | Oculto por default. |

Legacy: hubo un valor `aprobado` que en migración 2026-04-28 se renombró a `ejecucion`.

El estado en la app **mapea al estado de la carpeta en Drive de MJ**: "1- Cotizaciones" → "2- Proyectos" → "3- Proyectos Terminados".

## 5. Facturación al cliente — flujo no estándar

> **Importante**: en BLARQ el cliente paga PRIMERO y la factura se emite DESPUÉS.

La factura emitida (DTE 33) es prácticamente un **comprobante de pago ya recibido**, no una cuenta por cobrar. Decisión de negocio confirmada por MJ 2026-05-04.

Implicaciones:
- En `metrics.ts`, `totalCobrado = sum(facturasEmitidas.totalAmount)` es semánticamente correcto. Lo facturado ≈ lo cobrado.
- **No** sugerir agregar tracking de "facturas emitidas pendientes de cobro" salvo pedido explícito.
- Cuando un cliente paga en cuotas, BLARQ emite una factura por cuota cobrada.

Hoy BLARQ **emite** vía Maxxa (sin API). La salida de Maxxa hacia emisión propia desde la app es decisión pendiente.

## 6. Categorías de costo

Para clasificar gastos por proyecto. La estructura debe soportar jerarquía padre/sub.

### Costos directos de obra
- Materiales
- Mano de obra
- Herramientas
- Subcontrato
  - Ventanas
  - Flete / Retiro de escombros
- Pérdidas
- Margen (GG + utilidad declarada)

### Muebles
- Mueble
- Cubiertas
- Herrajes

### Artefactos
- Cocina
- Baño / Sanitario
- Iluminación

### Gastos empresa (no directos del proyecto)
- Gastos generales
- Gastos financieros
- Auto - combustible
- Auto - autopistas
- Auto - seguro

Las categorías son configurables (modelo `CostCategory`). MJ las administra desde la app.

## 7. Estados de Pago (EPs) a maestros

Documento operativo que BLARQ paga a la cuadrilla **contra avance**. Reemplaza la hoja "MANO OBRA" del Excel V3.

### Reglas

- El maestro **NO ve precios ni márgenes**: solo partida, unidad, cantidad, % avance, monto a pagar (al precio de mano de obra interno).
- La **cantidad ejecutada acumulada** es la verdad financiera. El % se deriva. La UI tipea %, internamente se guarda cantidad. Ver ADR `2026-04-26-cantidad-ejecutada-base-eps.md`.
- Cada partida tiene **descripción dual**: una para el cliente (PDF presupuesto) y otra para el maestro (PDF EP). Ver ADR `2026-04-26-descripcion-dual-cliente-maestro.md`.
- Al cerrar un EP, los montos se **snapshotean inmutables** (`amountPaid`). Si la versión del presupuesto cambia después, los montos pagados al maestro NO se recalculan retroactivamente.
- Validaciones: no se puede retroceder cantidad ejecutada vs un EP previo cerrado; no se puede pasar de cantidad presupuestada total.

### Cuándo cambia la versión del presupuesto

Si V3→V4 mid-project (ej: el cliente agregó partidas), los EPs siguientes arrancan vinculados a V4. La identidad de cada partida sobrevive el cambio de versión gracias a `lineageId`.

## 8. Banco — conciliación + fondo sueldos

Cuentas Santander de BLARQ:
- **Operativa** 0-000-8913459-5 (de donde salen/entran movimientos del proyecto).
- **Sueldos** 0-000-9987891-6 (de donde se pagan los socios).

### Conciliación

Al importar cartolas, los movimientos se auto-categorizan por descripción (motor de reglas que aprende). Los abonos se auto-matchean contra facturas pendientes del mismo RUT. Soporta **cobros parciales y splits** (un movimiento puede aplicarse a varias facturas, una factura puede cobrarse en varios movimientos).

### Fondo Sueldos — qué se traspasa al fondo

Por **tipo de cobro**, no por % global del proyecto (los muebleros cobran 60/30/10, obra cobra por EP de avance — son cadencias distintas):

| Tipo | Qué traspasa al fondo | Fórmula |
|---|---|---|
| Obra | GG (20-25% del costo directo) | `GG_obra × pctCobradoObra` |
| Muebles | Utilidad neta por item | `Σ(clientPriceNet − costDistributor) × pctCobradoMuebles` |
| Artefactos | Nada — queda en empresa | $0 |

Planilla mensual aprox: **$11M** (entre MJ + JT). El fondo sueldos define cuántos meses de planilla están "garantizados" antes de que entre nuevo flujo.

## 9. Roles de usuario

Hoy la app tiene un único nivel de admin igualitario para los socios:

| Rol | Quién | Acceso |
|---|---|---|
| `admin` | MJ + JT | Todo. |
| `colaborador` (default del schema, no usado todavía) | Futuro: Juan Pablo limitado a presupuesto. | Sin financiero. |

Los **maestros NO usan la app**. Reciben sus EPs como PDF entregado por JT.

## 10. Lógica de cálculo del Excel BLARQ — origen del modelo

El sistema replica fielmente el Excel "V3 OBRA" que BLARQ usaba antes (referencia: Cristian Lefevre, abril 2026). Hojas relevantes:

| Hoja Excel | Modelo Prisma equivalente |
|---|---|
| `BASE DATOS` (catálogo de partidas con desglose por concepto) | `PartidaCatalog` + `PartidaComponent` |
| `PRESUPUESTO` (lo que se entrega al cliente) | `BudgetVersion` + `ObraItem` |
| `MATERIALES` | `MaterialCatalog` |
| `MANO OBRA` (control de pagos a maestros) | `EstadoPago` + `EstadoPagoItem` |
| `RESUMENES` (lista compra, MO, herramientas, margen) | Lista de compra: `ShoppingItem` (en construcción). Resto pendiente. |
| `NECESIDAD` (cantidad real a comprar/pagar) | Pendiente de implementar. |
| `GANTT` | Pendiente, fase 3. |

**Lógica del P.U. de partida**:
```
P.U = Σ (CANTIDAD × P. CONCEPTO NETO)
       de todos los conceptos de esa partida
```
Tipos de concepto: `material | labor (MO + leyes sociales 1%) | margin | tool | loss | subcontract`.

## 11. Glosario corto

Todos los términos del negocio explicados línea por línea: ver [glossary.md](glossary.md).
