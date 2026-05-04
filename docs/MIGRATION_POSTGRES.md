# Migración SQLite → Postgres + deploy a Vercel

Este documento describe el cutover de la app desde el dev local SQLite hacia
producción en Vercel + Neon Postgres. Pensado como checklist secuencial.

## Estado al iniciar (Phase 1 hecha)

- `prisma/schema.prisma` sigue siendo SQLite (la app local NO se rompió).
- `prisma/schema.postgres.prisma` es schema paralelo postgres, valida 🚀.
- `node_modules/@prisma/client-postgres` es el cliente postgres generado.
- `scripts/migrate-sqlite-to-postgres.ts` lee SQLite + escribe Postgres,
  preservando IDs y FKs. Modo dry-run por default; `--apply` ejecuta.
- `.gitignore` ya excluye `.env*` y `*.db` (verificado).

## Phase 2 — Crear DB en Neon

Acción de MJ:
1. Crear cuenta en https://neon.tech (login con GitHub).
2. Crear project `blarq-app`, región `aws-us-east-2` (más cerca de Chile que us-east-1).
3. Copiar el `DATABASE_URL` que da Neon (formato `postgresql://user:pass@host/dbname?sslmode=require`).
4. Pegar a Claude. Claude lo guarda en `.env` como `POSTGRES_URL`.

Acción de Claude:
1. Agregar `POSTGRES_URL=...` a `.env` local.
2. Pushear el schema postgres a Neon:
   ```
   npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate
   ```
3. Correr el script de migración en dry-run:
   ```
   npx tsx scripts/migrate-sqlite-to-postgres.ts
   ```
4. Confirmar que los counts source coincidan con lo esperado.
5. Aplicar:
   ```
   npx tsx scripts/migrate-sqlite-to-postgres.ts --apply
   ```
6. Verificar que el reporte final muestre todos los counts iguales.

## Phase 3 — Repo en GitHub

Acción de MJ:
1. Crear repo privado `blarq-app` (sin README, sin .gitignore).
2. Pasarme la URL.

Acción de Claude:
```
git remote add origin https://github.com/<user>/blarq-app.git
git push -u origin main
```

## Phase 4 — Deploy en Vercel

Acción de MJ:
1. Crear cuenta en https://vercel.com (login con GitHub).
2. "Add New Project" → seleccionar el repo `blarq-app`.
3. Framework Preset: Next.js (auto-detectado).
4. NO hacer deploy todavía — primero setear env vars (paso siguiente).

Acción de MJ (setear env vars en Vercel):
| Key | Value | Notas |
|---|---|---|
| `DATABASE_URL` | el `POSTGRES_URL` de Neon | Mismo string |
| `NEXTAUTH_URL` | `https://app.blarq.cl` (o vercel.app temp) | Cambia en Phase 5 |
| `NEXTAUTH_SECRET` | Claude genera un nuevo secret | NO reusar el de dev |
| `SIMPLEFACTURA_BASE_URL` | mismo que dev | |
| `SIMPLEFACTURA_EMAIL` | mismo que dev | |
| `SIMPLEFACTURA_PASSWORD` | mismo que dev | |
| `SIMPLEFACTURA_RUT` | mismo que dev | |

Acción de Claude (cutover del schema):
1. Cambiar `prisma/schema.prisma` provider de `sqlite` a `postgresql`.
2. Borrar `prisma/schema.postgres.prisma` (ya no se necesita).
3. Borrar `node_modules/@prisma/client-postgres` (lo regenera Vercel).
4. Verificar que la app local sigue corriendo apuntando a Neon (`.env.local`
   con `DATABASE_URL=$POSTGRES_URL`).
5. Commit + push.

Acción de Claude (configurar build en Vercel):
1. Agregar al `package.json` (si no está ya) un postinstall que generate el client:
   ```json
   "scripts": {
     "postinstall": "prisma generate"
   }
   ```
2. Push.

Acción de MJ:
1. En Vercel dashboard, click "Deploy".
2. Esperar build (~3-5 min).
3. Abrir la URL temporal `*.vercel.app` y probar login con `mj@blarq.cl`.

## Phase 5 — Custom domain

Acción de MJ:
1. En Vercel: project → Settings → Domains → "Add Domain" → escribir `app.blarq.cl`.
2. Vercel mostrará un CNAME a configurar.
3. Loguearse en el registrador de blarq.cl, ir a la zona DNS:
   - Crear registro CNAME: nombre `app`, valor `cname.vercel-dns.com`, TTL 3600
4. Esperar 5-30 min hasta que Vercel detecte el DNS y emita SSL.
5. Cambiar `NEXTAUTH_URL` en Vercel a `https://app.blarq.cl` y redeploy.

## Phase 6 — Onboarding JT

Acción de MJ:
1. Pasarme un password temporal para JT.
2. Yo corro localmente apuntando a la DB de prod:
   ```
   POSTGRES_URL=<neon-url> npx tsx scripts/set-password.ts jt@blarq.cl <pass>
   ```
3. MJ le manda a JT por canal seguro:
   - URL: `https://app.blarq.cl`
   - Email: `jt@blarq.cl`
   - Password temporal: `<pass>`
4. JT entra. (Cambio de password propio queda como follow-up — UI "Mi cuenta".)

## Rollback plan

Si algo falla:
- Phase 2-3: la app local sigue funcionando contra SQLite. Solo borramos el
  destino Postgres y reintentamos. Cero impacto.
- Phase 4: si Vercel falla, no afecta producción (no hay producción todavía).
- Phase 5: si DNS falla, la URL `*.vercel.app` sigue funcionando. JT puede
  usar esa mientras se resuelve.
- Después del cutover: el `dev.db` queda como backup local del momento del
  cutover. Si algo grave pasa con Neon, podemos restaurar a un Postgres
  alternativo desde ese backup vía el mismo script de migración.

## Backups continuos post-cutover

Neon hace PITR (point-in-time recovery) automático en el plan free:
- 7 días de retención
- Branches del estado actual (similar a "git checkout" de la BD)

No se requiere config adicional.
