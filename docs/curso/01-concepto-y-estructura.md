# Curso: "Tu propia app de gestión, sin saber programar" — concepto y estructura (borrador 1)

Borrador inicial, 2026-09-10. Es un punto de partida para conversar con MJ, no una decisión.
Todo lo que dice "recomendación" es opinión del asistente y se puede cambiar.

---

## 1. Qué se vende en realidad

La app BLARQ **no es el producto** del curso. Es el caso de estudio.

Lo que se vende es el **método**: cómo una arquitecta, dueña de un estudio de remodelaciones,
sin saber programar, construyó en ~5 meses una app en producción que reemplazó Excel + Maxxa,
lee las facturas del SII, concilia el banco, emite estados de pago a maestros y la usan dos
socios todos los días. Y cómo lo hizo conversando con una IA.

Eso es lo que nadie más puede copiar: hay cientos de cursos "haz tu app con IA" hechos por
programadores. Casi ninguno hecho por la dueña de un negocio real, con plata real, con los
errores reales. Ese es el ángulo.

**Promesa del curso (versión 1, a discutir):**
> "En 8 semanas vas a tener una app propia, andando en internet, que resuelve UN problema
> concreto de tu negocio — y vas a saber seguir construyéndola sola/o."

## 2. Para quién (hipótesis)

- **Nicho principal**: dueños de PYMEs de construcción / remodelación / arquitectura en Chile
  y Latinoamérica que hoy viven en Excel. Son los que entienden al toque el dolor
  (presupuestado vs real, estados de pago, facturas desparramadas).
- **Nicho secundario**: cualquier dueño de negocio de servicios con facturación y proyectos
  (estudios, consultoras, talleres, contratistas).
- **NO es para**: programadores (les va a parecer lento) ni gente que quiere "hacer una startup".

Recomendación: partir angosto (construcción, Chile/LatAm) y abrir después. El nicho es lo que
hace que el curso se venda solo por boca a boca en el gremio.

## 3. Materia prima que ya existe (está en este repo)

Esto es lo que hace que el curso se pueda armar rápido y con detalle real:

| Fuente | Qué aporta al curso |
|---|---|
| `docs/CHANGELOG.md` (920 líneas, abril → sept 2026) | La línea de tiempo real, con fechas, de cada pieza construida. |
| `docs/WIP.md` (1.400 líneas) | Cómo se conversa con la IA sesión a sesión: pedidos, correcciones, "gotchas". |
| `docs/decisions/` (16 ADRs) | Decisiones de diseño explicadas en lenguaje de negocio. |
| `CLAUDE.md` | El "manual de convivencia" con la IA. Se vuelve plantilla vendible. |
| `docs/principles.md`, `business-model.md`, `glossary.md` | Cómo se le explica el negocio a la IA para que no invente. |
| `docs/MIGRATION_POSTGRES.md` | El paso local → producción, como checklist. |
| `docs/REVIEW_*.md` | Las auditorías: cómo se verifica que la app cuenta la plata bien. |
| `scripts/` (443 archivos) | Muestra de cómo se prueba sin ser programador (snapshots, diag, dry-run). |

Cifras reales para el marketing (verificadas en el repo hoy):
- 426 PRs mergeados a producción entre abril y septiembre 2026.
- 43 modelos de datos, ~87.000 líneas de código.
- Integraciones: SII (dos caminos), banco Santander (cartolas), Telegram (bot), PDFs y Excel.
- 2 usuarios diarios (los socios), ~4 obras activas en paralelo.

OJO: la historia anterior a abril 2026 (cómo partió, con qué herramienta, cuánto tiempo) no
está en el repo. Hay que reconstruirla con MJ (ver preguntas, §7).

## 4. Estructura propuesta (10 módulos)

Cada módulo mezcla tres cosas: (a) la historia real de BLARQ, (b) el principio general,
(c) la tarea que el alumno hace en SU negocio.

