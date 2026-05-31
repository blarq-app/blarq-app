# HANDOFF — Estado post-migración 2025 (continuidad)

Punto de partida para la próxima sesión. La auditoría cruzada Maxxa vs app **2026 (Fase 1) y 2025 (Fase 2) están COMPLETAS**. Esto reemplaza a `docs/HANDOFF_fase2-2025.md` (ya obsoleto). **Leer esto + `CLAUDE.md` + `docs/WIP.md` (rondas 36-37) antes de tocar nada.**

---

## 1. Qué se hizo (ya está en prod, verificado)

**Ronda 36 — Cross-check Maxxa vs app 2026**: los dos sistemas cuentan la misma plata. Se conciliaron 25 facturas + se resolvió Pedro Barrera (33/49 movs, Quincho registrado).

**Ronda 37 — Migración completa de 2025** (Maxxa + SII → app):
- **Movimientos**: Operativa los 12 meses + Sueldos Nov–Dic. Saldo corrido rellenado (730), huecos importados (278). **Verificado completo** vs cartolas Santander (0 ambiguos).
- **Facturas**: del SII (1.075 compras + 75 ventas). **Verificado completo** vs SII mes a mes (ventas calzan exacto los 12 meses; compras = app tiene todo lo del SII + extras).
- **10 proyectos nuevos** creados (n° de centro de costo Maxxa) + metadata en 902 facturas (proyecto/categoría/conceptoCobro).
- **582 conciliaciones** factura↔mov ($345M, 0 sobre-imputadas).
- **7 movimientos perdidos recuperados** ($8,6M — 5 eran retiros de MJ que el importador viejo dropeaba).
- **Bug del SII arreglado** (ventas no crasheaban) + **desplegado a prod** (merge a main, commit `8f8a45d`).

**Garantías verificadas**: nada falta (movimientos vs Santander, facturas vs SII) y el bug que perdía movimientos **ya no se repite** (el importador deduplica con saldo corrido desde la ronda 28; probado con los pares de ene/feb).

---

## 2. Lo que queda pendiente (accionable)

Por orden de valor:

1. **110 pagos a maestros sin factura** (tipoDoc 1043 en Maxxa, no en app): es mano de obra que falta como costo en sus proyectos. Se traen con "Pago sin factura", **obra por obra** (como se hizo con Pedro Barrera/Quincho en ronda 36-37). Los grandes y el detalle: `docs/REVIEW_migracion-2025_pendientes_2026-05-31.md` §2. **Cuidado con doble conteo**: si ya existe una factura falsa agregada para esa obra, no duplicar.
2. **Conciliación de facturas 2025** (515 recibidas pendientes): la maneja MJ. Ene+Feb (155 facturas) no se conciliaron porque la cartola de conciliación de Maxxa **arranca en marzo** — para esos meses falta esa fuente.
3. **Revisar si 2026 también perdió movimientos**: el mismo bug de "pares mismo-monto-mismo-día" pudo dropear retiros de MJ en 2026 también. Vale correr `backfill-balance-after.ts` (dry-run) sobre las cartolas 2026 y ver si reporta ambiguos. No se hizo aún.
4. **Menores**: Sherwin F-2917084 $36k (en app, no en SII) · proyecto n°34 Terraza Andrea Salas (1 factura, no creado) · 3 facturas Paula Johanna $59.500 (revisar dups).
5. **Filtro de anuladas en `metrics.ts`** (ADR `2026-05-30-metrics-no-filtra-anuladas.md`): defensa pendiente, hacer cuando se toque `metrics.ts` (con snapshot §4.1).

---

## 3. Decisiones y lecciones (reusar)

- **Fuentes de verdad**: facturas → **SII** (autoritativo, idempotente, corre local). Movimientos → **cartolas Santander** (traen saldo corrido y dedup confiable; NO usar las de Maxxa para importar). Metadata + conciliación → **Maxxa**.
- **Cruzar movimientos por GLOSA/RUT, NUNCA por monto solo** (lección de los $5M: varias transferencias del mismo monto el mismo día → el monto a ciegas pega mal).
- **Identidad de factura**: recibidas = `tipoDoc+folio+RUT`; emitidas = `tipoDoc+folio`. **NC**: Maxxa la guarda negativa, la app positiva → comparar magnitudes.
- **Proyectos nuevos**: número del centro de costo Maxxa, status `terminado`, nombre + cliente del paréntesis.
- **Maxxa solo tiene cargada la cuenta Operativa** (no Sueldos).
- **Detalle técnico crítico**: las transacciones interactivas de Prisma (`$transaction(async tx => ...)`) **fallan sobre el pooler de Neon** ("Transaction not found"). Hacer escrituras **secuenciales** + idempotentes + chequeo de huérfanos.
- **El SII rate-limitea (429)** si se lo martilla → throttlear (5s+ entre llamadas, retry con backoff).
- **Toda escritura a prod**: backup (`audit-dump.ts`) + dry-run + OK explícito de MJ + verificación post (snapshot + sobre-imputación).

---

## 4. Scripts (en `scripts/`, commiteados)

- `audit-dump.ts` — dump read-only de prod a `backups/` (gitignored).
- `backfill-balance-after.ts` — rellena saldo corrido (ronda 28). Corre ANTES de cualquier reimport.
- `import-cartolas-huecos-2025.ts` — importa cartolas de meses faltantes (dedup por saldo corrido).
- `import-maxxa-metadata-2025.ts` — proyecto/categoría/conceptoCobro desde exports Maxxa.
- `conciliar-maxxa-2025.ts` / `conciliar-seccion1-maxxa.ts` — conciliación factura↔mov desde cartola Maxxa.
- `agregar-movs-perdidos.ts` — recupera pares mismo-monto-mismo-día que la app perdió.
- `registrar-quincho-pedros.ts` — plantilla "Pago sin factura" (crea Invoice sin_respaldo + concilia).
- `relink-pagadas-2026.ts` — re-enlaza pagadas-sin-enlace (solo cobertura 100%).

Correrlos contra prod: `DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2- | tr -d '"')" npx tsx scripts/<x>.ts` (dry-run por default; `--apply` escribe). Los `.xls/.xlsx` de Maxxa y cartolas viven en `~/Downloads`, NO en el repo (`data/imports/` **no está gitignored** — no mover nada ahí).

---

## 5. Reportes con el detalle

- `docs/REVIEW_migracion-2025_pendientes_2026-05-31.md` — **el más importante para seguir**: qué revisar, con folios y montos.
- `docs/RESUMEN_cross-check-maxxa_2026-05-31.md` — resumen ejecutivo 2026.
- `docs/REVIEW_maxxa-vs-app-2026_2026-05-30.md` + `REVIEW_maxxa-conciliacion-pendiente_2026-05-30.md` — detalle 2026.
- `docs/WIP.md` rondas 36-37 — el log completo.
- Backups de cada escritura: `backups/audit-facturas-conciliacion-2026-05-31T*.json`.
