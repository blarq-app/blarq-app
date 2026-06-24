# CLAUDE.md

Instrucciones permanentes para cualquier asistente que trabaje en este repo (Claude Code, otra instancia de Claude, otro LLM agente). Leer ANTES de tocar nada.

## 1. Quién es la usuaria

- **María José Blanco (MJ)**, arquitecta, dueña del estudio BLARQ.
- Construye esta app con ayuda de IA. **No es desarrolladora.** No lee código fluidamente.
- Necesita explicaciones en lenguaje natural. Si te pide algo técnico, traducí al castellano simple antes de proceder.
- Trabaja con Claude Code (sesiones de codificación, este chat) y Claude.ai (sesiones de pensamiento/diseño).
- Equipo cercano: **JT (José Tomás Larraín)** — socio igualitario, lee la app — y eventualmente maestros que verán sus EPs.
- Otra colaboradora: **Juan Pablo (arquitecto jr)** — cubicaciones/dibujos. Sin acceso financiero por ahora.

## 2. Idioma

- **Español (chileno cuando aplica)** en TODO: respuestas, comentarios de código, mensajes de commit, nombres de PR, mensajes de UI.
- Inglés solo en identificadores de código (variables, tipos, funciones) si así está la convención del archivo.

## 3. Estética BLARQ — no negociable

Ver detalle completo en [docs/principles.md](docs/principles.md). Resumen:

- Paleta: **blanco / negro / gris**. Denso, editorial.
- Tipografía sans, `tabular-nums` en columnas numéricas.
- **Sin emojis en UI ni en código** (no 📥 🚀 🎉). Rompen el tono editorial.
- Iconos **solo monocromáticos** (lucide-react). Nunca emoji como icono.
- Colores semánticos PERMITIDOS solo con significado:
  - Rojo = excedido / vencido.
  - Verde = confirmado / pagado.
  - Ámbar = atención.
  - Default = gris neutro. **No usar verde como default.**
- Sombras: máximo `shadow-sm`. Sin sombras gruesas.
- Bordes: 1px. Nunca 2-3px decorativos.
- Esquinas: `rounded-xl` containers · `rounded-full` badges · `rounded` inputs/botones. **Nunca `rounded-none` ni `rounded-3xl`.**
- Jerarquía por **tipografía** (peso, tamaño), no por color.
- "El cero no ocupa espacio prominente": cantidades 0 deben ser visualmente discretas.

## 4. Reglas duras de operación

### 4.1 Antes de modificar `src/lib/projects/metrics.ts` — cálculos contables

**Generar snapshot pre y post** (script + diff). Esa es la única protección que tiene la app: no hay tests automatizados sobre los cálculos. Comparar al menos 3 proyectos representativos (uno con NCs, uno con muebles, uno BLARQ interno) y confirmar que los totales no se mueven sin razón. Si se mueven, el cambio se justifica explícitamente en el commit.

`metrics.ts` es **la única fuente de verdad** de los totales por proyecto (cobrado, gastado, utilidad real). No duplicar cálculos en otros archivos.

### 4.2 Antes de tocar archivos en `/src/lib/`

No hay suite de tests general — solo scripts puntuales (`scripts/test-*.ts`). Antes de modificar:
1. Buscar si existe un `scripts/test-<modulo>.ts` correspondiente. Si existe, correrlo antes y después del cambio.
2. Si no existe pero el módulo es contable o de cálculo (`metrics.ts`, `calculations.ts`, `fondoSueldos.ts`), considerá agregar uno mínimo de regresión con 2-3 casos.
3. Buscar consumidores con grep antes de cambiar firmas.

### 4.3 No "suavizar" estado del código

Si algo está roto, a medias, o dudoso: decilo claro. MJ prefiere directo a diplomático. Frases tipo "robusto", "potente", "innovador", "perfecto" están prohibidas en respuestas y en código. Si una sección de doc no está clara, decir "no estoy seguro de X" es mejor que inventar.

