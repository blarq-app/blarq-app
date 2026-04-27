# Review crítico de navegación e información — BLARQ
*2026-04-27*

## 1. Inventario: dónde vive qué

### Sidebar global (siempre visible)
| Ruta | Función |
|---|---|
| `/` | Dashboard top-level — stats globales + cards por proyecto activo + banner alertas |
| `/proyectos` | Lista plana de proyectos (nombre / cliente / status) |
| `/facturas` | Listing global de facturas con filtros |
| `/catalogo/partidas` | Catálogo global de partidas |
| `/catalogo/materiales` | Catálogo global de materiales |

### Rutas por proyecto (`/proyectos/[id]/...`)
| Ruta | Función |
|---|---|
| `/` | **Project Detail** — datos cliente + 4 KPI cards + alerta desviación + quick links |
| `/editar` | Form de edición de datos del proyecto |
| `/presupuesto` | Lista de versiones (Obra / Muebles / Artefactos) |
| `/presupuesto/[id]` | Editor de versión (obra/muebles/artefactos según tipo) |
| `/estados-pago` | Lista de EPs |
| `/estados-pago/[id]` | Editor de EP |
| `/facturas` | Listing de facturas del proyecto (tabs por tipo) |
| `/lista-compra` | Lista de compra de materiales |
| `/resultados` | **Estado de Resultados** — 4 cards + estado de cobros + ppto vs real + avance por capítulo + desglose por tipo + gastos por categoría |

### Mapa de qué información se repite

