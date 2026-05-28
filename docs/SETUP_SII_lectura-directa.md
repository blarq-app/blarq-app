# Setup integración SII — lectura directa de facturas (RCV)

*Implementado 2026-05-28. Reemplaza a SimpleFactura para leer facturas.*

La app trae las facturas recibidas y emitidas **directo del SII**, sin pasar
por SimpleFactura. Usa el **Registro de Compras y Ventas (RCV)** del SII,
autenticando con el certificado digital de BLARQ.

> **Docs relacionadas**:
> - [SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md) — baja los PDF
>   oficiales de los DTEs recibidos (Playwright + MIPE). Distinta cosa, convive.
> - [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md) — la integración
>   vieja (pagada), ya retirada.

## Qué hace

| Sí hace | No hace |
|---|---|
| Trae el listado de facturas **recibidas** (compras) con folio, RUT proveedor, razón social, fecha, neto, IVA y total. | Emitir facturas (eso sigue por Maxxa — ver FASE 2 en docs/WIP.md). |
| Trae el listado de facturas **emitidas** (ventas). | Bajar los PDF oficiales (eso lo hace el otro sync, el de Playwright). |
| Auto-linkea notas de crédito recibidas con su factura original. | — |

## Cómo funciona

1. **Auth** (`siiAuth.ts`): pide una semilla al SII, la firma con el cert
   digital (XMLDSig) y obtiene un token (~30 min). Endpoint `palena.sii.cl`.
2. **Lectura** (`siiRcv.ts` + `siiDteReader.ts`): consulta el RCV mes a mes.
   - `getRcvResumen` → qué tipos de doc tienen movimiento ese mes.
   - `getRcvDetalle` → el listado con montos. `getDetalleCompra` para
     recibidas, `getDetalleVenta` para emitidas. Endpoint `www4.sii.cl`.
3. **Upsert** (`runSiiSync.ts`): mismo upsert idempotente de siempre, por la
   unique key `(type, tipoDoc, folioNumber, rutIssuer)`. No duplica las
   facturas que ya estaban (el formato de RUT `12345678-9` calza con lo que
   dejó SimpleFactura).

El modelo del RCV es **por período mensual** (YYYYMM). `siiDteReader` expande
el rango de fechas pedido a la lista de meses, consulta cada uno y filtra por
la fecha exacta al final.

## Dónde corre

Dos caminos, misma lógica (`runSiiSync`):

- **Botón "Sincronizar SII"** en `/facturas` → route `/api/sii/sync` → corre
  en Vercel. **Funciona solo si Vercel alcanza al SII** (el portal MIPE tiene
  WAF que bloquea IPs cloud; falta confirmar si el RCV/auth en `www4`/`palena`
  tienen el mismo bloqueo — verificar tras el primer deploy).
- **Script local** `npm run sii:sync-dtes` → corre en la mac de MJ, donde el
  cert vive y el WAF no aplica. **Camino confiable.** Puede sumarse al mismo
  LaunchAgent horario que ya baja los PDFs.

```bash
npm run sii:sync-dtes                                   # mes actual, ambos tipos
npx tsx scripts/sync-sii-dtes.ts --from 2026-04-01 --to 2026-04-30
npx tsx scripts/sync-sii-dtes.ts --type recibida
DATABASE_URL="<prod>" npm run sii:sync-dtes             # apuntar a prod
```

## Variables de entorno

Las mismas del cert que ya usa el sync de PDFs (ver SETUP_SII_pdf-oficial.md):

```bash
SII_CERT_PATH="/Users/mjblanco/Desktop/blarq-app/18022887-K.pfx"  # o SII_CERT_BASE64 en Vercel
SII_CERT_PASSWORD="..."
# Opcionales — defaults: SII_BLARQ_RUT=77270733  SII_BLARQ_DV=9
```

Si el cert NO está configurado, el sync cae a **datos mock** (dev sin cert).
Las variables `SIMPLEFACTURA_*` ya no se usan.

## Fragilidad conocida

Los endpoints del RCV son **no oficiales** (descubiertos inspeccionando el
portal del SII; los campos `accionRecaptcha`/`tokenRecaptcha` van con
placeholders que el server no valida). El SII podría cambiarlos y romper el
sync. Eso es lo que SimpleFactura amortiguaba a cambio del pago. Para leer
facturas el riesgo es asumible; si se rompe, se ajusta el cliente.

El certificado vence **2026-08-01** — afecta a esta integración y al sync de
PDFs por igual. Renovar antes (trámite manual de MJ).