### 4.4 Pedir aclaración cuando hay ambigüedad

Si una decisión razonable tiene 2+ opciones (estructura de datos, UX, naming), **no asumir** — preguntar a MJ con las opciones puestas adelante y la recomendación. Match scope of action to what was asked.

### 4.5 Auto-asignación por regla de proveedor

Las facturas que llegan del SII por sync **se auto-asignan** a categoría y/o proyecto **si existe una regla activa** para el `rutIssuer` (modelo `InvoiceCategorizationRule`).

**Cómo se aprenden las reglas (cambio 2026-05-14):**

- **Categoría — default ON.** Cuando MJ asigna categoría a una factura (bulk-assign o edición inline), se crea/actualiza la regla del proveedor con esa categoría. Útil: Easy = Materiales siempre, Sodimac = Materiales siempre. El toggle "Guardar categoría en regla" en el bulk-assign permite apagarlo caso a caso (ej. MK que a veces es Materiales, a veces Artefactos).
- **Centro de costo (proyecto) — default OFF.** Las reglas NO guardan proyecto por default. La mayoría de los proveedores son transversales (Easy/Sodimac/MK compran para muchas obras), y guardar proyecto como regla arrastra retroactivamente facturas a obras equivocadas. Solo se guarda proyecto en la regla cuando MJ explícitamente prende el toggle "Guardar centro de costo en regla" en el bulk-assign. Caso de uso real: Autopistas/Bencina/Patente → BLARQ siempre.
- **Edición inline (click en la celda de proyecto/categoría desde la lista)**: nunca aprende proyecto como regla. Solo aprende categoría. Para crear regla de "proveedor X → siempre obra Y" hay que ir al bulk-assign y prender el toggle.

Una regla puede tener categoría, proyecto, o ambos. Al aplicarse (sync SII o asignación manual), solo completa los campos vacíos en la factura — no pisa asignaciones manuales previas. Al crear/actualizar regla con proyecto, hay aplicación retroactiva al RUT (facturas viejas sin proyecto se asignan al de la regla) — por eso el default OFF para proyecto.

**Historial:**
- Hasta 2026-05-09: sync nunca auto-asignaba nada — todo quedaba `null` esperando catalogación manual.
- 2026-05-09: introducción del motor de reglas + project rules. Toggle único "Guardar regla" cubría categoría y proyecto.
- 2026-05-14: separados en dos toggles (categoría default ON, proyecto default OFF). Inline edit deja de aprender proyecto como regla. Motivo: facturas de Easy se contagiaban a Portofino por arrastre retroactivo.

### 4.6 Placeholders ↔ null

Si un campo tiene un motor de automatización que decide en base a "está vacío o no" (motor de reglas, retroactivos, guards), **no introducir** un valor placeholder ("Pendiente de asignar") que signifique lo mismo que `null`. Las queries de "uncategorized" se escriben con `IS NULL`. Detalle del incidente que originó esta regla: ver historia git del commit `167bb38`.

### 4.7 Acciones reversibles vs no reversibles

- Local y reversible (editar archivos, correr tests, levantar dev server): proceder.
- No reversible o blast radius alto (`git push --force`, drop de tabla en prod, borrar branch, deploy a prod, cambiar env vars en Vercel): **confirmar con MJ antes**.
- Cualquier cosa que apunte a la BD prod (Neon `ep-shy-morning`) debe ser confirmada explícitamente.

### 4.8 Trabajo en paralelo — ramas y worktrees

MJ trabaja con **varias sesiones a la vez** (a propósito, es más eficiente). El riesgo es perder trabajo o enredar dos features. Regla base: **una sesión = una rama propia = una carpeta de trabajo propia (worktree)**. Si cada sesión vive en su carpeta, son incapaces de pisarse aunque corran al mismo tiempo. El enredo clásico ocurre cuando dos sesiones editan la **misma** carpeta sobre la **misma** rama.

