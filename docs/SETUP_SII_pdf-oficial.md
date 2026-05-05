# Setup integración SII — PDFs oficiales (Playwright + cert digital)

*Implementado 2026-05-04. Solo corre local en mac de MJ.*

Este doc describe cómo la app baja los **PDFs oficiales** de los DTEs recibidos directamente del portal MIPE del SII, usando Playwright con un Chromium real autenticado con el certificado digital de BLARQ.

> **Doc relacionada**: [SETUP_SII_simplefactura.md](SETUP_SII_simplefactura.md) cubre la otra integración SII de la app (lectura de DTEs vía SimpleFactura). Son dos cosas distintas que conviven.

## Qué hace y qué no hace

| Sí hace | No hace |
|---|---|
| Baja PDFs oficiales de **DTEs recibidos** que aparecen en el listado MIPE del SII. | Baja DTEs emitidos por BLARQ (esos se emiten por Maxxa). |
| Cachea los PDFs en BD (`Invoice.pdfContent`) para servirlos sin volver a llamar al SII. | Cubre los DTEs por intercambio directo emisor-receptor que **no aparecen** en MIPE (~7% de los casos en BLARQ). |
| Funciona en sync masivo (todas las facturas) y en sync incremental (solo nuevas). | Corre en Vercel — el WAF del SII bloquea IPs cloud. |

## Por qué local-only

El SII tiene un WAF F5 BIG-IP (cookie `TS019e79ed`) que detecta clientes no-Chromium y devuelve 503. Validado empíricamente:

- Node con headers Chrome-like → 503.
- Chromium real de Playwright → pasa.
- Vercel agrega además IP de cloud (categorizada como "no-residencial" por muchos WAFs).

**Decisión final**: el sync corre en mac de MJ via LaunchAgent diario + on-demand. No reabrir esta discusión sin nueva evidencia. Ver `docs/principles.md`.

## Variables de entorno (`.env` local)

```bash
SII_CERT_PATH="/Users/mjblanco/Desktop/blarq-app/18022887-K.pfx"
SII_CERT_PASSWORD="2613"
# Opcional — defaults: SII_BLARQ_RUT=77270733  SII_BLARQ_DV=9
```

> El cert `.pfx` chileno usa algoritmos legacy (RC2/SHA1) que OpenSSL 3 deprecó. **Workaround**: el módulo lo carga vía `node-forge` y exporta a PEM antes de pasarlo a Playwright. No tocar.

## Schema (Prisma)

```prisma
model Invoice {
  // ...
  siiCodigo     String?    // id interno SII para mipeShowPdf.cgi
  pdfContent    Bytes?     // PDF cacheado, ~170KB. NUNCA cargar en queries de UI — usar omit.
  pdfFetchedAt  DateTime?  // null = no se intentó. Con valor + pdfContent null = no aparece en SII (edge case).
}
```

## Ejecución

### A mano (debug o forzar)

```bash
# Sync de todas las facturas pendientes (sin pdfContent):
npm run sii:sync-pdfs

# Primeras N (debug):
npx tsx scripts/sync-sii-pdfs.ts --limit 10

# Sin escribir a BD (dry):
npx tsx scripts/sync-sii-pdfs.ts --dry-run

# Con UI visible (debug):
npx tsx scripts/sync-sii-pdfs.ts --headed

# Reintenta las que se marcaron como no-encontradas:
npx tsx scripts/sync-sii-pdfs.ts --refetch-failed

# Forzar el LaunchAgent ahora:
launchctl start com.blarq.sii-sync-pdfs

# Apuntar a producción (no usar a la ligera):
DATABASE_URL="<url-prod>" npm run sii:sync-pdfs
```

### Automático

LaunchAgent `com.blarq.sii-sync-pdfs` corre todos los días a las **9:00 AM**. Logs en `~/Library/Logs/blarq-sii-sync-pdfs.log`. Plist instalada en `~/Library/LaunchAgents/`.

