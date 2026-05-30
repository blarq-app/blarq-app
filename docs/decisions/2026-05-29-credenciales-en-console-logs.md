# ADR — No imprimir credenciales en logs de scripts; rotar si se filtran

- **Fecha**: 2026-05-29
- **Estado**: aceptado
- **Autor**: MJ (a partir de un incidente en la sesión de auditoría)

## Contexto

Durante la auditoría de facturas/conciliación (ronda 32) se corrió `scripts/audit-dump.ts` contra prod. El script tenía una línea de debug que imprimía los primeros ~55 caracteres del `DATABASE_URL` "para confirmar a qué BD apuntaba". Esos 55 caracteres **incluían la contraseña** de la BD (el formato es `postgresql://usuario:CONTRASEÑA@host/...`, y la contraseña va antes del `@`). El valor quedó escrito en el log/registro de la sesión.

Es un patrón fácil de cometer: uno quiere verificar "¿estoy apuntando a prod o a dev?" e imprime un prefijo del connection string. Pero el prefijo es justo la parte sensible.

La contraseña vive además en varios lugares (Vercel env Production+Preview, LaunchAgent del SII, `.env.prod` local), así que rotarla no es un click — es una cadena de propagación.

## Decisión

1. **Los scripts nunca imprimen el `DATABASE_URL` ni ninguna credencial completa.** Para identificar el entorno, imprimir **solo el host** (`...match(/@([^/?]+)/)`) o un identificador derivado (el branch Neon: `ep-shy-morning` = prod, `ep-solitary-mud` = dev), nunca la parte previa al `@`.
2. **Si una credencial se filtra a un log, se rota.** No se asume "es mi sesión privada, da igual". La rotación se propaga a TODOS los consumidores en una sola pasada, en este orden para minimizar downtime: Neon (reset) → Vercel (env Production + Preview) + redeploy → LaunchAgent(s) → `.env.prod` → verificar que prod reconecta.
3. **El valor sensible nunca pasa por el chat/transcripción.** Se mueve clipboard→archivo (`pbpaste`/`pbcopy`) o se pasa por stdin/variable de shell, nunca como argumento literal ni `console.log`.

Aplicado en `audit-dump.ts`: la línea `console.log(DATABASE_URL.slice(0,55))` se reemplazó por imprimir solo el host.

## Alternativas descartadas

- **No imprimir nada del entorno** — descartada: la verificación "apunto a prod o dev" es útil y previene auditar la BD equivocada. Se conserva, pero mostrando solo el host (no sensible).
- **No rotar, total es una sesión local privada** — descartada: el costo de rotar es bajo y acotado; el costo de una credencial de prod filtrada que quede dando vueltas es alto y difícil de revertir después. Rotar es la opción conservadora correcta.
- **Enmascarar la contraseña en el log con regex post-hoc** — descartada: frágil (un cambio de formato la vuelve a exponer). Mejor no construir nunca la línea con el secreto.

## Consecuencias

- **Positivas**: los scripts de mantenimiento/auditoría son seguros de correr y de compartir su salida. Hay un procedimiento de rotación escrito y probado (se ejecutó entero el 2026-05-29).
- **Costos / contras**: rotar implica ~minutos de downtime de prod mientras se propaga el env y se redeploya. Aceptable para un incidente, no para hacerlo seguido.
- **Deuda generada**: ninguna. Conviene revisar otros scripts que impriman `DATABASE_URL` o secretos (`db-backup.ts` imprimía un `slice(0,60)` similar — verificar y parchear si aplica).

## Referencias

- Archivos del repo: `scripts/audit-dump.ts` (parche del print), `scripts/db-backup.ts` (revisar print similar).
- WIP: ronda 32 (`docs/WIP.md`).
- Reporte de la sesión: `docs/REVIEW_facturas-conciliacion_2026-05-29.md`.
- Consumidores de la credencial rotada: Vercel env (Production+Preview), `~/Library/LaunchAgents/com.blarq.sii-sync-pdfs.plist`, `.env.prod`.