Protocolo obligatorio para cualquier sesión que vaya a tocar código:

1. **Al arrancar**: correr `git status` + `git branch --show-current`. Si hay cambios sin guardar de **otro tema** (no del tuyo), **parar y avisar a MJ** — no tocarlos, no commitearlos, no mezclarlos. Son de otra sesión.
2. **Rama propia**: trabajar en una rama que arranque de `main` (`git switch -c feat/<tema> main`), nunca encima de la rama de otra sesión. Para paralelo real, pedir/usar un worktree propio (carpeta separada).
3. **Commitear solo lo propio**: stagear archivos explícitos (`git add <ruta>`), **nunca `git add -A` ni `git add .`**. Antes de commitear, verificar con `git diff <archivo>` que el archivo compartido (ej. `MovementsTable.tsx`, `CHANGELOG.md`) solo tenga TUS cambios.
4. **Al cerrar**: dejar todo commiteado en tu rama y decir el nombre. No dejar trabajo sin guardar "para después" en una carpeta compartida.
5. **Borrar ramas / cerrar worktrees**: blast radius alto → confirmar con MJ (ver §4.7). Borrar solo ramas ya integradas a `main` con `git branch -d` (el `-d` se niega si no están integradas; nunca usar `-D` sin OK).

Mantener temas distintos entre sesiones (ej. artefactos vs facturas) ayuda, pero **no sustituye** el aislamiento por rama/carpeta.

### 4.9 Cuál es la base de datos VIVA — verificá antes de concluir

**La base de datos que usa la app en vivo (`blarq-app.vercel.app`) es `ep-shy-morning`.** Es la
fuente de verdad de los datos reales (proyectos, facturas, plata). Hay otra base, `ep-solitary-mud`,
que es una **copia VIEJA / de desarrollo** con datos congelados — NO es la viva.

**El problema que esto causó (y por qué esta sección existe):** sesiones que corren un script
normal (que hace `import "dotenv/config"`, o sea carga `.env`) terminaron leyendo la base VIEJA y
sacando conclusiones equivocadas sobre datos reales (ej.: "esta factura está sin asignar" cuando en
la app en vivo sí estaba asignada). Verificado el 2026-06-23.

Reglas:
- **Los rótulos de los archivos `.env` NO son confiables — se han swapeado.** A veces `.env` apunta
  a la viva, a veces a la vieja. **No te guíes por el nombre del archivo; guiate por el HOST.** La
  viva es siempre `ep-shy-morning`; la vieja es `ep-solitary-mud`.
- **Antes de sacar cualquier conclusión sobre datos**, verificá que estás en la base viva. Marcador
  rápido: el proyecto **#64 debe ser "Paseo del Sena"** y la **última factura debe ser de hace días,
  no semanas**. Si no calza, estás en la base vieja → cambiá de conexión.
- Herramienta de verificación: `scripts/diag-cual-base-viva.ts <ruta-env>` imprime el host y los
  marcadores para confirmar cuál es cuál.
- Tocar la base viva (`ep-shy-morning`) se confirma con MJ (§4.7), incluso para leer si hay duda.

## 5. Stack y workflow técnico

Detalle completo en [docs/architecture.md](docs/architecture.md). Resumen:

- **Next.js 16.2** (NO es el Next.js de tu training data — leé `node_modules/next/dist/docs/` antes de codear si dudás de un API).
- React 19, TypeScript, Tailwind 4.
- Prisma 6 + Postgres (Neon).
- NextAuth 5.
- Playwright (solo para sync local de PDFs SII, ver §7).

### Workflow al editar `prisma/schema.prisma`

1. Editar schema.
2. `npx prisma db push --skip-generate`.
3. `npx prisma generate`.
4. **Reiniciar dev server** (`preview_stop` + `preview_start` o `npm run dev` de cero). El cliente Prisma queda en memoria; hot-reload no lo refresca y `prisma.<nuevoModelo>` viene `undefined` en runtime.

