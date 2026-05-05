# BLARQ — App de gestión de obras

App interna de **BLARQ**, constructora chilena de remodelaciones (María José Blanco + José Tomás Larraín). Gestiona el ciclo completo de un proyecto: cotización → presupuesto (obra / muebles / artefactos) → ejecución con facturas SII y conciliación bancaria → estados de pago a maestros → cierre. Reemplaza el flujo Excel + Maxxa que el estudio usó hasta 2026.

## Stack

Next.js 16 · React 19 · TypeScript · Prisma 6 · Postgres (Neon) · NextAuth 5 · Tailwind 4 · Playwright (sync local SII).

## Levantar dev local

Requisitos: Node 20+, una BD Postgres accesible (típico: Neon dev branch).

```bash
npm install
npm run dev
# http://localhost:3000
```

### Variables de entorno (`.env`)

| Var | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a Postgres (dev branch en Neon). |
| `NEXTAUTH_SECRET` | Sesiones NextAuth. |
| `NEXTAUTH_URL` | Solo en prod con dominio custom. En Vercel se detecta auto. |
| `SIMPLEFACTURA_EMAIL`, `SIMPLEFACTURA_PASSWORD` | Login SimpleFactura para sync de DTEs. |
| `SII_CERT_PATH` | Path local al `.pfx` (solo necesario para sync de PDFs oficiales). |
| `SII_CERT_PASSWORD` | Password del `.pfx`. |
| `SII_BLARQ_RUT`, `SII_BLARQ_DV` | Opcional. Default: `77270733` / `9`. |

`.env`, `*.pfx`, `*.db` y `/backups/` están en `.gitignore`. **No commitear nunca.**

### Scripts útiles

```bash
npm run dev               # dev server
npm run db:studio         # Prisma Studio
npm run db:backup         # backup de la BD a backups/*.json.gz
npm run sii:sync-pdfs     # baja PDFs oficiales del SII (solo en mac de MJ)
npm run compare:maxxa -- <proyecto> <ruta-export.xls>
```

## Documentación

Toda la documentación viva está en [`/docs/`](docs/). Empezar por:

- [`CLAUDE.md`](CLAUDE.md) — instrucciones permanentes para asistentes IA. **Leer si vas a usar Claude Code u otro LLM agente sobre este repo.**
- [`docs/WIP.md`](docs/WIP.md) — estado actual del trabajo y próximos pasos.
- [`docs/architecture.md`](docs/architecture.md) — stack, estructura, modelo de datos.
- [`docs/business-model.md`](docs/business-model.md) — qué modela la app.
- [`docs/glossary.md`](docs/glossary.md) — vocabulario del negocio.
- [`docs/principles.md`](docs/principles.md) — decisiones de diseño no negociables.
- [`docs/decisions/`](docs/decisions/) — ADRs.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — log cronológico de cambios estructurales.

## Producción

App desplegada en **https://blarq-app.vercel.app**. Deploy automático on-push a `main`. Detalles en [`docs/architecture.md`](docs/architecture.md).
