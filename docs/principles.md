# Principles

Decisiones de diseño no negociables que rigen la app. Si algo nuevo viola una de estas, primero discutirlo con MJ.

## Lenguaje visual BLARQ unificado

Toda la app habla el mismo idioma estético. No hay zonas con look distinto.

### Paleta

- **Blanco / negro / gris**. Es la base.
- Colores semánticos solo cuando aportan significado:
  - **Rojo** = excedido, vencido, error.
  - **Verde** = confirmado, pagado, OK.
  - **Ámbar** = atención, advertencia.
- **Default es gris neutro, no verde.** Un valor "OK" no se pinta de verde por inercia — solo si "OK" es el dato relevante.
- No hay **morado**, **rosado**, ni acentos decorativos. El banner SII original morado fue migrado a gris en abril 2026 por esta razón.

### Tipografía y números

- Tipografía sans (Geist por default).
- Jerarquía por **peso y tamaño**, no por color. Un H1 no es azul; es más grande.
- `tabular-nums` en columnas de números para que los dígitos alineen verticalmente.
- Negrita reservada para énfasis real, no decorativo.

### Iconografía

- Iconos **monocromáticos**, biblioteca `lucide-react`.
- **Sin emojis en UI ni en código** (ni 📥 ni 🚀 ni ✅). Los emojis rompen el tono editorial sobrio.

### Forma

- Sombras: `shadow-sm` máximo. No hay sombras gruesas decorativas.
- Bordes: 1px. Nunca 2-3px.
- Esquinas:
  - `rounded-xl` para containers (cards, modales).
  - `rounded-full` para badges.
  - `rounded` (default) para inputs y botones.
  - **No** `rounded-none`, **no** `rounded-3xl`.

### Tablas densas

Las tablas son densas y editoriales. Patrón:
- `thead.bg-gray-50` + `divide-y divide-gray-100`.
- Filas sin alternancia de color.
- Padding chico, no espacioso.
- Si hay totales, en la última fila con borde superior y peso bold.

## El cero no ocupa espacio prominente

Una cantidad 0, un avance 0%, un saldo $0 deben ser **visualmente discretos**. No se usa color destacado, ni énfasis tipográfico, ni íconos. La razón: cuando todo lo relevante es lo que NO está en cero, el cero compite por atención sin aportar.

Aplicación práctica:
- Mostrar `—` o `$0` en gris claro en vez de número negro.
- En totales, si hay 0 categorías ocupadas, no listarlas con badge.

## Memoria espacial por número correlativo

`numeroCotizacion` (167, 168, 169...) y `numeroProyecto` (60, 61, 62...) son la **memoria espacial** del estudio. MJ y JT recuerdan los proyectos por su número antes que por su nombre. Implicaciones:

- Los números deben ser **visibles**, no relegados a un id técnico.
- En listados, columna número primero (o muy cerca del nombre).
- Nunca renumerar. Nunca reusar.

Ver ADR `2026-04-28-numeracion-paralela.md`.

## Cantidad ejecutada como base en EPs (no porcentaje)

En Estados de Pago, la verdad financiera es **cantidad ejecutada acumulada**, no %. El % se deriva. La UI tipea %, internamente se guarda cantidad. Esto blinda los pagos contra cambios de versión del presupuesto.

Ver ADR `2026-04-26-cantidad-ejecutada-base-eps.md`.

## Descripción dual cliente/maestro

Cada partida tiene dos descripciones independientes:
- **`descriptionCliente`** — Va al PDF presupuesto. Habla en términos del cliente (alcance, materialidad, terminación visible).
- **`descriptionMaestro`** — Va al PDF del EP. Habla en términos del maestro (ejecución, técnica, cuidados).

Una partida con la misma descripción para ambos es un mal por defecto: cliente y maestro no quieren leer lo mismo.

Ver ADR `2026-04-26-descripcion-dual-cliente-maestro.md`.

## `metrics.ts` es la única fuente de verdad