### Convenciones de código

- Comments en español, explicativos del **por qué**, no del qué. Estilo grueso, multi-línea cuando ayuda. Ver `siiBrowser.ts` o `metrics.ts` como referencia.
- Imports: alias `@/` en `src/`, relativos en `scripts/`.
- Scripts CLI arrancan con `import "dotenv/config"` y cierran con `prisma.$disconnect()` en `finally`.
- Commits conventional: `feat(sii):`, `chore(infra):`, `fix(facturas):`. En español.
- Ningún `*.env`, `*.pfx`, `*.db`, `/backups/` se commitea (todo gitignored).

## 6. Documentación viva

Antes de empezar una tarea no trivial, mirar:

| Archivo | Para qué |
|---|---|
| [docs/WIP.md](docs/WIP.md) | Estado actual del trabajo, próximos pasos, decisiones pendientes. **Leer al inicio de cada sesión.** |
| [docs/architecture.md](docs/architecture.md) | Stack, estructura, modelo de datos, servicios externos. |
| [docs/business-model.md](docs/business-model.md) | Qué hace BLARQ, flujos, numeración, estados, roles. |
| [docs/glossary.md](docs/glossary.md) | Vocabulario del negocio. |
| [docs/principles.md](docs/principles.md) | Decisiones de diseño no negociables. |
| [docs/decisions/](docs/decisions/) | ADRs — decisiones arquitectónicas con su contexto. |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Log cronológico de cambios estructurales. |

**Convención de actualización**: ver §8.

## 7. SII — dos integraciones distintas

1. **Lectura de DTEs** vía SimpleFactura (API REST). Doc: [docs/SETUP_SII_simplefactura.md](docs/SETUP_SII_simplefactura.md).
2. **PDFs oficiales** vía Playwright + cert digital, **solo local en mac de MJ** (el WAF F5 BIG-IP del SII bloquea IPs cloud). Doc: [docs/SETUP_SII_pdf-oficial.md](docs/SETUP_SII_pdf-oficial.md).

**No mover** el sync de PDFs a Vercel sin nueva evidencia. Ver ADR `2026-05-04-sync-sii-local-only.md` cuando exista.

## 8. Cadencia de actualización de docs

- **WIP.md** — al cierre de cada sesión productiva (qué se hizo + próximos pasos). Si la sesión fue solo research o no hubo commits, actualizá igual la línea "última actualización" y dejá nota.
- **CHANGELOG.md** — cada vez que se mergea algo estructural (feature nueva, refactor grande, cutover, decisión que afecta a otros). 3-5 líneas por entrada.
- **decisions/ (ADRs)** — cuando se toma una decisión que cambia cómo funciona algo y querés que sea referenciable después. No son post-mortems exhaustivos; son contexto + decisión + alternativas + consecuencias. Plantilla en `docs/_templates/ADR.md`.
- **architecture.md / business-model.md / glossary.md / principles.md** — cuando un cambio del código las invalida. Si edito el modelo de datos y `architecture.md` queda desactualizado, lo actualizo en el mismo commit.
- **HANDOFF.md** (untracked, en raíz) — opcional, notas efímeras de cierre de sesión. Sustituible por WIP.md, pero útil cuando hay densidad alta de detalles que no califican como doc estable.

## 9. Memoria persistente del asistente

Existe `~/.claude/projects/-Users-mjblanco-Desktop-blarq-app/memory/MEMORY.md` (fuera del repo) con memorias persistentes mías entre sesiones. Esa memoria es:
- **Mía específica** — JT u otra instancia no la ven.
- Para estado **efímero** (cierre de sesión, contadores, hipótesis vivas) y feedback de la usuaria (correcciones, preferencias).
- **No** es el lugar para info estable del proyecto: eso vive en `/docs/` (commiteado, accesible para JT y otras sesiones).

Cuando aprendés algo estable del proyecto, volcá al `/docs/` correspondiente, no al MEMORY.md.