**Módulo 0 — Antes de escribir una línea.**
El dolor: Excel V3, Maxxa, plata que no cuadra. El objetivo único de la app ("comparar lo que
presupuesté con lo que gasté y cobré"). Ejercicio: el alumno escribe el objetivo único de su app
en una frase. Sin eso, la IA construye cualquier cosa.

**Módulo 1 — Cómo hablar con una IA que programa.**
Las dos mesas: Claude.ai para pensar y diseñar, Claude Code para construir. El ping-pong real
(con capturas de conversaciones de BLARQ). Qué pedir, cómo corregir, cómo saber si te está
mintiendo. Ejercicio: primera conversación de diseño.

**Módulo 2 — El primer prototipo (local, en tu computador).**
Cotizaciones y un PDF que copia el Excel que ya usás. Por qué partir por lo que ya existe.
Historia: el PDF de obra replicando el Excel V3 de Cristian Lefevre.

**Módulo 3 — Cómo se modela un negocio.**
Proyectos, versiones de presupuesto, partidas, estados de pago. Las decisiones que no se pueden
deshacer (los ADRs: numeración paralela, cantidad ejecutada, descripción dual cliente/maestro).
Ejercicio: el alumno dibuja su modelo en papel con la IA.

**Módulo 4 — Conectar el mundo real.**
SII (primero por SimpleFactura, después con certificado propio), cartolas del banco, un bot de
Telegram que etiqueta facturas desde el celular. Qué es una integración y cuándo vale la pena.

**Módulo 5 — Salir a internet (producción).**
Vercel + Neon: de SQLite en el notebook a Postgres en la nube, con dos usuarios y contraseña.
Cuánto cuesta al mes. La migración como checklist real.

**Módulo 6 — Trabajar con IA sin que te rompa lo que ya anda.**
El módulo más valioso y el que nadie enseña: el archivo de reglas (`CLAUDE.md`), la
documentación viva (WIP, CHANGELOG, decisiones), snapshots antes de tocar cálculos, una sesión
a la vez, cómo aprobar un cambio SIN leer código (screenshot, PDF real, "probá esto").

**Módulo 7 — Los errores que costaron plata y tiempo.**
Las notas de crédito que inflaban $13M. El placeholder que dejó 48 facturas invisibles. Las dos
bases de datos con las etiquetas cambiadas. El botón "volver a lo enviado" que borró 54
asignaciones. Las reglas de proveedor que arrastraban facturas de Easy a Portofino. Cada uno
con: qué pasó, cómo se detectó, qué regla nació.

**Módulo 8 — Que se vea bien y se use en el celular.**
La estética editorial (blanco/negro/gris, sin emojis, jerarquía por tipografía), los principios
de diseño no negociables, las 24 pantallas adaptadas al celular en una semana.

**Módulo 9 — Cuánto costó, cuánto tomó, qué haría distinto.**
Suscripciones, horas, frustraciones. Lo que no se pudo (los PDFs oficiales del SII no corren
en la nube). Honestidad total: es lo que diferencia el curso.

**Módulo 10 — Tu turno: el kit.**
Plantillas descargables: `CLAUDE.md` genérico para una PYME, estructura de `/docs/`, plantilla
de ADR, checklist de salida a producción, guion de las 10 primeras conversaciones con la IA.

## 5. Formatos posibles (a decidir con MJ)

| Formato | A favor | En contra |
|---|---|---|
| **Video grabado, self-paced** (MJ en cámara + pantalla) | Escala, se vende dormida, es lo que la gente espera | Hay que grabar ~8-12 horas; edición |
| **Cohorte en vivo** (6-8 semanas, grupo de 15-30) | Precio más alto, comunidad, feedback real, se valida antes de grabar | Tiempo de MJ cada semana; no escala |
| **Texto + capturas + plantillas** (tipo libro/newsletter) | Rápido de producir con el material del repo | Se percibe más barato; menos "curso" |

Recomendación: **primera cohorte en vivo chica** (validar precio, ver dónde se traban los
alumnos) y con eso grabar la versión self-paced. El material escrito sale del repo casi solo.

## 6. Qué puede hacer el asistente y qué necesita de MJ

Puede hacer ahora, con el repo:
- Guion detallado de cada módulo, con las historias reales ya ubicadas por fecha y PR.
- Las plantillas del kit (módulo 10).
- La página de venta (texto + diseño) y el correo de lanzamiento.
- Reconstruir la línea de tiempo visual del proyecto.

Necesita de MJ:
- La prehistoria (antes de abril 2026) y cómo fue el arranque.
- Grabar: la voz y la cara son de MJ, nadie más puede.
- Decidir alumno, formato, precio.

## 7. Preguntas abiertas (van en el chat)

Ver mensaje de la sesión 2026-09-10. Las respuestas se vuelcan acá en el borrador 2.
