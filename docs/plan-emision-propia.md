# Plan — emisión de facturas desde la app (cutover de Maxxa)

*Borrador 2026-05-05. Este plan es la guía operativa del cutover. Se actualiza cuando MJ decide proveedor, completa certificación, o cambian las precondiciones. ADR asociada: [decisions/2026-05-05-proveedor-unico-lectura-emision.md](decisions/2026-05-05-proveedor-unico-lectura-emision.md).*

---

## 1. Objetivo

Reemplazar Maxxa (~$40.000/mes, sin API, MJ entra al portal a mano) por emisión propia desde `blarq-app`. Al cierre, BLARQ debería poder:

- Emitir factura electrónica afecta (DTE 33) a un cliente desde el detalle del proyecto.
- Emitir factura exenta (DTE 34) cuando aplique.
- Emitir nota de crédito (DTE 61) referida a una factura propia ya emitida.
- Recibir el PDF oficial timbrado y guardarlo en BD junto a la factura.
- Que la factura emitida quede registrada en `Invoice` con `origin='emitida'`, asociada al proyecto, y aparezca en `metrics.ts` como `totalCobrado` (ver business-model.md §5: cliente paga primero, factura se emite después → toda factura emitida es ≈ cobrada).

Lo que **NO** está en alcance de este plan:
- Boletas electrónicas (39, 41) — BLARQ no las usa hoy.
- Emisión a clientes en el extranjero / facturas de exportación.
- Liquidación/cesión de facturas (factoring).
- Reemplazo del cliente RCV de SimpleFactura por scraping SII propio. Esto se evalúa **dentro del mismo cutover**, no antes (ver ADR).

## 2. Estado del arte (2026-05-05)

### Lo que ya está hecho

- Branch **`modo-b-emision`** (commit `b9ababe`, 29-abr-2026) — código de emisión vía SimpleFactura ya escrito por una sesión anterior. **Severamente desactualizado** respecto a `main` (11.996 deletions vs 1.612 additions). No se puede mergear, hay que cherry-pickear los archivos nuevos:
  - `src/lib/sii/simpleFacturaEmit.ts` (293 líneas) — cliente para emitir DTE 33/34/56/61.
  - `src/lib/sii/simpleFacturaAuth.ts` (58 líneas) — token/credenciales.
  - `src/app/api/sii/emit/route.ts` (105 líneas) — endpoint POST.
  - `src/app/api/sii/cliente-from-sii/route.ts` (27 líneas) — autocompletar cliente desde SII.
  - `src/components/facturas/EmitirFacturaForm.tsx` (583 líneas) — formulario de emisión.
  - `src/app/(dashboard)/facturas/emitir/page.tsx` (45 líneas) — página.

  **Costo estimado de aprovecharlo**: 4-8h de cherry-pick + adaptación a las APIs y schema actuales. Mucho mejor que arrancar de cero.

- **Cert digital BLARQ** funcionando, vence 2026-08-01 (89 días).
- **SimpleFactura** conectado y autenticado en modo lectura.
- Schema `Invoice` ya cubre la mayoría de los campos: `tipoDoc`, `folioNumber`, `rutIssuer`, `rutReceiver`, `siiTrackId`, `xmlUrl`, `pdfUrl`, `pdfContent`, `origin`. **Falta**: `xmlContent` para guardar el XML firmado (auditoría).

### Lo que falta — orden tentativo

Dividido por bloques. Bloques 1-3 son de MJ (decisiones, trámites). Bloques 4+ son código.

---

## 3. Bloque 1 — Pre-decisiones de MJ (sin código)

| Decisión | Quién | Cómo |
|---|---|---|
| **Proveedor de DTE** | MJ | Tabla comparativa en §4. Decisión informada de costo + cobertura lectura/emisión. |
| **Renovar cert digital** | MJ | Trámite manual antes de 2026-08-01. Bloqueante: si vence sin renovar, todo el cutover se cae. |
| **Activar certificación de emisión con el proveedor elegido** | MJ + soporte proveedor | Set de pruebas estándar SII (~50 DTEs de prueba que el proveedor genera y el SII valida). Tarda 1-3 semanas. **No** se puede saltar: hasta que el SII no apruebe, no hay folios reales. |
| **Cargar CAFs (Códigos de Asignación de Folios)** | MJ + proveedor | El SII otorga rangos de folios por tipo de DTE. Hoy Maxxa los gestiona. Tras cutover, el proveedor nuevo. Trámite del SII. |
| **Mantener Maxxa en paralelo durante transición** | MJ | Sí, no apagar Maxxa hasta tener 2-3 facturas reales emitidas correctamente desde la app y MJ confirme que el cliente las recibió. |