| Métrica | Dashboard top-level | Proyectos list | Project Detail | Resultados |
|---|---|---|---|---|
| Status del proyecto | ✓ (badge) | ✓ (badge) | ✓ (badge) | — |
| Total acordado | ✓ | — | ✓ ("Presupuesto") | ✓ |
| Cobrado | ✓ (% solo) | — | ✓ (% + monto + barra) | ✓ (monto + estado de cobros completo) |
| Gastado | ✓ | — | implícito en alerta | ✓ |
| Utilidad | — | — | ✓ | ✓ |
| % avance obra | ✓ (sin breakdown) | — | ✓ (con # último EP) | ✓ (con breakdown por capítulo) |
| Alertas desviación | ✓ (banner global) | — | ✓ (banner por proyecto, semáforo) | ✓ (banner por categoría) |
| Datos cliente | — | ✓ (cliente + dirección) | ✓ (todo) | — |

**5 vistas. 8 piezas de información que se repiten en 2-3 lugares cada una. Y los 3 puntos de entrada al proyecto llevan a 3 destinos distintos.**

---

## 2. Diagnóstico de la arquitectura

### El modelo mental que la app le propone hoy

Mixto y poco coherente:
- **Sidebar global = "modos de la app"** (Dashboard, Proyectos, Facturas, Catálogo). Project-agnóstico.
- **Project Detail = "índice del proyecto"** que reparte hacia sub-secciones.
- **Resultados = "panel financiero"** que duplica info del Detail con más detalle.
- **Dashboard top-level = "resumen ejecutivo cross-proyecto"** que también muestra info por proyecto.

Resultado: cuatro vistas que hablan del mismo proyecto en niveles de zoom distintos, pero **no hay una jerarquía clara** que le diga al usuario "esto es lo de afuera, esto lo de adentro".

### Redundancia real

Sí, y donde duele más es entre **Project Detail vs Estado de Resultados**. Los dos muestran KPIs del proyecto. La diferencia real es:
- Detail: 4 cards básicas + 1 alerta + datos administrativos + 6 quick links
- Resultados: 4 cards (mismas) + estado de cobros con forma de pago + ppto vs real desglosado + avance por capítulo + desglose por tipo + categorías de gasto

**Resultados es Project Detail "explotado".** Detail no agrega info nueva — solo simplifica. La pregunta "¿por qué existen los dos?" no tiene buena respuesta.

Y Dashboard top-level ahora (después de mi cambio reciente) lleva a `/resultados` cuando clickeás una card. Pero Sidebar → Proyectos → Lefevre lleva a `/proyectos/[id]` (Detail). **Dos entry points al mismo proyecto que terminan en pantallas distintas**, según de dónde vengas.

### Información separada que debería estar junta

- **EP en curso vs pago a maestros vs avance obra**: hoy están en 3 lugares (resultados / estados-pago / detail). Cuando MJ paga un EP, quiere ver en una sola pantalla: "voy en X% de avance, este EP me cuesta Y, mi total pagado al maestro es Z, esto es lo que me sobra de presupuesto MO".

- **Cobros del cliente vs facturas emitidas**: la forma de pago acordada vive en `/resultados` (Estado de Cobros), pero el listado real de facturas emitidas está en `/facturas` (filtrando por proyecto). Para entender "voy bien con los cobros" tenés que cruzar ambas.

- **Presupuesto vs costos reales**: en Resultados se muestra el comparativo, pero al editar el presupuesto en `/presupuesto/[id]` no ves los costos reales que ya cargaste. El flujo natural sería "estoy editando V6 obra, ¿cuánto gasté ya en MO real para saber si subo el P.U.?" — hoy no se cruzan.

### Información unida que debería estar separada

Project Detail mete TODO en una pantalla: KPIs + alertas + datos administrativos + 6 atajos. Eso es señal de que la página no tiene un trabajo claro — está siendo "índice".

### Sidebar vs jerarquía real

El sidebar trata Dashboard/Proyectos/Facturas/Catálogo como pares. Pero **conceptualmente no son pares**: Catálogo es maestro/global, Proyectos es la unidad de negocio, Facturas son transversales (pertenecen tanto al global como al proyecto), Dashboard es una vista derivada.

**El sidebar no refleja que el 80% del trabajo de MJ es project-centric**. Una vez adentro de un proyecto, el sidebar deja de ser útil — no te ayuda a saltar entre EP/Facturas/Lista de compra del mismo proyecto. Tenés que ir al Detail y volver a clickear quick link cada vez.

### Flujo del usuario

**Usuario nuevo (primer login):** entra al Dashboard, ve cards de proyectos, click → cae en Resultados de un proyecto. Pero después no sabe cómo "entrar en serio" — no hay un menú dentro del proyecto, solo un link "Proyecto" en el breadcrumb que lo manda al Detail (otra pantalla con KPIs).

**Usuario experto (MJ haciendo tarea concreta):**
- "Voy a cargar una factura de Sodimac de Lefevre" → 4 caminos válidos para llegar (Sidebar Facturas + filtro / Sidebar Proyectos → Lefevre Detail → quick link / Dashboard card → Resultados → ??? no hay link a Facturas / URL directa). El primero es el más directo pero no es obvio.
- "Voy a cerrar el EP de la semana" → Proyectos → Lefevre → Detail → quick link Estados de Pago → click EP → editor. 4 clicks, dos de ellos pasando por una pantalla "índice" que no aporta info nueva.
- "Voy a ver cómo va Lefevre" → tres pantallas distintas pueden responder, depende del nivel de zoom que quiera.

**Conclusión:** flujo de tareas concretas funciona pero es subóptimo (siempre pasás por Detail aunque no agregue info). Flujo "vista de proyecto" es ambiguo (3 lugares, ¿cuál?).

---

## 3. Problemas identificados

### Fondo (arquitectura)

1. 🔴 **Project Detail es redundante con Resultados.** Hace lo mismo en peor (menos detalle). Su única función real es "redirigir a otras secciones". Es un peaje.

2. 🔴 **Sidebar global no cambia al entrar a un proyecto.** No hay sub-navegación dentro del proyecto. Para saltar entre secciones del mismo proyecto, MJ vuelve al Detail/Resultados cada vez. Es 2 clicks innecesarios por salto.

3. 🟡 **El nombre "Estado de Resultados" no comunica lo que es.** Suena contable. Es realmente "el dashboard del proyecto". Project Detail tampoco se llama nada — es el destino default de `/proyectos/[id]`.

4. 🟡 **Dos entry points distintos al mismo proyecto** (Dashboard card → Resultados; Proyectos list → Detail). Inconsistente.

5. 🟡 **Cards del Dashboard top-level repiten lo que ya muestra Resultados** del proyecto. La información cabe pero no hay claridad sobre qué resuelve cada nivel.

### Superficie (estética/microcopy)

6. 🟢 La sidebar global está limpia (5 items, claros).
7. 🟢 Las páginas individuales (EP editor, presupuesto editor, lista de compra) son sólidas — el problema no son ellas, es cómo navegás entre ellas.
8. 🟢 Los breadcrumbs existen y funcionan.

### Lo que conviene preservar

- El **menú global** con Dashboard / Catálogo / Facturas tiene sentido. No tirarlo.
- **Resultados** como "vista financiera del proyecto" tiene contenido útil — falta acomodarlo.
- **Listing por proyecto** de facturas/EPs/presupuestos está bien implementado individualmente.
- **Quick links** del Detail son la idea correcta, mal ubicada (deberían ser tabs persistentes, no una pantalla intermedia).

---

## 4. Tres alternativas

### Alternativa A — Conservadora: matar Project Detail, tabs persistentes

**Idea:** `/proyectos/[id]` redirige a `/resultados`. Las "secciones del proyecto" pasan de ser quick-links-en-una-pantalla a ser **tabs persistentes** que aparecen en TODAS las páginas del proyecto. Un solo entry point, contexto siempre visible.

**Navegación principal:**
```
Sidebar global: Dashboard / Proyectos / Facturas / Catálogo
  (sin cambios)

Cuando entrás a un proyecto, arriba aparece:
  ← Lefevre · Cliente: Cristian Lefevre · [EN EJECUCIÓN]                [Editar]
  [Resumen] [Presupuesto] [Estados de Pago] [Facturas] [Lista compra]
   ───────                                                              tab activo subrayado
```

**Wireframe (vista Resumen):**
```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Proyectos / Remodelación Cristian Lefevre · [EN EJECUCIÓN] [Editar]│
├──────────────────────────────────────────────────────────────────────┤
│ Resumen | Presupuesto | EPs | Facturas | Lista compra                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ⚠ Herramientas: 174% del presupuesto excedido                       │
│                                                                      │
│  ┌─────────┬─────────┬─────────┬─────────┐                           │
│  │ Acordado│ Cobrado │ Gastado │ Utilidad│                           │
│  │ $37.2M  │ $10M    │ $3.5M   │ +$6.4M  │                           │
│  └─────────┴─────────┴─────────┴─────────┘                           │
│                                                                      │
│  Estado de cobros al cliente                                         │
│   ████████░░░░░░ 27%   Anticipo ✓ · Avance · Avance · Saldo          │
│                                                                      │
│  Presupuesto vs Real por concepto                                    │
│   Materiales  $5.4M  vs  $2.2M  (40%)  ████░░░░░░                    │
│   MO          $9.6M  vs  $0     (0%)   ░░░░░░░░░░                    │
│   Herramientas $172k vs  $300k  (174%) █████████████ ⚠               │
│   ...                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Qué se gana:**
- Un solo entry point al proyecto.
- 0 clicks para saltar entre secciones del proyecto (antes 2).
- Project Detail desaparece, ya no hay redundancia.
- "Resumen" es un nombre intuitivo y reemplaza a "Estado de Resultados" + el Detail viejo.

**Qué se pierde / complica:**
- Hay que decidir qué pasa con Dashboard top-level (¿sigue habiendo cards o se reduce a banner global de alertas?). Voto por mantener pero simplificar.
- Implementación: tabs como layout compartido en `/proyectos/[id]/layout.tsx`. Es un layout shell.

**Esfuerzo:** **M** (1 layout shell + redirect del Detail viejo + microcopy).

**Para quién:** equipos chicos como BLARQ donde la app gira alrededor de pocos proyectos a la vez. Es la opción default.

---

### Alternativa B — Cambio medio: dos sidebars, contexto fuerte

**Idea:** mantener sidebar global pero **AGREGAR una segunda sidebar contextual** que aparece solo cuando estás dentro de un proyecto. Te da estructura clara: "estoy en BLARQ" (sidebar 1) → "estoy en Lefevre" (sidebar 2) → "estoy viendo EPs" (vista).

**Navegación principal:**
```
Sidebar global (izquierda, fija):
  📊 Dashboard
  🏗️ Proyectos       ← activo si estás en cualquier /proyectos/...
  💵 Facturas
  📋 Partidas
  🧱 Materiales

Sidebar de proyecto (centro, aparece al entrar a un proyecto):
  Lefevre
  ─────────
  Resumen
  Presupuesto ▾
    V5 obra
    V1 muebles
    + Nueva versión
  Estados de Pago
  Facturas
  Lista de compra
  ─────────
  Cambiar proyecto ▾
```

**Wireframe:**
```
┌────────┬───────────────┬─────────────────────────────────────────────┐
│ BLARQ  │ Lefevre       │ Resumen                                     │
├────────┼───────────────┼─────────────────────────────────────────────┤
│ ▪ Dash │ Resumen       │                                             │
│ ▪ Proy │ Presupuesto ▾ │  [4 KPI cards]                              │
│ ▪ Fact │   V5 obra     │                                             │
│ ▪ Part │   V1 muebles  │  Estado de cobros                           │
│ ▪ Mat  │ EPs (3)       │   ...                                       │
│        │ Facturas (4)  │  Presupuesto vs Real                        │
│        │ Lista compra  │   ...                                       │
│        │ ───           │                                             │
│        │ ⇅ Cambiar     │                                             │
└────────┴───────────────┴─────────────────────────────────────────────┘
```

**Qué se gana:**
- Contexto de proyecto siempre visible. Imposible perderse.
- Saltar entre proyectos es más rápido (combo "cambiar proyecto" en sidebar 2).
- Soporta proyectos con muchas versiones de presupuesto (las podés expandir en la sidebar).
- Escala mejor cuando BLARQ tenga 20+ proyectos activos.

**Qué se pierde / complica:**
- Dos sidebars consume horizontal real estate (más estrecho el viewport principal en pantallas chicas).
- Layout más complejo de implementar (responsive: cuando el ancho es chico, ¿dónde se va la segunda sidebar? ¿drawer?).
- Usuarios nuevos pueden encontrar la doble navegación sobreargada.
- Más código.

**Esfuerzo:** **M-L**.

**Para quién:** equipos que crecen, con muchos proyectos activos en paralelo. Para BLARQ hoy (1-3 proyectos activos) es overkill, pero pavimenta el futuro si crecen.

---

### Alternativa C — Radical: project-first, sidebar es la lista de proyectos

**Idea:** la app está hecha para gestionar proyectos. Eso es el corazón. Por lo tanto la sidebar **es** la lista de proyectos. Las vistas globales (Dashboard, Catálogo, Facturas globales) bajan a un menú secundario en la parte de arriba o pasan a ser tabs dentro del proyecto.

**Navegación principal:**
```
Top bar: 🏠 Dashboard | Catálogo | Facturas globales | + Nuevo proyecto

Sidebar (lista de proyectos):
  🟢 Lefevre        EP 2 borrador
  🟢 Portofino      EP en curso
  🟡 Vitacura       Cotización V2
  ⚪ Las Tranqueras  En espera
  ⚪ Otro proyecto

Cuando seleccionás un proyecto, el centro muestra:
  [Resumen] [Presupuesto] [EPs] [Facturas] [Lista compra]
  + el contenido de la tab activa
```

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ 🏠 Dashboard | Catálogo | Facturas | + Nuevo                        │
├──────────────────┬──────────────────────────────────────────────────┤
│ Lefevre          │ Lefevre · [EN EJECUCIÓN]                         │
│ ────────────     │                                                  │
│   ⚠ Herr 174%    │ Resumen | Presupuesto | EPs | Facturas | Lista   │
│   $37M acordado  │  ───────                                         │
│   27% cobrado    │                                                  │
│ ────────────     │  [contenido del tab seleccionado]                │
│ Portofino        │                                                  │
│ Vitacura         │                                                  │
│ + 3 terminados   │                                                  │
└──────────────────┴──────────────────────────────────────────────────┘
```

**Qué se gana:**
- La app le grita al usuario "esto es de proyectos". Imposible confundirse sobre el modelo mental.
- El sidebar muestra alertas y métricas de los proyectos activos (cards mini). Vista comparativa cross-proyecto sin salir.
- Cambiar de proyecto es 1 click.
- Dashboard cross-proyecto se conserva pero deja de competir con la vista de proyecto.

**Qué se pierde / complica:**
- Requiere repensar la organización completa. **Es un rediseño grande**.
- Si tenés muchos proyectos terminados, el sidebar se llena (necesita filtro/colapso "ver terminados").
- Las vistas globales (Catálogo, Facturas globales) pierden prominencia — quedan en top bar, menos accesibles.
- Difícil para usuarios que vienen de la versión actual (hay que reaprender).

**Esfuerzo:** **L**.

**Para quién:** apps que son 100% project-centric con pocos modos transversales. BLARQ encaja con esta descripción, pero implica el cambio más grande.

---

## 5. Mi recomendación

**Voy con A.** No B ni C.

Argumento:

- **A resuelve el problema concreto** que MJ reportó: "no sé por dónde entrar, los datos se solapan". Mata Project Detail (la fuente principal de redundancia), unifica entry points, da sub-navegación dentro del proyecto. Es la mínima cantidad de cambio que arregla lo que duele.

- **B agrega complejidad antes de tiempo.** Dos sidebars + responsive + lógica de "qué proyecto está activo" es robustez para un problema de escala que BLARQ todavía no tiene (1-3 proyectos activos). Cuando BLARQ tenga 15 proyectos en paralelo, hablamos.

- **C es un rediseño grande con riesgo de UX worse-before-better.** Los usuarios actuales (vos y JT) tendrían que reaprender. Para una app que ya tiene tracción interna, la fricción de la migración no compensa la ganancia teórica del modelo "más puro".

- **A te deja la puerta abierta a B/C después.** Los tabs de A se pueden volver sidebar contextual (B) si crecen las secciones, o la app puede pivotar a project-first (C) sin tirar A. No es un callejón sin salida.

- **Específicamente: matar Project Detail.** Es la decisión más importante. Esa página no agrega valor sobre Resultados. Lo que sí agrega son sus quick links — esos los movemos a tabs.

- **Renombrar "Estado de Resultados" a "Resumen"**. "Estado de Resultados" es el lenguaje de un contador, no del cliente.

- **Mantener Dashboard top-level pero simplificar las cards** para que sean "índice de proyectos con alertas" y no "mini-resultados duplicado". Ej.: nombre + status + 1 número clave + ⚠ si hay alerta. Click → tab Resumen del proyecto. Las 4 métricas detalladas viven en Resumen, no en el card.

Decisión secundaria: **el click en el sidebar Proyectos también lleva al Resumen** del proyecto seleccionado, no al "Detail" viejo (que no va a existir). Si no hay proyecto seleccionado, lleva a la lista.

---

## 6. Preguntas que cambiarían mi recomendación

1. **¿Cuántos proyectos activos esperás manejar en simultáneo dentro de 1 año?** Si la respuesta es 10+, B se vuelve más atractiva (te da contexto de proyecto siempre visible y switch rápido). Si 1-5, A es claramente suficiente.

2. **¿JT y los maestros van a usar la app?** Si solo vos editás y JT solo lee, la complejidad de B/C es injustificable. Si entran 3-4 personas con roles distintos (vos administrando, JT consultando, un maestro viendo su EP), ahí B empieza a tener sentido para que cada rol vea su contexto rápido.

3. **¿En qué tarea pasás más tiempo de la app?** Si lo que más hacés es editar presupuestos y EPs (trabajo "adentro" del proyecto), la sidebar global global te incomoda y B/C son mejores. Si lo que más hacés es saltar entre proyectos para ver "cómo van", la sidebar global está bien y A alcanza.

4. **¿Hay vistas "all proyectos cruzados" que necesitás y hoy no existen?** (Ej. todos los pagos a maestros del mes, todas las facturas vencidas cross-proyecto, agenda de cobros). Si sí, eso refuerza que el sidebar global tenga lugar — y A es la opción correcta.

5. **¿Cuán importante es el dashboard top-level (`/`) hoy para vos?** Si lo usás como entrada diaria, mantenerlo robusto importa. Si solo lo abrís ocasionalmente, podemos hacerlo más simple (banner de alertas + lista) y eso facilita C.

6. **¿Hay versiones móviles o vas a usar siempre desktop?** B se complica en mobile (dos sidebars en pantalla chica). C también es más complejo en mobile pero tolera mejor (un drawer único).

---

*Este reporte queda guardado en `/docs/REVIEW_navegacion_2026-04-27.md` para futura referencia.*
