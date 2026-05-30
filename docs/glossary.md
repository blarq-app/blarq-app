# Glossary

Términos del dominio que un externo no entendería. Una línea por término. Cuando un término se relaciona con otro, está enlazado.

## Estructura de presupuesto

- **Partida** — Línea ítem del presupuesto Obra (ej: "1.3 RETIRO PISO CERAMICO"). Tiene unidad, cantidad y P.U. Internamente es la suma de varios `PartidaComponent` (Material + MO + Margen + ...).
- **Capítulo** — Agrupación de partidas en Obra (DEMOLICIONES, REPARACIONES, INSTALACIONES, TERMINACIONES, etc.) o de items en Muebles. Cada uno se numera (1, 2, 3...) y los items dentro reciben numeración hijo (1.1, 1.2).
- **Sub-capítulo** — Anidamiento de un capítulo dentro de otro (ej: "4.2 COCINA" dentro de "4 INSTALACIONES SANITARIAS"). Hoy no soportado en schema; planeado.
- **Concepto** — Unidad atómica que compone una partida. Tipos: `material`, `labor` (MO), `margin`, `tool` (herramientas), `loss` (pérdida), `subcontract`.
- **Versión de presupuesto** — V1, V2, V3... Cada cambio sustantivo en cantidad/precio genera una versión nueva. Histórico inmutable. La identidad de cada partida sobrevive con `lineageId`.
- **Cotización** — Estado comercial del proyecto: el presupuesto se entregó pero aún no fue aprobado. Tiene `numeroCotizacion`. Ver §3 de [business-model.md](business-model.md).
- **Presupuesto** — En el Excel BLARQ es la hoja que se entrega al cliente. En la app, el documento PDF que rinde `ObraPDF` / `MueblesPDF` / `ArtefactosPDF`.
- **Proforma** — Sinónimo informal de "cotización en revisión". No es un concepto distinto en la app: todo lo cotizado es `Project.status='cotizacion'`.

## Cálculo y montos

- **Costo Directo** — Suma de costos materiales, MO, herramientas, subcontrato y pérdidas del presupuesto Obra. Antes de GG y utilidad.
- **GG (Gastos Generales)** — 20-25% del Costo Directo. Es lo que se traspasa al **fondo sueldos** cuando el cliente paga obra.
- **Utilidad** — En Obra: 5-10% sobre Costo Directo + GG, **declarada al cliente**. En Muebles: implícita en cada item, **NO declarada** (cliente solo ve total c/IVA).
- **MO (Mano de Obra)** — Componente del costo directo. Incluye jornal/maestro + leyes sociales (1%). En el Excel es columna interna que el maestro no ve.
- **IVA** — 19% sobre Costo Neto. La app distingue siempre `netAmount` y `totalAmount` por factura.
- **Neto / c/IVA** — Indicadores explícitos en la UI para que MJ sepa qué representa cada cifra. Las etiquetas se agregaron en abril 2026 tras un bug de cálculo.
- **P.U. (Precio Unitario)** — Por unidad de partida. P.U. = Σ (cantidad × precio neto) de los conceptos de la partida.

## Cobros del cliente

- **Anticipo** — Primera cuota antes de empezar (típico Obra: 40%, Muebles: 60%).
- **Avance** — Cuotas intermedias contra hitos de avance (Obra típico: 25% + 25%; Muebles: 30% al inicio de instalación).
- **Saldo** — Última cuota al cierre (Obra: 10%; Muebles: 10%).
- **Cobro parcial** — Cuando una factura se paga en varios movimientos bancarios. La app lo maneja con `InvoicePayment.amountApplied` (many-to-many).

## Facturación

- **DTE** — Documento Tributario Electrónico (estándar SII Chile).
- **FE (DTE 33)** — Factura Electrónica. Operación afecta a IVA.
- **FE Exenta (DTE 34)** — Factura Electrónica Exenta. Sin IVA.
- **NC (DTE 61)** — Nota de Crédito. Resta del cobrado/gastado en `metrics.ts`. Suelen anular o ajustar una factura previa (referenciada por `referenceFolioNumber`).
- **ND (DTE 56)** — Nota de Débito. Suma adicional sobre una factura previa.
- **Boleta (DTE 39)** — Boleta electrónica. Poco frecuente en BLARQ.
- **Folio** — Número correlativo asignado por el SII a cada DTE. La unique key de `Invoice` es `(type, tipoDoc, folioNumber, rutIssuer)`.
- **Recibida** — Factura emitida por un proveedor hacia BLARQ. La paga BLARQ.
- **Emitida** — Factura emitida por BLARQ hacia un cliente o proyecto. La paga el cliente. En BLARQ, **emitida ≈ ya cobrada** (ver §5 de [business-model.md](business-model.md)).
- **Mandante** — Sinónimo de "cliente del proyecto". Es el que firma y paga la cotización.