## 4. Bloque 2 — Elección de proveedor

Criterios obligatorios (no negociables por la ADR `2026-05-05-proveedor-unico-lectura-emision`):

1. Cubre **emisión** de DTE 33, 34, 61 como mínimo.
2. Cubre **lectura** de DTEs recibidos y emitidos vía API REST. Si no, queda un proveedor para emitir y otro para leer — descartado.
3. API REST documentada, con sandbox.
4. Costo total mensual ≤ $40.000 (lo que hoy se paga a Maxxa). Idealmente < $20.000 para que sume al ahorro real.
5. Soporte en castellano, base chilena.

Candidatos a evaluar (ordenados por familiaridad de MJ):

| Proveedor | Lectura | Emisión | Costo aprox. | Notas |
|---|---|---|---|---|
| **SimpleFactura** | Sí (ya conectado) | Sí (set certificación + plan superior) | $15k base + $4k recibidos + plan emisión | Ventaja: cliente ya escrito (`simpleFacturaClient.ts`) y código de emisión cherry-pickeable de `modo-b-emision`. Falta confirmar precio plan emisión. |
| **OpenFactura (Haulmer)** | Sí | Sí | Por consultar — usualmente $20-30k/mes. Plan único. | API muy bien documentada. Una sola integración cubre todo. |
| **LibreDTE** | Sí | Sí | Plan free + pago por DTE emitido (~$50-100/DTE) | Modelo distinto: pagás por uso, no fijo. Útil si BLARQ emite pocos DTEs/mes. Hay que contar emisiones promedio. |
| **SimpleAPI** | Sí | Sí | Por consultar | Menos conocido. Validar que tenga sandbox y soporte. |
| **Integración SII directa** | Sí (RCV) | Sí (DTE upload) | Gratis | Curva muy alta — set de pruebas SII propio, firma digital de XML, manejo de errores. **Solo si ningún proveedor convence.** Descartado por defecto. |

**Acción inmediata para MJ** (puede hacerse esta misma semana):
- Pedir cotización formal a SimpleFactura (plan emisión + recibidos) y OpenFactura (plan que cubra todo).
- Con esos dos números + la cuenta de DTEs/mes, decidir.

## 5. Bloque 3 — Datos maestros que faltan

El schema actual **no tiene** los datos del cliente que el SII exige para emitir. Hoy `Project.clientName` es solo un nombre suelto. Para emitir hace falta:

- RUT del receptor (con DV)
- Razón social formal
- Giro
- Dirección
- Comuna
- Ciudad (a veces)
- Correo electrónico (para envío automático del DTE)

Dos opciones de modelado:

### Opción A — campos en `Project`

Agregar al modelo `Project`:
```prisma
clientRut        String?
clientRazonSocial String?
clientGiro       String?
clientComuna     String?
clientCiudad     String?
clientDireccion  String?  // distinto de `address` (que es la obra)
```
**Pros**: cambio mínimo. **Contras**: si el mismo cliente tiene varios proyectos, repetís los datos. Si MJ corrige el RUT en uno, queda inconsistente con los otros.

### Opción B — modelo `Client` separado

```prisma
model Client {
  id           String  @id @default(cuid())
  rut          String  @unique  // formato 76.123.456-7
  razonSocial  String
  giro         String?
  direccion    String?
  comuna       String?
  ciudad       String?
  email        String?
  projects     Project[]
}
```
Y en `Project`:
```prisma
clientId  String?
client    Client? @relation(fields: [clientId], references: [id])
```

**Pros**: dato único. Si MJ corrige el RUT, se corrige en todos los proyectos del cliente. Permite ver "todos los proyectos del cliente X". **Contras**: migración de los proyectos existentes (hay que poblar Client desde `clientName` actual — manual o semi-manual, MJ tipea unos 20-30 RUTs).

**Recomendación**: **Opción B**. Es el momento — antes de empezar a emitir es trivial; después es migración con datos reales en juego. Además habilita features futuras (dashboard por cliente).

**Acción**: si MJ acepta Opción B, este es un mini-PR independiente que se puede hacer **antes** de elegir proveedor — no depende de eso. Se puede ir avanzando hoy.

## 6. Bloque 4 — Implementación (código)

Asume Opción B del Bloque 3 hecha y proveedor elegido. Si el proveedor es SimpleFactura, los pasos 6.1-6.2 son cherry-pick + adaptación; si es OpenFactura u otro, hay que reescribir el cliente.

