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

1. **RUT contraparte + monto** es la señal que define el match (más reembolsador vía alias). La **fecha NO descarta** candidatas — solo desempata cuando hay varias del mismo RUT+monto (elegir la más cercana).
2. **Compras con tarjeta (sin RUT)**: matchear por **nombre de comercio en la glosa** vs razón social de la factura. Si el comercio no calza, NO auto-conciliar.
3. **Excepción MercadoLibre/MercadoPago**: la glosa dice "MercadoPago" pero la factura suele venir de la **tienda vendedora** (el código tras el asterisco — `*RCCE`, `*HOME`, `*FERR` — es la pista del vendedor). No auto-conciliar estos; descubrir a mano.

**Implementado el 2026-05-30**: la decisión vive en la función pura `decideMovementInvoiceMatch` (en `src/lib/banco/invoicePayments.ts`), con test de regresión `scripts/test-conciliacion.ts` (7 casos). El importador de cartolas (`/api/banco/import`) tenía una copia inline con el bug "toma la primera del mismo monto" — se eliminó y ahora delega en la función compartida `tryAutoMatchMovementWithInvoices`. Así el match es único y conservador en los tres caminos (importador, sync SII, auto-conciliar pendientes).

NO se implementó (decisión explícita, "manual > mal hecho"): match por nombre de comercio para compras con tarjeta sin RUT (riesgo MercadoLibre = tienda vendedora) ni desempate por fecha entre candidatas ambiguas. Esos casos quedan pendientes para revisión manual.

## Alternativas descartadas

- **Filtro duro de fecha (±N días)** — rompe Comercial K (despacho por partes), Sherwin (1 día) y pagos a maestros previos a la factura. Descartada: genera más errores de los que evita.
- **Solo monto, sin proveedor** — es el estado actual ("toma la primera del mismo monto"): produce los cruces Easy↔Sodimac, Sodimac↔MercadoLibre, etc. Descartada.

## Consecuencias

- **Positivas**: menos conciliaciones falsas; los números reflejan la realidad. Lo que no se puede afirmar queda pendiente y visible.
- **Costos / contras**: más conciliación manual (MJ lo prefiere así). Ej: 50 movimientos MercadoPago sin factura quedan pendientes hasta que MJ consiga la factura o los marque "pago sin factura".
- **Deuda generada**: el match por comercio (compras con tarjeta) y el desempate por fecha quedan sin automatizar a propósito — son trabajo manual de MJ.

## Referencias

- Scripts: `scripts/audit-conciliaciones-erroneas.ts` (detector), `scripts/fix-conciliaciones-cruzadas.ts`, `scripts/fix-conciliaciones-ronda2.ts`, `scripts/descubrir-mercadopago.ts`.
- Memoria del asistente: `feedback_conciliacion_conservadora.md`.
- Relacionado: pendientes #1/#2 de `docs/REVIEW_facturas-conciliacion_2026-05-29.md`.