Todos los cálculos por proyecto (cobrado, gastado, utilidad real, % avance, alertas) viven en `src/lib/projects/metrics.ts`. Los consumidores (cards, banners, EERR, dashboard) **no calculan**: solo eligen qué mostrar.

- Si necesitás un nuevo cálculo, agregalo a `metrics.ts`. No lo dupliques en el componente.
- Antes de modificar `metrics.ts`, snapshot pre/post (no hay tests automatizados).

## Jerarquía por tipografía, no por color

(Ya cubierto arriba en "Lenguaje visual", pero reforzado acá: aplica a UI, PDFs, emails, todo).

## El proyecto NUNCA se auto-asigna

Las facturas que llegan por sync SII automático tienen `projectId = null`. **Nunca** se infiere el proyecto desde el RUT del proveedor o desde otra heurística. MJ las cataloga manualmente.

Razón: una vez que se inserta un proyecto incorrecto, el costo del error es alto (modifica métricas, altera el fondo sueldos, ensucia el comparativo vs Maxxa). El costo de catalogar a mano es bajo.

La misma regla aplica a **categoría**: el motor de reglas RUT→categoría aprende de asignaciones manuales, pero el primer contacto con una factura de un RUT desconocido la deja en `null`.

## Sync SII de PDFs solo local — no Vercel

El SII tiene WAF F5 BIG-IP que detecta clientes no-Chromium y bloquea con 503. Validado empíricamente: Node + headers Chrome-like falla, Chromium real de Playwright pasa. Vercel además agrega IP cloud que muchos WAFs marcan como "no-residencial".

Decisión final: el sync de PDFs corre **solo en mac de MJ** (LaunchAgent diario + on-demand). No reabrir esta discusión sin nueva evidencia (ej: WAF cambia política, o proveedor mTLS cloud nativo aparece).

Ver [SETUP_SII_pdf-oficial.md](SETUP_SII_pdf-oficial.md) para detalle técnico.

## No suavizar el estado del código

Cuando algo está roto, a medias o dudoso, decirlo claro. Frases prohibidas en respuestas y en código:

> "robusto", "potente", "innovador", "perfecto"

Si una sección de doc no está clara: "no estoy seguro de X" es mejor que inventar. La auto-revisión 29-abril-2026 dejó establecido este principio.

## Placeholders ↔ null

Si un campo tiene un motor de automatización que decide en base a "está vacío o no", **no introducir** un valor placeholder ("Pendiente de asignar", "Por definir") que signifique lo mismo que `null`. Las queries de "uncategorized" se escriben con `IS NULL`, y un placeholder vuelve invisibles esos registros para los retroactivos.

Para distinguir visualmente las "sin clasificar", hacerlo en el render (itálica gris, badge), no creando un valor de dominio.

Detalle del incidente: ver historia git del commit `167bb38`.

## Reiniciar dev server al editar schema Prisma

Después de cualquier edit a `prisma/schema.prisma` que agregue un model o cambie un campo:

1. `npx prisma db push --skip-generate`
2. `npx prisma generate`
3. **Reiniciar el dev server** (`preview_stop` + `preview_start`, o matar y relanzar `npm run dev`).

Hot-reload no actualiza el cliente Prisma en memoria. Síntoma típico si te lo salteás: `Cannot read properties of undefined (reading 'findUnique')` al primer uso del nuevo modelo.

## Pedir aclaración cuando hay ambigüedad

Si una decisión razonable tiene 2+ opciones (estructura de datos, UX, naming), no asumir. Preguntar a MJ con las opciones puestas adelante y la recomendación.

Match scope of action to what was asked: si te pidió arreglar el bug X, no aproveches para refactorizar Y. Lo extra se ofrece, no se hace de forma silenciosa.

## Idioma español en todo

Respuestas, comentarios de código, mensajes de commit, mensajes de UI, doc nueva: todo en español (chileno cuando aplica). Inglés solo en identificadores (variables, tipos, funciones) si así está la convención del archivo.
