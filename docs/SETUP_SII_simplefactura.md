# Setup integración SII (SimpleFactura) — RETIRADO

> **OBSOLETO desde 2026-05-28.** La app ya NO usa SimpleFactura para leer
> facturas. Ahora lee **directo del Registro de Compras y Ventas (RCV) del
> SII** con el certificado digital de BLARQ — la misma data, gratis. Ver
> [SETUP_SII_lectura-directa.md](SETUP_SII_lectura-directa.md).
>
> SimpleFactura quedó en el código solo como (a) tipos compartidos `RemoteDTE`
> y (b) datos mock para dev sin certificado. Las variables
> `SIMPLEFACTURA_*` ya no se leen para sincronizar. Se puede **dejar de pagar
> el plan SimpleFactura** una vez verificado el sync directo en producción.
>
> El texto de abajo se conserva como referencia histórica de cómo funcionaba.

---

*2026-04-27 (histórico)*

La app sincroniza con el SII a través de **SimpleFactura.cl**. Este doc
deja constancia de cómo está configurado y qué hay que hacer para
operarlo.

## Resumen del flujo

1. SimpleFactura está conectado al SII vía certificado digital de BLARQ
   (subido a su panel cuando se contrató el plan).
2. La app BLARQ llama a la API de SimpleFactura para traer las facturas
   recibidas y emitidas. Es **solo lectura** por ahora — no emitimos
   desde la app, eso sigue por Maxxa hasta que decidamos migrar.
3. El usuario aprieta **"Sincronizar SII"** en `/facturas` y la app:
   a. Se autentica contra SimpleFactura (POST /token con email + password).
   b. Pide DTEs recibidos y emitidos desde la fecha de corte (1-abril-2026).
   c. Hace upsert en la DB con la unique key `(type, tipoDoc, folioNumber, rutIssuer)`.
   d. Las facturas SII llegan con `origin: "sii_automatica"` y `projectId: null`.
   e. El usuario las asigna a proyecto desde el filtro destacado.

## Variables de entorno (`.env`)

```
SIMPLEFACTURA_BASE_URL="https://api.simplefactura.cl"
SIMPLEFACTURA_EMAIL="mjblanco@blarq.cl"
SIMPLEFACTURA_PASSWORD="<password de login al panel SimpleFactura>"
SIMPLEFACTURA_RUT="77270733-9"
```

**Importante**: si las 4 variables no están seteadas, la app entra en
**modo mock** — devuelve facturas sintéticas (Sodimac, Easy, Roberto,
Lefevre) para que se pueda probar la UI sin credenciales. Útil en dev.

## Estado del plan SimpleFactura (a 2026-04-27)

- **Plan Independiente** $15.000+IVA mensual
- **Sin** adicional "Bandeja de DTE recibidos" ($4.000/mes) — esto bloquea
  el endpoint `/documentsReceived`. Hasta que MJ lo active, solo se
  traen facturas EMITIDAS (recibidas devuelve vacío con un warn en log).
- Ambiente: **Producción** (`ambiente: 1` en los requests)
- Sucursal: **"Casa Matriz"** (default — si BLARQ tiene más sucursales,
  habría que parametrizar)

## Endpoints que usamos

| Path | Método | Permite |
|---|---|---|
| `/token` | POST | Login: devuelve JWT (24h) |
| `/documentsIssued` | POST | Listar DTEs emitidos |
| `/documentsReceived` | POST | Listar DTEs recibidos (requiere adicional) |

Rate limit declarado: 2 req/seg, 100 req/min. Es alto, no lo vamos a
saturar con sync manual.

## Cómo activar el adicional (cuando MJ decida)

1. Login en https://www.simplefactura.cl
2. Sección "Mi plan" / "Configuración"
3. Activar "Bandeja de DTE recibidos" — $4.000/mes
4. Próximo `Sincronizar SII` ya trae las recibidas

No hay cambio de código — el cliente ya intenta `/documentsReceived` y
ahora simplemente devuelve data en vez de error.

## Cómo cambiar de proveedor (si fuera necesario)

Todo el código que toca SimpleFactura está en
`src/lib/sii/simpleFacturaClient.ts`. La app consume el tipo
`RemoteDTE` que es agnóstico al proveedor. Para migrar a OpenFactura u
otro:

1. Adaptar `realFetchDTEs()` y `getToken()` al nuevo proveedor.
2. Adaptar `normalizeDoc()` al shape del response del nuevo proveedor.
3. Cambiar las variables de entorno.
4. Renombrar el archivo si el código lo amerita.

El resto de la app (sync route, UI, banner, dashboard) no se entera del cambio.

## Modelo de datos

`Invoice` tiene los campos SII relevantes:
- `tipoDoc` (Int): 33=factura, 34=exenta, 39=boleta, 41=boleta exenta, 56=ND, 61=NC
- `folioNumber`, `rutIssuer`, `rutReceiver`: identifican el DTE
- `origin`: `"manual"` o `"sii_automatica"`
- `siiTrackId`: ID que devuelve el SII al emitir
- `xmlUrl`, `pdfUrl`: links que devuelve SimpleFactura
- `syncedAt`: última vez que se trajo o refrescó del SII

Constraint único: `@@unique([type, tipoDoc, folioNumber, rutIssuer])`. Esto
hace el sync idempotente — repetir el sync no duplica facturas.

## Próximos pasos pendientes

1. **Activar adicional "Bandeja DTE recibidos"** (decisión de MJ)
2. **Cron diario o cada 6h** para sync automático (hoy es manual con
   botón). Próxima iteración.
3. **Auto-asignación a proyecto** por reglas (ej. RUT proveedor recurrente
   → último proyecto donde se asignó). Mejora UX cuando ya haya histórico.
4. **Modo emisión** (Fase B) — reemplazar Maxxa con SimpleFactura para
   emitir facturas desde la app. Decisión separada con más riesgo.