### 6.1 Cliente del proveedor (`src/lib/sii/<proveedor>Emit.ts`)

- Función `emitInvoice(input): Promise<EmitInvoiceResult>` que recibe `{ tipoDTE, receptor, items, formaPago, fechaEmision, referencia? }` y devuelve `{ ok, folio, trackId, pdfBase64, xml, errors? }`.
- **Mock mode** obligatorio: si no hay credenciales, devuelve folio fake. Permite probar UI sin emitir DTEs reales mientras la certificación está en proceso. Ya implementado en `modo-b-emision`.
- Manejo de errores SII (códigos típicos: receptor no inscrito, RUT inválido, monto incoherente, sin CAFs). Mensajes en castellano para mostrar a MJ.

### 6.2 Endpoint `POST /api/sii/emit`

- Valida input (Zod o validación manual).
- Llama al cliente del proveedor.
- Si OK: hace upsert en `Invoice` con `origin='emitida'`, `siiTrackId`, `pdfContent` (bytes), `xmlContent` (string), `projectId`, `clientId`, etc.
- Si falla: devuelve 422 con detalles, **no** crea Invoice (evita huérfanos).
- Idempotencia: si la app reintenta el mismo emit por timeout, protección contra emitir 2 veces. Idea: incluir un `idempotencyKey` (hash de `projectId + items + fecha + amount`) y rechazar si ya hay Invoice con esa key.

### 6.3 Schema — campos nuevos en `Invoice`

```prisma
xmlContent       String?  // XML firmado, para auditoría
emisionStatus    String?  // "pendiente" | "aceptado" | "rechazado_sii" | null (=recibida)
emisionError     String?  // si rechazado, mensaje del SII
idempotencyKey   String?  @unique
```

Migración: `npx prisma db push --skip-generate` en dev, validar, luego prod.

### 6.4 UI — formulario de emisión

Punto de entrada principal: **desde el detalle del proyecto**, botón "Emitir factura" (caso 99% de uso). Pre-popula:
- Receptor: `project.client.*` (RUT, razón social, giro, dirección).
- Item único default: `"Servicios de arquitectura — Proyecto <numeroProyecto> <name>"` con monto a tipear.
- Forma de pago: contado (porque cobro precede factura).
- Fecha emisión: hoy.
- Tipo DTE: 33 default.

Edge cases que la UI tiene que cubrir:

- **Items múltiples**: a veces MJ factura una cuota con desglose ("anticipo $X + diseño $Y"). El form de `modo-b-emision` ya permite múltiples items — verificar que se mantenga.
- **Factura exenta (34)**: cuando el cobro no lleva IVA (ej. servicios profesionales facturados por boleta de honorarios — no aplica acá normalmente, pero por si acaso). Selector de tipoDTE.
- **NC (61)**: punto de entrada **distinto** — desde la factura ya emitida, botón "Emitir nota de crédito". Pre-popula `referencia.tipoDocRef = 33`, `folioRef`, `fechaRef`, y MJ elige motivo (1=anula, 2=corrige texto, 3=corrige montos).

### 6.5 Después de emitir — qué pasa

1. PDF oficial timbrado se guarda en `pdfContent` y se sirve via endpoint `/api/facturas/[id]/pdf` (ya existe, hay que extender para servir emitidas).
2. La factura aparece en `/proyectos/[id]/facturas` y en `/facturas`.
3. `metrics.ts` la suma a `totalCobrado` (porque `origin='emitida'` + `tipoDoc=33` y BLARQ es el emisor).
4. Si MJ tiene email del cliente, **opcional fase 2**: enviar PDF por mail. Por ahora, MJ descarga PDF y manda a mano (igual que con Maxxa).

### 6.6 Tests / validación pre-prod

Como no hay suite automatizada general, lo mínimo:

- Script `scripts/test-emit-mock.ts` que dispara `emitInvoice` en mock mode con 3 casos: factura simple, factura exenta, NC con referencia. Verifica que el upsert en `Invoice` quede correcto.
- **Snapshot pre/post** de `metrics.ts` con un proyecto que emita una factura mock — confirmar que `totalCobrado` sube exactamente por el monto emitido y nada más se mueve. Esto es §4.1 de CLAUDE.md.
- Set de pruebas del proveedor: el proveedor mismo te valida ~50 DTEs antes de habilitarte producción. Ese **es** el test de integración real. No replicarlo.

## 7. Bloque 5 — Cutover de Maxxa

Solo cuando bloques 3 y 4 estén verdes y MJ haya emitido **2 facturas reales correctamente** desde la app a clientes vivos.

