# ADR — Proveedor único para lectura + emisión de DTEs

- **Fecha**: 2026-05-05
- **Estado**: aceptado
- **Autor**: MJ + asistente Claude (sesión 2026-05-05).

## Contexto

A 2026-05-05 BLARQ tiene **dos integraciones SII conviviendo** y una **dependencia externa cara para emitir**:

1. **SimpleFactura** ($17.850/mes) — lectura de DTEs vía API REST. Corre en Vercel. Trae los DTEs estructurados (RUT, monto, folio, items) y los escribe en la tabla `Invoice`. Hoy solo trae emitidos; la "Bandeja DTE recibidos" ($4.000/mes adicional) está sin activar.
2. **PDFs SII oficiales** (gratis, vía cert digital propio) — entregado 2026-05-04. Baja el render visual del DTE desde el portal MIPE con Playwright + cert mTLS. Solo corre **local en mac de MJ** porque el WAF F5 BIG-IP del SII bloquea IPs cloud (validado empíricamente).
3. **Maxxa** (~$40.000/mes) — emisor de DTEs propios. Sin API. MJ entra al portal a mano cada vez que cobra a un cliente.

Total externo recurrente: **~$57.850/mes (~$694k/año)** solo en facturación electrónica, antes de poder emitir desde la app.

El logro de bajar PDFs oficiales con cert propio abre la pregunta natural: *¿podemos saltarnos SimpleFactura usando el endpoint RCV (Registro de Compras y Ventas) del SII directo?* Técnicamente sí — hay script de prueba en `scripts/test-sii-rcv.ts`. Pero hacerlo significa que **todo el sync de DTEs pasa a depender de la mac de MJ prendida**, igual que los PDFs.

En paralelo está pendiente la salida de Maxxa hacia emisión propia, donde la decisión clave es qué proveedor elegir (SimpleFactura emisión, OpenFactura, LibreDTE, SimpleAPI, Haulmer, integración directa al SII).

Sin esta decisión, el riesgo es resolver lectura con un proveedor (o con scraping propio) y emisión con otro, y terminar con dos integraciones distintas que hacen casi lo mismo.

## Decisión

**Cuando se resuelva el cutover de Maxxa, lectura y emisión van con el mismo proveedor.** No se evalúan por separado.

Específicamente:

- **No** se va a escribir un cliente RCV propio para reemplazar SimpleFactura mientras Maxxa siga vigente. El ahorro de $17.850/mes no justifica sumar dependencia de la mac de MJ al sync de DTEs estructurados (hoy ese sync corre en Vercel y siempre está arriba).
- Cuando MJ defina proveedor de emisión, el criterio de elección incluye **explícitamente** la capacidad de lectura. Si el proveedor elegido también lee DTEs recibidos y emitidos, SimpleFactura sale natural en el mismo cutover, sin escribir código de scraping SII.
- Si el proveedor elegido **no** ofrece lectura competitiva, recién ahí se evalúa: (a) seguir con SimpleFactura solo para lectura, o (b) escribir cliente RCV propio. Decisión postergada hasta tener proveedor elegido.

Los PDFs oficiales SII (vía Playwright local) se mantienen tal cual están — son ortogonales a la decisión de proveedor de DTEs estructurados, y no implican costo recurrente.

## Alternativas descartadas

- **Saltarse SimpleFactura ahora vía cliente RCV propio.** Ahorro: ~$214k/año. Costos: el sync de DTEs deja de correr en Vercel y pasa a depender de la mac de MJ prendida (hoy SimpleFactura es cloud, siempre arriba). En el momento que el cert digital se venza inesperado o la mac esté apagada un fin de semana largo, no llegan facturas nuevas a la app. La red de seguridad que da SimpleFactura (sigue trayendo datos aunque el cert local muera) desaparece. No hay urgencia financiera que justifique aceptar ese costo operacional ahora. Re-evaluable post-cutover de Maxxa.
- **Resolver lectura y emisión por separado, con dos proveedores.** Termina con dos integraciones distintas haciendo casi lo mismo. Más superficie de mantenimiento, dos contratos, dos posibles puntos de falla, sin ganancia clara.
- **Ir directo al SII para emitir** (sin proveedor). Implica certificarse uno mismo como emisor electrónico ante el SII (set de pruebas extenso, aprobación administrativa), gestionar CAFs, generar y firmar XMLs propios, manejar los códigos de error del SII. Curva muy alta para un estudio de 2 personas. Sin equipo dedicado a mantenerlo, primer error en producción para un cobro real es bloqueante. Descartada salvo que ningún proveedor convenza.

## Consecuencias

**Positivas**:
- Decisión sobre lectura queda atada al cutover real (emisión), no se toma por separado.
- Evita escribir/mantener un cliente RCV propio antes de saber si va a hacer falta.
- Cuando llegue la elección de proveedor de emisión, los criterios son explícitos: tiene que cubrir lectura + emisión.
- Ahorro acumulado al cerrar Maxxa + SimpleFactura en un solo movimiento: ~$57.850/mes ($694k/año), si el proveedor elegido es de costo similar o menor a SimpleFactura.

**Costos / contras**:
- Se sigue pagando $17.850/mes de SimpleFactura mientras dura la transición. Asumido.
- Si Maxxa sube precio o degrada servicio antes del cutover, la decisión queda forzada por urgencia y no por elección óptima. Mitigación: empezar el plan de emisión propia ahora (no esperar a que duela).
- Si el proveedor elegido al final no hace lectura, hay que volver a evaluar — ahí sí podría aparecer el cliente RCV propio como segunda iteración.

**Deuda generada**: ninguna nueva. La deuda existente (decidir proveedor de emisión, planificar cutover) se mantiene.

## Referencias

- Discusión completa: chat de sesión 2026-05-05.
- Plan operativo de cutover: [docs/plan-emision-propia.md](../plan-emision-propia.md).
- Doc lectura actual: [docs/SETUP_SII_simplefactura.md](../SETUP_SII_simplefactura.md).
- Doc PDFs oficiales: [docs/SETUP_SII_pdf-oficial.md](../SETUP_SII_pdf-oficial.md).
- Branch con código de emisión vía SimpleFactura (stale, requiere rebase): `modo-b-emision`, commit `b9ababe` (29-abr-2026).
- Modelo de negocio relevante: [docs/business-model.md](../business-model.md) §5 — "el cliente paga primero y la factura se emite después".
