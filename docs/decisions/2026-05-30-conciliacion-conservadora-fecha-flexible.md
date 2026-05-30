# ADR — Conciliación bancaria conservadora: fecha flexible, match por comercio

- **Fecha**: 2026-05-30
- **Estado**: aceptado
- **Autor**: MJ (criterio de negocio)

## Contexto

Auditando las 507 imputaciones de prod aparecieron conciliaciones mal hechas: el auto-match agarra "la primera factura del mismo monto" aunque sea de otro proveedor o de otra fecha. El comentario del código decía "±15 días" pero ese filtro nunca existió (pendiente #1/#2 de la auditoría ronda 32).

Al revisar los falsos positivos quedó claro que **la fecha NO sirve como filtro rígido**, porque casos legítimos la violan:
- **Sherwin** emite con ~1 día de desfase (el banco registra el cargo otro día).
- **Comercial K** factura al despachar, a veces por partes → un pago se reparte en varias facturas de distintos días.
- **Maestros** (JPB, Brune, Mármoles, etc.): se les transfiere y facturan días/semanas después. Pagar ANTES de la emisión es normal.

Y al revés, el problema real (cruce de proveedor) se detecta mejor por **nombre de comercio**, no por fecha.

MJ, textual: *"prefiero tener que hacer más trabajo manual, que trabajo mal hecho"*.

## Decisión

El auto-match es **conservador**: solo concilia con certeza; ante la duda deja el movimiento `sin_asignar` / la factura `pendiente`.

1. **RUT contraparte + monto** es la señal que define el match (más reembolsador vía alias). En el camino por RUT la **fecha NO interviene** — a un maestro/proveedor se le paga y factura después.
2. **Compras con tarjeta (sin RUT)**: matchear por **nombre de comercio en la glosa** vs razón social de la factura. Acá la boleta es del mismo día, así que SÍ hay **ventana de fecha (±31 días)**: si la única factura del comercio+monto está a más de un mes, no concilia (probablemente es otra compra del mismo monto). Si el comercio no calza, NO auto-conciliar.
3. **Excepción MercadoLibre/MercadoPago**: la glosa dice "MercadoPago" pero la factura suele venir de la **tienda vendedora** (el código tras el asterisco — `*RCCE`, `*HOME`, `*FERR` — es la pista del vendedor). No auto-conciliar estos; descubrir a mano.

**Implementado el 2026-05-30**: la decisión vive en la función pura `decideMovementInvoiceMatch` (en `src/lib/banco/invoicePayments.ts`), con test de regresión `scripts/test-conciliacion.ts` (13 casos). El importador de cartolas (`/api/banco/import`) tenía una copia inline con el bug "toma la primera del mismo monto" — se eliminó y ahora delega en la función compartida `tryAutoMatchMovementWithInvoices`. Match único y conservador en los tres caminos (importador, sync SII, auto-conciliar pendientes).

Unificación: los 4 puntos de entrada del auto-match (importador de cartolas, "auto-conciliar pendientes", alta de factura, sync SII) usan las funciones compartidas `tryAutoMatchMovementWithInvoices` (mov→factura) y `tryAutoMatchInvoiceWithExistingMovs` (factura→mov). No quedan copias inline. El match por comercio + ventana de fecha corre en AMBAS direcciones (simétrico).

Dos caminos de validación:
- **Con RUT** (del mov o vía alias de reembolsador): el RUT debe calzar. Si hay RUT y no calza, NO cae al match por comercio. La fecha no interviene.
- **Sin RUT** (compras con tarjeta — las 775 compras del banco no traen RUT): match por **nombre de comercio** (glosa vs razón social). Whitelist `TARJETA_MERCHANTS` (Sodimac/Homecenter, Easy, Cavem, Sherwin/Vespucio Oriente, Construmart, Imperial, Tottus, Copec). Concilia solo si hay EXACTAMENTE una factura de ese comercio + monto **dentro de ±31 días** (`MERCHANT_DATE_WINDOW_DAYS`). Si la única candidata del comercio está a meses → `merchant_out_of_window` (pendiente). Si hay varias del mismo comercio+monto, la fecha desempata: gana la que cae dentro de la ventana.

Ante 0 o >1 candidatas válidas, queda pendiente.

NO se incluye MercadoLibre/MercadoPago en la whitelist (la factura suele ser de la tienda vendedora, no de ML → falso positivo). Tampoco hay desempate por fecha entre ambiguas. Esos quedan manuales.

## Alternativas descartadas

- **Filtro duro de fecha (±N días)** — rompe Comercial K (despacho por partes), Sherwin (1 día) y pagos a maestros previos a la factura. Descartada: genera más errores de los que evita.
- **Solo monto, sin proveedor** — es el estado actual ("toma la primera del mismo monto"): produce los cruces Easy↔Sodimac, Sodimac↔MercadoLibre, etc. Descartada.

## Consecuencias

- **Positivas**: menos conciliaciones falsas; los números reflejan la realidad. Lo que no se puede afirmar queda pendiente y visible.
- **Costos / contras**: más conciliación manual (MJ lo prefiere así). Ej: 50 movimientos MercadoPago sin factura quedan pendientes hasta que MJ consiga la factura o los marque "pago sin factura".
- **Deuda generada**: la whitelist de comercios (`TARJETA_MERCHANTS`) hay que ampliarla a mano cuando aparezcan comercios nuevos frecuentes. El desempate por fecha entre ambiguas y el caso MercadoLibre quedan manuales a propósito.

## Referencias

- Scripts: `scripts/audit-conciliaciones-erroneas.ts` (detector), `scripts/fix-conciliaciones-cruzadas.ts`, `scripts/fix-conciliaciones-ronda2.ts`, `scripts/descubrir-mercadopago.ts`.
- Memoria del asistente: `feedback_conciliacion_conservadora.md`.
- Relacionado: pendientes #1/#2 de `docs/REVIEW_facturas-conciliacion_2026-05-29.md`.