```bash
# Estado:
launchctl list | grep blarq

# Reinstalar / actualizar:
bash scripts/launchd/install.sh
bash scripts/launchd/uninstall.sh
```

## Flow descubierto del portal MIPE (validado vivo)

1. **Login mTLS**: `POST https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?<URL_RETORNO>` con body `referencia=<URL_RETORNO>` (form-urlencoded). Body vacío → error `01.01.215.500.760.52`.
2. **Warmup**: `GET https://www1.sii.cl/factura_sii/factura_sii.htm` (acumula cookies www1).
3. **Launcher**: `GET https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=1&TIPO=4&csrt=<N>` con Referer del menú. csrt no se valida estrictamente.
4. **🔑 Selección empresa (CRÍTICO)**: `POST https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi` con form `RUT_EMP=77270733&DV_EMP=9`. Sin esto, el listado responde "No ha seleccionado una Empresa" (CODIGO `02.35.209.58.148.10`). Funciona porque MJ es representante de UNA sola empresa.
5. **Listado paginado**: `GET https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi?...&NUM_PAG=N` SIN filtros. Filtros en sub-queries gatillan 503 del WAF. Parse con `cheerio` por filas para evitar matchear filas vecinas.
6. **PDF oficial**: `GET https://www1.sii.cl/cgi-bin/Portal001/mipeShowPdf.cgi?CODIGO=<N>` → PDF 168-172KB, `%PDF-1.4`. Idéntico al que muestra Maxxa.

## Archivos clave

- `src/lib/sii/siiBrowser.ts` — `openSiiSession()`, `loadAllSiiCodigos()`, `downloadSiiPdf()`, `closeSiiSession()`.
- `src/lib/sii/cert.ts` — carga `.pfx` con node-forge, exporta PEM.
- `scripts/sync-sii-pdfs.ts` — CLI batch sync.
- `scripts/test-playwright-sii.ts` — probe end-to-end (debug).
- `scripts/launchd/com.blarq.sii-sync-pdfs.plist` — LaunchAgent.
- `scripts/launchd/install.sh` / `uninstall.sh`.
- `src/app/api/facturas/[id]/pdf/route.tsx` — sirve oficial vs interno (header `X-PDF-Source`).

## Anti-WAF

- 1.5s entre páginas del listado.
- 1.2s entre descargas de PDFs.
- User-Agent Chrome 138 macOS.
- Single Chromium context, sesión persistente — no re-login por cada PDF.

## Edge cases conocidos

- **34 facturas no aparecen en el listado SII** (BD dev al 2026-05-04). Son típicamente NCs por intercambio directo emisor-receptor. El endpoint `/api/facturas/[id]/pdf` cae al PDF interno (resumen) en estos casos. Sin vía conocida para obtener PDF oficial.
- **EPROTO transitorio en login mTLS**: ocasionalmente la primera llamada falla con `RSA_verify_PKCS1_PSS_mgf1: first octet invalid`. Reintentar inmediatamente — handshake TLS ruidoso, no es bug.

## Operación recurrente

| Acción | Frecuencia | Cómo |
|---|---|---|
| Verificar que el sync diario corrió | Recomendado: 1×/día | `tail -50 ~/Library/Logs/blarq-sii-sync-pdfs.log` |
| Backup de BD prod (incluye PDFs cacheados) | Mensual | `DATABASE_URL="<prod>" npm run db:backup` |
| Renovar cert digital | Antes de cada vencimiento | Trámite manual MJ. Cert actual vence 2026-08-01. Tras renovar: actualizar `SII_CERT_PATH` local + `SII_CERT_BASE64` en Vercel. |

## NO hacer

- No commitear `.env`, `.pfx`, ni archivos `/tmp/sii-cert*.pem` (este último se regenera por proceso).
- No mover el sync a Vercel sin probar antes el WAF.
- No depender de `omit: { pdfContent: true }` sin reiniciar el dev server tras `prisma generate` (ver `principles.md`).