## Obra y operación

- **Avance** — Porcentaje de ejecución de una partida en un EP. Internamente se guarda como **cantidad ejecutada acumulada**, no como %.
- **EP (Estado de Pago)** — Documento periódico (semanal típico) que BLARQ paga al maestro contra avance. Reemplaza la hoja "MANO OBRA" del Excel.
- **Maestro** — Cuadrilla de mano de obra. BLARQ tiene 3 (solo 1 emite factura).
- **Cuadrilla** — Equipo del maestro (varios trabajadores bajo un jefe).
- **Snapshot** — Captura inmutable de un dato en un instante. Se usa en EPs (al cerrar, `amountPaid` queda fijo) y en backup de BD (`scripts/db-backup.ts`).
- **Sync (versión presupuesto en EPs)** — Operación que actualiza un EP abierto cuando la versión del presupuesto cambió. Matchea por `lineageId`. Usuario elige qué cambios aceptar via modal `SyncDiffModal`.

## Centros de costo

- **Centro de costo (CC)** — Sinónimo de proyecto en el lenguaje contable de Maxxa. En la app, cada `Project` es un CC. BLARQ + autos también son CCs (internos).
- **Centro de costo interno** — `Project.isInternal=true`. No es proyecto de cliente: es para gastos de empresa, autos, etc. Se distingue porque tiene `numeroCotizacion=null` y `numeroProyecto=null`.
- **BLARQ (entidad interna)** — Centro de costo interno especial. Vista distinta a los proyectos comunes (gastos generales, financieros, autos).

## Categorización

- **Categoría / Subcategoría de costo** — Clasificación de gastos del proyecto (ver §6 de [business-model.md](business-model.md)). Modelo `CostCategory` con jerarquía padre/sub.
- **Pendiente de asignar** — Categoría especial no creada como dato. Se representa con `categoryId = null`. Ver feedback en [CLAUDE.md §4.6](../CLAUDE.md#46-placeholders--null) y commit `167bb38`.
- **Origen `sii_automatica`** — Marca en `Invoice.origin` para facturas que llegaron por el sync SII (no fueron cargadas a mano). Combinado con `projectId=null` se usa para filtrar las que esperan asignación manual.
- **Concepto de cobro** — Campo `Invoice.conceptoCobro` con valores `obra | muebles | artefactos | mixto`. Define cómo computa el fondo sueldos.

## Banco

- **Conciliación** — Acto de matchear cada movimiento bancario contra una factura recibida (gasto) o emitida (cobro).
- **Auto-match** — Matching automático cuando coinciden RUT + monto exacto (o saldo restante en cobros parciales). La fecha NO descarta; solo desempata. Criterio conservador: ante la duda, dejar pendiente. Ver ADR `2026-05-30-conciliacion-conservadora-fecha-flexible.md`.
- **Comercio ≠ glosa del banco** — En compras con tarjeta el banco rotula por ubicación o intermediario, no por el comercio real. Casos conocidos: el local de **Sherwin Williams** aparece como `Compra VESPUCIO ORIENTE`; **MercadoLibre/MercadoPago** factura a veces directo (MercadoLibre Chile) y a veces a nombre de la **tienda vendedora** (el código tras el asterisco, `*RCCE`/`*HOME`/`*FERR`, es la pista del vendedor). Por eso buscar movimientos por nombre de proveedor no siempre los trae todos; conviene filtrar por monto o por RUT de la glosa.
- **Fondo Sueldos** — "Plata reservada para pagar a los socios" derivada de cobros del cliente. Se calcula proyecto a proyecto: GG de Obra + utilidad de Muebles. Ver §8 de [business-model.md](business-model.md).
- **Drift** — Diferencia entre `BankAccount.lastKnownBalance` (último saldo importado) y la suma teórica de movimientos. Indica que faltan movimientos por importar o hubo error de imputación.
- **Transferencia interna BLARQ** — Movimiento entre las dos cuentas Santander de BLARQ. Detectada por descripción que empieza con `0772707339 Transf` (RUT BLARQ sin DV).

## Sistema y workflow

- **Sync** — Operación general de "traer datos externos". Distintos syncs: SII (DTEs vía SimpleFactura), PDFs oficiales SII (Playwright), versión EP ↔ versión presupuesto.
- **WIP** — Work In Progress. Archivo `docs/WIP.md` con estado actual del trabajo.
- **HANDOFF** — Notas efímeras de cierre de sesión, en `HANDOFF.md` (untracked en raíz). No es doc estable.
- **ADR** — Architecture Decision Record. Registro de una decisión arquitectónica. Viven en `docs/decisions/`.
