# ADR — Todo /api exige sesión por defecto, vía helper en el handler

- **Fecha**: 2026-06-15
- **Estado**: aceptado
- **Autor**: MJ + Claude (sesión de fix del hallazgo H1 de la auditoría general 2026-06-15)

## Contexto

La auditoría general ([`REVIEW_auditoria-general_2026-06-12.md`](../REVIEW_auditoria-general_2026-06-12.md), hallazgo **H1**, CRÍTICO) detectó que la API entera estaba **sin autenticación**: de 85 endpoints, 84 respondían sin pedir login. No existía `middleware.ts`/`proxy.ts` ni callback `authorized`; el único que chequeaba sesión era `account/change-password`. El login de NextAuth protegía las **páginas** (vía `auth()` en `(dashboard)/layout.tsx`), pero no las **rutas `/api`**.

Consecuencia: quien conociera la dirección de la app y las URLs internas podía borrar facturas, mover plata de conciliaciones, disparar el sync, importar cartola o cerrar EPs **sin estar logueado**, salteándose la pantalla de login. Además H1 era el "techo" que agravaba otros hallazgos (H7 pisar presupuesto firmado, H8 SSRF, H13 NaN, H16 ids cruzados): varios son graves *porque* la API estaba abierta.

Durante el diseño, MJ aportó una corrección de seguridad clave: tras el **CVE-2025-29927** (marzo 2025, bypass de autorización en el middleware de Next.js mandando el header interno `x-middleware-subrequest`), la recomendación de Next es **no** usar el middleware/proxy como única barrera de autenticación. El control real debe vivir dentro del route handler.

## Decisión

**Negar por defecto en `/api`: cada route handler exige sesión válida, vía un helper compartido llamado al inicio del handler. La barrera vive DENTRO del handler, no en un middleware/proxy.**

Detalles operativos:

- **Helper `requireSession()`** (`src/lib/apiAuth.ts`): llama a `auth()`; si no hay sesión devuelve una `Response` 401, si la hay la devuelve. Uso uniforme como primera línea de cada handler:
  ```ts
  const gate = await requireSession();
  if (gate instanceof Response) return gate;
  ```
  Corre dentro del handler (que siempre se ejecuta para responder), así que **no es vulnerable al bypass del CVE-2025-29927** — no hay capa de adelante que se pueda saltar con un header.
- **Allowlist explícita de 2** endpoints exentos, cada uno con su propia autenticación o por diseño público:
  - `auth/[...nextauth]` — el login mismo (NextAuth). Si pidiera sesión, no se podría loguear.
  - `telegram/webhook` — lo llama Telegram, no el navegador; se autentica con su secreto propio (`x-telegram-bot-api-secret-token`), ahora obligatorio (ver H17 abajo).
- **Guardián automático** (`scripts/check-api-auth.mjs`): recorre todos los `route.ts/.tsx` bajo `src/app/api` y falla si alguno no llama a `requireSession()` y no está en la allowlist. Enchufado al build (`"build": "node scripts/check-api-auth.mjs && next build"`), corre en cada deploy de Vercel → **un endpoint nuevo sin chequeo hace fallar el deploy**. Eso convierte "negar por defecto" en algo verificable, no dependiente de la memoria de quien programe.
- **H17 (misma superficie)**: el webhook de Telegram pasó de validar el secreto "solo si la variable existe" (`if (secret)`) a exigirlo siempre. Sin variable configurada → 503, no procesa. El secreto ya está seteado en Vercel Production.

## Alternativas descartadas

- **Solo `proxy.ts` (middleware) como barrera** — descartada por el CVE-2025-29927: el proxy es saltable y la propia doc de Next desaconseja usarlo como único control de auth. No se agregó `proxy.ts` en absoluto: suma superficie (justo la que atacaba el CVE) sin ser la cerradura. Si en el futuro se quiere un redirect lindo a `/login`, se suma como capa adicional, nunca como única.
- **Helper sin guardián** — descartada: con un helper por handler, el riesgo es olvidarse de llamarlo en un endpoint nuevo (nacería abierto). El guardián en el build cierra ese hueco.
- **Dejar `img-proxy` público** — evaluada y descartada (MJ, 2026-06-15): se verificó que las plantillas de PDF **no** usan `img-proxy` (meten la URL externa directa); su único consumidor es el catálogo logueado. Como siempre se llama desde una pantalla con sesión, gatearlo no rompe nada y deja la allowlist en solo 2 excepciones reales.

## Consecuencias

- **Positivas**: la API deja de estar abierta; los hallazgos que H1 agravaba (H7, H8, H13, H16) quedan detrás del login. "Negar por defecto" es automático (guardián en build). H17 cerrado de paso.
- **Deuda / límites honestos**:
  - El guardián verifica que la *llamada* a `requireSession` esté presente en el archivo, no hace análisis de flujo que confirme que está bien cableada en cada método. Es una red barata y fuerte (en la línea de los `scripts/test-*`), no una garantía formal.
  - `requireSession()` solo distingue logueado/no logueado. **No** hay control por rol todavía (MJ y JT son ambos admin igualitario, así que hoy no hace falta). Si entra un usuario de menos privilegios, habrá que sumar autorización por rol.
  - Esto **no** arregla H16 (un endpoint anidado sigue sin verificar que el hijo pertenezca al padre de la URL) ni H8 (la lista blanca del SSRF) — solo los pone detrás del login. Quedan para sus propias sesiones.