1. Confirmar con contador que Maxxa puede dejar de usarse sin trámite (probablemente sí, los CAFs se mueven al proveedor nuevo).
2. Bajar plan Maxxa al mínimo el primer mes de transición (paracaídas).
3. Después de 30 días sin necesidad de Maxxa, dar de baja.
4. Si el proveedor elegido también cubre lectura, dar de baja SimpleFactura en el mismo cutover (ahorro adicional $17.850/mes). Si no cubre lectura, mantener SimpleFactura y reabrir la pregunta de "¿escribir cliente RCV propio?" como fase posterior (ver ADR).

## 8. Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Cert digital vence sin renovar (2026-08-01) | Media | Alto — todo el flujo se cae | Recordatorio MJ + fecha en WIP.md. Renovar antes de 2026-07-15. |
| Certificación SII con proveedor demora más de lo esperado | Alta | Medio — cutover se atrasa | Empezar trámite **antes** de mergear código. Paralelizar con desarrollo. |
| Primer DTE real falla (RUT mal, CAF agotado, etc.) | Media | Alto — cliente queda sin factura | Mantener Maxxa en paralelo durante transición. Mock mode para testing. |
| Proveedor elegido sube precio o degrada servicio post-cutover | Baja | Medio — costo recurrente sube | El cliente del proveedor está aislado en `src/lib/sii/<proveedor>Emit.ts`. Cambiar de proveedor es 1-2 días, no rewriting. |
| Items múltiples / NCs con casos raros que el form no cubre | Media | Bajo — MJ vuelve a Maxxa puntualmente | Aceptable. Iterar sobre el form. |
| Cobro retroactivo a fecha pasada (ej. cliente pagó hace 3 meses, recién ahora MJ factura) | Alta (es el flujo normal de BLARQ) | Bajo si la UI lo cubre | El form acepta `fechaEmision` editable. Verificar que el SII permita fecha pasada (sí, con tope de ~30-60 días dependiendo del tipo de DTE). |

## 9. Estimación de tiempo (orden de magnitud)

Asumiendo dedicación normal (no full-time):

| Bloque | Esfuerzo |
|---|---|
| Bloque 1 (decisiones MJ) | 1-2 semanas calendario, depende de respuesta del proveedor + trámite cert |
| Bloque 2 (cotizar proveedores) | 1 semana calendario |
| Bloque 3 (modelo Client + migración datos) | 1 sesión de codeo (~3-5h) |
| Bloque 4.1-4.2 (cliente + endpoint) | 1 sesión si es SF (cherry-pick). 2-3 sesiones si es proveedor nuevo. |
| Bloque 4.3-4.5 (schema + UI) | 2-3 sesiones |
| Bloque 4.6 (tests + validación) | 1 sesión |
| Set de pruebas SII con proveedor | 1-3 semanas calendario (lo maneja el proveedor) |
| Cutover y monitoreo | 1 mes calendario en paralelo con Maxxa |

**Total realista**: 6-10 semanas calendario desde decisión hasta cutover completo, aunque el codeo neto son ~10-15h.

## 10. Próxima acción concreta (para arrancar mañana)

Sin esperar nada de proveedores, MJ y el asistente pueden avanzar hoy en **dos cosas en paralelo**:

1. **MJ**: pedir cotización a SimpleFactura (plan emisión) y OpenFactura (plan completo). Mensaje de 3 líneas a cada uno con: "soy emisor electrónico vigente, hoy uso Maxxa, busco proveedor con API REST que cubra emisión 33/34/61 + lectura recibidos/emitidos. ¿Qué planes tienen y precio mensual?".
2. **Asistente** (siguiente sesión, si MJ ok): implementar Bloque 3 — modelo `Client`, migración de proyectos existentes (semi-manual: MJ va completando RUTs cuando los tenga), agregar campos al form de creación de proyecto. Esto **no** depende del proveedor y desbloquea todo el resto.

Después de eso, el cutover queda esperando sólo dos cosas: certificación con proveedor (lo maneja el proveedor) y cherry-pick + adaptación del código de emisión (1-2 sesiones).

---

## Apéndice — referencias rápidas

- ADR de la decisión "proveedor único": [decisions/2026-05-05-proveedor-unico-lectura-emision.md](decisions/2026-05-05-proveedor-unico-lectura-emision.md)
- Lectura SII actual: [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md)
- PDFs SII oficiales: [SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md)
- Modelo de negocio relevante: [business-model.md](business-model.md) §5
- Branch con código de emisión existente: `modo-b-emision` (commit `b9ababe`)
- WIP general: [WIP.md](WIP.md) §"Decisiones pendientes"
