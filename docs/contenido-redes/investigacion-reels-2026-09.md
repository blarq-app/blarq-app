# Reels de obra con IA — investigación para @estudio_blarq

Fecha: 2026-09-25. Pedido de MJ: la forma más fácil y más automática de hacer reels a partir de las
fotos y videos de obra que graba con el celular, con una IA que funcione como partner crítico
(ChatGPT o Claude, elegido con criterio), referentes, creadores que usan IA, y otras ideas para crecer.

**Cómo se hizo.** Tres líneas de investigación en paralelo (herramientas, referentes de Instagram,
creadores + algoritmo), solo con búsqueda web: el proxy de la sesión bloqueó la lectura de páginas
completas, así que los datos salen de extractos de buscador. Lo que no se pudo confirmar con más de una
fuente o con fuente oficial está marcado **(no verificado)**. Los precios cambian seguido: revisarlos
antes de pagar.

Archivos relacionados en esta carpeta:
- [pauta-de-grabacion-obra.md](pauta-de-grabacion-obra.md) — qué grabar en cada fase.
- [instrucciones-partner-contenido.md](instrucciones-partner-contenido.md) — el texto para configurar
  la IA como partner.
- Skill `contenido-reels` (`.claude/skills/contenido-reels/`) — el modo "producción" en el Mac.

---

## 1. La respuesta corta

| Pregunta | Respuesta |
|---|---|
| ¿ChatGPT o Claude como partner que mira el material? | **Ninguno de los dos: Gemini.** Es el único de los tres que recibe un video del celular y lo "ve" completo, con audio. Claude no acepta video. ChatGPT lo acepta, pero su propia ayuda advierte que puede no analizarlo completo ni entender el audio. |
| ¿Y Claude para qué? | Para el modo producción en el Mac: con la skill `contenido-reels`, Claude Code convierte una carpeta de material en hojas de contacto, propone el reel y **arma el borrador vertical** listo para terminar. También para estrategia, textos y revisión mensual. |
| ¿Con qué se edita? | **Edits** (la app de Instagram). Gratis, sin marca de agua, publica y programa directo. No CapCut (ver §3). |
| ¿Se puede automatizar todo? | Técnicamente sí (carpeta de Drive → IA → publicación por API). **No conviene** al volumen de BLARQ: cuesta más montarlo y mantenerlo que publicar a mano 3 veces por semana, y lo que decide si un reel funciona (elegir tomas, ritmo, gancho) sigue siendo criterio. |
| ¿Video generado con IA? | **No para mostrar obra.** Un antes/después generado inventa la obra intermedia; en construcción eso es engañar. Sí para animar un render de un proyecto no construido, declarándolo. |
| ¿Cuánto cuesta? | El stack recomendado parte en **US$0**: Gemini gratis (hasta ~5 min de video por consulta) + Edits. Si el cupo gratis no alcanza, Google AI Pro ~US$20/mes (precio en Chile no verificado). |
| ¿Qué es lo más importante? | Ninguna herramienta. **Grabar bien en obra** (puntos fijos para el antes/después, tomas quietas, sonido) y **publicar con constancia** (3 por semana). Y poner caras: MJ y JT. |

---

## 2. ChatGPT vs Claude vs Gemini para este caso

| | ChatGPT | Claude | Gemini |
|---|---|---|---|
| **Ver un video de obra (imagen + audio)** | Acepta el archivo, pero la ayuda de OpenAI advierte que puede no analizarlo completo ni el audio. Fuentes contradictorias sobre GPT-6 (lanzado 2026-09-03) y video (no verificado). | **No acepta video** (app, web ni Claude Code). Solo imágenes: hay que pasarle cuadros sueltos. | **Sí, documentado.** Hasta 10 archivos por mensaje; ~5 min de video en el plan gratis, ~1 hora con AI Pro. |
| **Criterio, guiones, "qué te falta grabar"** | Bien. Proyectos con instrucciones y memoria. | Bien. Proyectos con instrucciones, conector de Google Drive. | Bien, y lo hace mirando los clips. Gems con instrucciones. |
| **Generar video** | **Sora cerró** (app el 2026-04-26, API el 2026-09-24). Hoy no tiene. | No genera video. | Veo 3.1 (clips de 8 s, primer y último cuadro). |
| **Editar / armar el reel** | Plugin de Adobe dentro de ChatGPT (2026-08-06). | Conectores de Adobe (Premiere, Express) y Canva. Claude Code + ffmpeg arma el MP4 en el Mac. | Omni Flash edita conversando (clips cortos). Google Vids. |
| **Publicar en Instagram** | No. | No directamente (sí por scripts, no recomendado). | No. |
| **Para BLARQ** | Sin ventaja hoy. Revisar en unos meses. | Modo producción en el Mac + estrategia. | **El ojo del día a día desde el celular.** |

Por qué no elegí Claude como partner principal aunque sea el asistente que MJ ya usa: el material de
obra es sobre todo **video**, y el partner tiene que poder recibirlo directo desde el celular, en la
obra, sin pasos intermedios. Hoy Claude no puede. Si eso cambia, el mismo texto de instrucciones sirve
en un Proyecto de Claude sin tocar nada.

Por qué no ChatGPT: perdió su generador de video, su análisis de video no es confiable según su propia
documentación, y no hace nada para este caso que los otros dos no hagan.

---

## 3. Herramientas de edición y publicación

| Herramienta | Costo | Para qué | Veredicto |
|---|---|---|---|
| **Edits** (Meta) | Gratis | Editor del celular: línea de tiempo, subtítulos automáticos, plantillas, teleprompter, exporta 4K sin marca de agua, publica y programa directo a Instagram. En 2026 suma un asistente de IA (en prueba) y versión de escritorio (anunciada). | **Recomendado.** |
| **Canva Pro** | ~US$13–15/mes | Plantillas de marca para carruseles, portadas y textos. Tiene conector con Claude y ChatGPT. | Opcional, para carruseles. |
| **Adobe Premiere (iPhone)** | Gratis (IA con créditos) | Editor multicapa más fino. | Solo si Edits se queda corto. |
| **CapCut** | Gratis / ~US$10–20 | Plantillas, subtítulos, IA. | **No para BLARQ**: sus términos le dan derechos amplios sobre el contenido, **su música no trae licencia comercial**, y algunas plantillas dejan marca de agua — Instagram baja el alcance de los reels con marcas de agua de otras apps. |
| Captions, Submagic, Opus Clip, Descript, VEED | US$10–50/mes | Subtítulos animados, cortar videos largos, editar desde la transcripción. | No hacen falta: Edits ya subtitula y BLARQ no tiene videos largos que cortar. |
| **Programar** | Gratis | Instagram programa reels hasta 75 días antes (cuentas profesionales); Meta Business Suite también. | Suficiente. |
| Metricool / Buffer / Later | US$0–25/mes | Programar en varias redes y reportes. | Solo si se suma TikTok/LinkedIn. Metricool gratis sirve para reportes. |

**Música.** Una cuenta de empresa solo tiene acceso a la biblioteca de audio comercial de Meta (~14.000
temas). El audio en tendencia de sellos grandes no aparece, y usarlo por fuera arriesga que silencien
el reel. Mejor así: el **sonido real de obra** (martillo, sierra, el cajón que cierra) y la **voz de MJ
o JT** son originales, cuestan cero y son justo lo que Instagram premia.

---

## 4. Automatización: qué sí y qué no

**Qué existe.** Plantillas públicas de n8n y Make que vigilan una carpeta de Google Drive, escriben el
caption con IA y publican el reel por la API de Instagram. La API pide cuenta profesional y permite
hasta 50 publicaciones al día. Trampa documentada: desde 2025 Meta exige un link público directo al
archivo, **los links de Drive ya no sirven** y hay que pasar por otro servicio (Cloudinary). Además hay
que crear una app de desarrollador en Meta y renovar credenciales.

**Qué conviene automatizar**:
- Convertir el material a algo que la IA pueda leer (script `preparar-material.sh`, ya hecho).
- El corte en bruto del reel según el plan aprobado (script `armar-borrador.sh`, ya hecho).
- Subtítulos (Edits los hace solo).
- Borradores de caption, plan semanal, recordatorio de qué grabar.
- Programar la publicación (nativo de Instagram).

**Qué NO conviene automatizar**:
- Elegir las tomas y el gancho — es criterio y es lo que decide si el reel funciona.
- Publicar sin que MJ lo vea.
- Cualquier dato de plazo, costo o metros.
- Responder comentarios y DMs — ahí está la venta.

**Sobre Remotion** (librería para hacer videos con código, muy usada con Claude Code en 2026): exige
licencia pagada a empresas de 4 o más personas (según su página de precios, no verificado para el caso
de BLARQ). Los scripts de la skill usan solo **ffmpeg**, que es gratis, para no entrar en eso.

---

## 5. Cómo funciona Instagram hoy (sept 2026)

| Tema | Qué se sabe | Qué hacer |
|---|---|---|
| **Qué mide** | Según Adam Mosseri (jefe de Instagram): tiempo de visualización, **envíos por DM por alcance** y likes por alcance. Los envíos pesan más para llegar a no seguidores. | Pensar cada reel como algo que alguien le mandaría a su pareja o a su arquitecto: "mira, así podríamos hacer la cocina". |
| **Originalidad** (desde 2026-04-30) | Las cuentas que publican contenido ajeno o reciclado dejan de recomendarse a no seguidores. Se amplió a fotos y carruseles. Las marcas de agua de otras apps se detectan. | Todo propio, nada de stock ni plantillas con marca. El material de obra de BLARQ es 100 % original: ventaja. |
| **Hashtags** | **Máximo 5 por publicación** (anunciado por @creators el 2025-12-19). Ayudan a clasificar, no a llegar más lejos. | 3 a 5 específicos. Lo que importa es el texto. |
| **Búsqueda** | El caption, el texto en pantalla, el alt text y lo que se dice en voz cuentan como palabras clave. Desde 2025-07-10 las cuentas profesionales pueden aparecer en Google. | Captions descriptivos: "remodelación de cocina en [comuna]", "closet a medida". Activar la opción de aparecer en buscadores en la configuración. |
| **Duración** | Hasta 3 min se recomiendan a no seguidores; más largos no. No hay duración ideal: importa que sigan viendo. | Entre 7 y 30 s la mayoría; 45–60 s si hay voz contando algo. |
| **Formato** | Reel 9:16 (1080×1920). La grilla del perfil muestra 3:4. | Dejar textos importantes en la franja central. |
| **Reels vs carruseles** | Engagement parecido; los reels llegan a más gente nueva. | Reels para crecer, carruseles para convencer (proceso completo, planos, antes/después foto a foto). |
| **Trial reels** | Reels que se muestran primero solo a no seguidores, sin aparecer en la grilla. Requiere cuenta profesional; el mínimo de seguidores no está claro (200 o 1.000, no verificado). | Si @estudio_blarq lo tiene, usarlo para probar dos ganchos distintos del mismo reel. |
| **Etiqueta de IA** | Aparece si el contenido es generado con IA (Instagram la detecta por metadatos). Editar con IA o escribir el caption con IA no la activa. | No usar video generado para obra real. |
| **Frecuencia** | Estudio de Buffer (2 millones de posts): 3–5 publicaciones por semana más que duplican el crecimiento frente a 1–2. | Meta realista: **3 por semana** (2 reels + 1 carrusel), más historias de obra sin producción. |
| **Tendencia 2026** | Memo de fin de año de Mosseri: lo pulido se puede falsificar con IA; lo real e imperfecto pasa a ser señal de confianza, y la confianza depende de quién publica. | Celular, obra real, caras reales. Es exactamente lo que BLARQ tiene. |

---

## 6. Referentes

Instagram no se deja leer desde fuera: los datos salen de buscadores, prensa y sitios de los estudios.
Las cifras de seguidores pueden tener meses de atraso.

### @estudio_blarq

La cuenta aparece como "BLARQ | Arquitectura y Construcción", sin cifras visibles para el buscador.
**Ojo: aparece también `@blarqestudio` con el mismo nombre exacto** — puede ser un usuario antiguo que
el buscador guardó o un perfil duplicado; revisarlo. Además hay varios "BLARQ/Blaq" parecidos (Blaq
Arquitectos, @blarq.estudio con ~4.900 seguidores que parece ser otra empresa) y el buscador llegó a
confundirlos. La bio tiene que decir qué hacen y dónde ("Arquitectura + construcción · Santiago") y
quién da la cara.

### Los que MJ conoce

| | @lekker.cl | @vista_norte_ |
|---|---|---|
| Qué es | Muebles a medida (cocinas, baños, closets, quinchos), empresa familiar. | "Vista Norte by Paulina Bustos Arq.": remodelaciones integrales llave en mano, diseño sobrio. |
| Qué hacen bien | Un post por proyecto con nombre de lugar; argumentos técnicos (material, herraje Blum). | La persona está en el nombre; promesa clara (un solo responsable de diseño y obra); tono sobrio. |
| Parecido con BLARQ | Solo la parte muebles/cocinas. | **El espejo más directo**: mismo modelo diseño + obra, misma estética. |

### Chile

| Cuenta | Qué hace bien | Formato para copiar |
|---|---|---|
| @cristobalmontt (TikTok, Constructora Vicam) | Remodelaciones en terreno, personaje fijo (su perro "Rubén el inspector"), "todo queda documentado". | Un problema de obra resuelto, con algo que se repite. |
| @marioormenoarquitecto (TikTok) | Antes/después y serie "PARTE 2" de una casa en mal estado. | Serie por capítulos de una obra. |
| @estudio.nalca (~20K) | Nicho claro (casas del sur) y contenido que responde lo que el cliente busca en Google. | Pieza que responde una pregunta concreta. |
| @arquitecturalibre.cl | Dos socios, proyectos con nombre de lugar. | Dos socios + proyecto con nombre. |

### Latinoamérica y España

| Cuenta | País | Qué hace bien | Formato para copiar |
|---|---|---|---|
| **@formas_cocinas** (~537K) | España | Empezó grabando las cocinas que instalaba. Diseño **y montaje**, más un consejo sacado del proyecto. | **El más parecido a BLARQ en muebles**: del plano al mueble instalado + un consejo. |
| @juve3dstudio (millones en TikTok) | México | Arquitecto a cámara con opinión, costos, errores propios, humor. | Cara + opinión + números. |
| @reformagenz (~406K) | España | La reforma de una ruina contada como serie con final abierto. | Serie numerada. |
| @todosobrereformas (~238K) | España | Explicación técnica corta en obra, "trato de hacerlo sencillo". | "Por qué se hace así". |
| @puntoyseguidoestudio (~49K) | España | Una opinión fuerte como primera frase. | Gancho de opinión. |
| Bauhasaurus (Alejandro Csome) | Argentina | Responde preguntas del público en video. | Responder comentarios con un video. |

### Internacionales

| Cuenta | País | Qué hace bien |
|---|---|---|
| @threebirdsrenovations (~1M) | Australia | Tres amigas; revelación del antes/después + "cómo lo hicimos". Crecimiento sostenido por años. |
| Matt Risinger / Build Show (YouTube, 1,2M+) | EE.UU. | Constructor que explica en su obra por qué se construye así. Según David Meerman Scott, el canal ayudó a llevar su empresa de 0 a US$20M. |
| 30X40 Design Workshop (YouTube, 1M+) | EE.UU. | Arquitecto que muestra cada paso del diseño de casas simples. |
| Pask Makes (YouTube 1,2M+) | Australia | Proceso completo de taller con sonido real. |
| Caso Business of Home | EE.UU. | Una interiorista con una serie temática en TikTok: 40K seguidores en 3 meses y agenda llena por un año. |

### Patrones que se repiten en las cuentas que crecen

| Patrón | Por qué funciona | Qué grabar |
|---|---|---|
| Antes/después con transición | Se entiende sin sonido, se guarda. | Mismo encuadre exacto (puntos fijos). |
| Serie por capítulos de una obra | La gente vuelve a ver cómo sigue. | Un clip por etapa, título "Obra X · 03". |
| Fundadora/socio a cámara con opinión | Se confía en personas, no en logos. | 30–45 s, una idea, la opinión en la primera frase. |
| Consejo sacado de un proyecto real | Le sirve justo a quien está por remodelar. | Plano + caso + resultado. |
| "¿Cuánto cuesta?" | Es la primera pregunta del cliente y casi nadie la responde con números. | Rangos por m² o por partida en pantalla. |
| Por qué se hace así (técnica) | Da autoridad; separa a un estudio de un maestro chasquilla. | Un detalle: impermeabilización, aislación, pendiente. |
| Errores y lecciones | La honestidad se comparte. | "Lo que cambiaríamos", "el error que encontramos al llegar". |
| Taller y detalle con sonido real | Satisfacción visual, muestra el material. | Corte, canto, herraje, cajón que cierra. |
| Reacción del cliente | Prueba social con emoción. | El cliente entrando por primera vez. |

### Huecos que BLARQ puede ocupar en Chile

No se encontró a nadie en Chile haciendo esto:

1. **Diseño + obra + mueble a medida en una sola historia**, del croquis al mueble instalado. Vista
   Norte cubre dos de las tres; Lekker, una.
2. **Números reales.** Nadie en Chile muestra "cuánto costó de verdad". BLARQ tiene esos datos en su
   propia app (cobrado y gastado por proyecto): rangos por m², desviación del presupuesto, plazo
   previsto vs. real. Sin mostrar utilidad ni datos de un cliente sin su permiso.
3. **Los maestros con nombre y oficio.** "Ponerle cara a la construcción" literal: el carpintero o el
   ceramista explicando un detalle. Con su consentimiento.
4. **Proceso con estética editorial.** Casi todo el contenido de obra se ve desordenado. Portadas
   tipográficas siempre iguales, series numeradas, video en color natural (los materiales tienen que
   verse como son).
5. **Técnica pensada para Chile**: humedad y condensación, sismo, permisos en la DOM, recepción final.
   Un creador mexicano o español no responde eso.
6. **Los dos socios a cámara**: la mirada de diseño (MJ) y la de obra (JT). Solo si JT quiere.

---

## 7. Creadores que enseñan a usar IA para contenido

Ninguno trabaja el caso exacto de BLARQ (obra real → reel). Se encontraron flujos parciales que sirven
de referencia:

| Quién | Idioma | Qué enseña | Qué le sirve a BLARQ |
|---|---|---|---|
| **Sabrina Ramonov** (sabrina.dev, fundadora de Blotato) | Inglés | Sistema de redes con IA: Claude + Canva con el conector oficial, Claude Code + Remotion para video. | Su flujo Claude + Canva para carruseles. |
| **LearnWithHasan** (learnwithhasan.com) | Inglés | Claude Code + ffmpeg + whisper: carpeta de brutos → video editado con subtítulos. | Es la misma idea de la skill `contenido-reels`. |
| **Nate Herk** (YouTube @nateherk) | Inglés | Agentes en n8n sin código; un agente que detecta qué videos funcionan en un nicho. | La lógica de revisar cada mes qué funciona en cuentas de arquitectura. |
| **Xavier Mitjana** (YouTube @XavierMitjana) | Español | IA para creatividad y negocio; tutorial ChatGPT + Canva + Photoshop para redes. | Base para carruseles. |
| **Vilma Núñez** (@vilmanunez) | Español | Marketing con IA sin perder la voz propia. | Alimentar a la IA con textos reales de BLARQ para que no suene genérica. |
| **Alejavi Rivera** (@alejavirivera) | Español | Herramientas de IA para imagen y video. | Ideas de herramientas; filtrar mucho. |
| **David Parra** (@bydavidparra, ~40K) | Español, arquitecto | IA para arquitectos (ChatGPT + renders). | Caso de arquitecto que creció en redes con criterio propio. |
| **Luciano Marchisio** (@web_arq) | Español (Argentina) | Marketing para arquitectos "de likes a clientes" (no es de IA). | Su tesis: el cliente no elige por la grilla más linda, elige porque entiende cómo lo ayudás y confía. |

**Arquitectos usando IA en marketing:** lo que se encuentra es IA para diseñar y renderizar (Tim Fu,
Londres, ~270K), no para contar obra. Las herramientas que prometen "tu portafolio en posts automáticos"
(Apaya y similares) son páginas de venta sin casos verificables. **No se encontró ningún estudio que
documente un flujo "fotos de obra → IA → reel". El espacio está libre.**

**En Chile** no aparecieron educadores de IA + contenido para arquitectura o pymes. No prueba que no
existan, solo que no salieron.

---

## 8. El flujo recomendado

### Día a día (celular, sin Mac)

1. **Grabar en obra** con la pauta ([pauta-de-grabacion-obra.md](pauta-de-grabacion-obra.md)). Esto
   lo tiene que conocer **JT también**: él está en terreno más seguido que MJ.
2. **Seleccionar** al final de la visita: borrar lo movido y lo repetido.
3. **Mandar al partner** (Gem "Partner BLARQ" en la app de Gemini): los clips y fotos + una línea de
   contexto ("Obra X, demolición, apareció una viga de roble").
4. El partner responde: **inventario, 2–4 propuestas con toma por toma, lo que falta grabar, crítica**.
5. **Armar en Edits** siguiendo la propuesta: cortes, texto en pantalla (siempre la misma tipografía),
   sonido de obra o voz.
6. **Programar** desde Edits/Instagram.
7. **Una vez al mes**: capturas de las Estadísticas al partner → qué funcionó, qué cambiar.

### Modo producción (Mac, cuando hay material acumulado)

1. Pasar la carpeta de la obra al Mac (AirDrop o Fotos compartidas).
2. En Claude Code: "revisá el material de la obra X" → la skill `contenido-reels` prepara el material,
   lo analiza y propone.
3. MJ aprueba una propuesta → Claude arma el **borrador MP4 vertical** con los cortes.
4. MJ lo abre en Edits: texto, música, portada, programar.

Requisito único en el Mac: `brew install ffmpeg`.

### Tiempo estimado

~2–3 horas por semana para 3 publicaciones, una vez que el flujo está andando. Las primeras semanas
más, porque hay que definir la tipografía, las portadas y el tono.

---

## 9. Otras palancas para crecer (más allá de la IA)

1. **Caras.** MJ y JT hablando 15–20 segundos a cámara: por qué se abrió la cocina, qué salió mal,
   cuánto cuesta un closet a medida. Es lo que más cuesta y lo que más rinde.
2. **Colaboraciones** (publicación compartida entre dos cuentas): con el mueblista, con proveedores
   (Kitchen House, MK, la marca del porcelanato), con el cliente si quiere. El reel aparece en ambos
   perfiles y llega a la audiencia de los dos.
3. **Series con nombre**: "Obra en 30 segundos" (semanal), "Lo que no se ve" (instalaciones antes de
   cerrar), "Render vs. realidad", "¿Cuánto cuesta?". Una serie baja el esfuerzo de pensar y
   acostumbra a la audiencia.
4. **Fotografía profesional al cierre de cada obra.** El "después" es la pieza que más se va a ver y
   la que se usa para la web y el portafolio. Un fotógrafo de arquitectura una vez por obra, más el
   proceso en celular, es la mezcla que usan los estudios que crecen.
5. **Autorización del cliente en el contrato.** Una cláusula corta (o un WhatsApp de confirmación)
   para mostrar la obra. Sin eso no hay contenido.
6. **Aprovechar el mismo video en otras redes.** Edits exporta limpio: el mismo reel sirve para TikTok,
   YouTube Shorts y Pinterest (el interiorismo tiene mucho tráfico ahí). LinkedIn para JT si se apunta
   a proyectos más grandes (SIP, construcción menor).
7. **Kit mínimo** (~US$100–200): trípode chico con pinza, micrófono inalámbrico de solapa, cinta de
   enmascarar para los puntos fijos.
8. **Los números de la propia app.** BLARQ ya registra lo presupuestado, lo cobrado y lo gastado por
   proyecto. Una serie "¿Cuánto cuesta?" con rangos reales (por m², por tipo de recinto) es algo que
   nadie hace en Chile y que el cliente busca. Decidir con MJ el nivel de detalle; nunca utilidad ni
   datos de un cliente identificable.

---

## 10. Primeras 4 semanas

| Semana | Qué |
|---|---|
| 0 (setup) | Confirmar que @estudio_blarq es cuenta **profesional de empresa**. Activar "aparecer en buscadores". Crear el Gem "Partner BLARQ" con las instrucciones (completar los `[...]`). Instalar Edits. Elegir **una** tipografía y un estilo de texto en pantalla (sugerencia: la de títulos de la marca, mayúsculas espaciadas, blanco o negro sin fondo de color). Marcar puntos fijos en las obras activas. Compartir la pauta con JT. |
| 1 | Primer reel: el antes/después más fuerte que ya exista (aunque no tenga puntos fijos perfectos). Un carrusel de proceso de una obra terminada. Un reel de MJ o JT a cámara (15 s, una decisión de diseño). |
| 2 | Arrancar la serie "Obra en 30 segundos" con una obra activa. Un reel de detalle/oficio (mueble a medida, cajón que cierra). Un carrusel. |
| 3 | Probar dos ganchos distintos del mismo reel (trial reels si están disponibles). Primera colaboración con un proveedor o el mueblista. |
| 4 | Primera revisión mensual con el partner. Decidir qué formato se repite y cuál se abandona. Evaluar si el cupo gratis de Gemini alcanza o conviene AI Pro. |

---

## 11. Lo que no sé y hay que confirmar

- El estado actual de @estudio_blarq (seguidores, qué ha funcionado) y si `@blarqestudio` es un
  perfil duplicado.
- Decisiones de MJ: quién da la cara (MJ sola, MJ + JT, también los maestros); si se muestran números
  reales y con qué detalle; con qué obra partir la primera serie.
- Si Edits exporta sin marca de agua sigue siendo verdad al usarlo (las fuentes de 2026 dicen que sí).
- Precio de Google AI Pro en Chile y si Veo/Omni están disponibles en Chile.
- Mínimo de seguidores para trial reels.
- Si el cupo gratis de Gemini (~5 min de video por consulta) alcanza para una visita típica.
- Datos que solo MJ tiene: comunas donde trabajan, cliente ideal, diferencial (van en las instrucciones
  del partner).

---

## 12. Segunda ronda (2026-09-26) — preguntas de MJ

**¿Se puede conectar Gemini a Claude Code para los videos, como Nano Banana para los renders?** Sí, y
es mejor que lo recomendado en §1 para el trabajo en el Mac (se me pasó en la primera ronda). La API de
Gemini recibe un video y lo analiza con imagen y audio, citando segundos (formato MM:SS; muestrea 1
cuadro por segundo y el audio completo). Un script dentro de la skill `contenido-reels` le mandaría cada
clip a Gemini y Claude recibiría la descripción y la transcripción con tiempos: Claude deja de estar
"sordo y viendo solo 12 cuadros". Costo estimado con un modelo Flash: centavos de dólar por visita (no
verificado con la tarifa vigente). **Ojo**: en el nivel gratuito de la API, Google puede usar lo que se
sube para mejorar sus productos; con casas de clientes, usar una clave con facturación activa. Veo
(video generado) también está en la API, cobrado por segundo, solo para animar renders.
Fuentes: https://ai.google.dev/gemini-api/docs/video-understanding

**"Claude me edita en CapCut" (lo que se ve en TikTok).** No existe integración oficial: CapCut no
tiene API pública de edición. Lo que hay son tres caminos:
1. **Servidores MCP comunitarios** (sobre el proyecto abierto VectCutAPI/CapCutAPI) que escriben un
   **borrador de proyecto de CapCut** en el disco: Claude pone los clips, cortes, textos y subtítulos, y
   el proyecto aparece en CapCut de escritorio para terminarlo a mano. Es lo que muestran la mayoría de
   los videos. Ventaja real frente al MP4 de `armar-borrador.sh`: la línea de tiempo queda editable. En
   contra: el formato de CapCut es propietario y sin documentación (puede romperse con cada
   actualización), requiere dejar corriendo un servidor en Python, y siguen los problemas de CapCut
   (música sin licencia comercial, términos). Fuentes:
   https://github.com/sun-guannan/VectCutAPI · https://aituber.app/blog/capcut-mcp-claude/ ·
   https://note.com/usuke_work/n/n70d11cc63422?hl=en
2. **Claude manejando el computador** (Cowork / uso del computador): Claude hace clic en la app de
   CapCut. Posible, pero lento y frágil para una línea de tiempo.
3. **Claude en Chrome** (extensión disponible para planes pagados desde 2026-08-26) sobre el editor web
   de CapCut. No encontré a nadie haciéndolo bien.

**¿Las historias sirven para crecer?** No para ganar seguidores: Instagram las muestra sobre todo a
quienes ya siguen la cuenta. Sirven para mantener la relación y para que escriban por DM (ahí está la
venta), y las destacadas por obra funcionan de portafolio para quien entra al perfil. Lo práctico: el
mismo material de las historias, cosido en un reel de 20–30 s una vez por semana ("Obra en 30
segundos"), sí llega a gente nueva.

**Sin cara a cámara.** No es grave; en arquitectura la obra puede ser la protagonista. Progresión
sugerida: fotos y video con texto en pantalla → manos y espaldas (MJ dibujando, JT midiendo) → voz en
off sin cara → cara cuando den ganas. Con fotos: carruseles antes/después y reels de fotos con
acercamiento lento (ya lo hace `armar-borrador.sh`), idealmente con uno o dos clips de video.

**Por qué los números reales.** Es la primera pregunta de un cliente ("¿cuánto sale?"): el contenido
que la responde atrae gente que de verdad está por remodelar, filtra a quien no le calza el presupuesto
(menos cotizaciones que no llegan a nada), da confianza y se guarda y se reenvía (la señal que más pesa
para llegar a gente nueva). Riesgos: la competencia lo ve, el cliente se ancla a un número, los precios
cambian. Es opcional. Versiones suaves: "en qué se va la plata de una cocina" (reparto en % entre
muebles, artefactos y obra), "qué encarece un baño", "desde $X". Nunca utilidad ni clientes
identificables.

## Fuentes principales

Consultadas el 2026-09-25 (fecha de publicación entre paréntesis cuando se conoce).

**Herramientas**
- OpenAI, cierre de Sora (2026-03-24): https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation · https://www.axios.com/2026/03/24/openai-discontinue-sora-video-app
- OpenAI, subida de archivos: https://help.openai.com/en/articles/8555545-file-uploads-faq
- Claude, subida de archivos (sin video): https://support.claude.com/en/articles/8241126-upload-files-to-claude
- Conectores creativos de Claude (2026-04-28): https://www.anthropic.com/news/claude-for-creative-work
- Adobe for ChatGPT (2026-08-06): https://blog.adobe.com/en/publish/2026/08/06/introducing-adobe-chatgpt-create-edit-get-work-done-all-in-chatgpt
- Gemini, subir archivos y video: https://support.google.com/gemini/answer/14903178
- Veo 3.1: https://ai.google.dev/gemini-api/docs/veo
- Edits (2026-06-11): https://techcrunch.com/2026/06/11/metas-edits-app-is-getting-an-ai-assistant-and-a-desktop-version/ · https://apps.apple.com/us/app/edits-video-editor/id6738967378
- CapCut, términos: https://www.capcut.com/clause/terms-of-service
- Música en cuentas de empresa: https://www.facebook.com/business/help/402084904469945
- Remotion, licencia: https://www.remotion.dev/docs/license/pricing
- API de publicación de Instagram: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Plantillas n8n / Make: https://n8n.io/workflows/3478-automate-instagram-posts-with-google-drive-ai-captions-and-facebook-api/ · https://www.make.com/en/templates/12936-create-and-share-engaging-instagram-reels-from-your-business-media

**Instagram**
- Límite de 5 hashtags (2025-12): https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/ · https://www.digitaltrends.com/social-media/instagram-now-limits-you-to-five-hashtags-per-post/
- Trial reels: https://creators.instagram.com/blog/instagram-trial-reels
- Originalidad (2026-04-30): https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/
- Indexación en Google (2025-07): https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/
- Etiquetado de IA: https://transparency.meta.com/governance/tracking-impact/labeling-ai-content/
- Memo de Mosseri (2026-01-01): https://om.co/2026/01/01/what-is-instagrams-adam-mosseri-really-saying-in-his-year-end-memo/
- Frecuencia (estudio Buffer): https://www.socialmediatoday.com/news/study-shows-posting-more-instagram-leads-to-more-reach/757633/
- Benchmarks Q2-2026: https://www.socialinsider.io/social-media-benchmarks/instagram

**Referentes**
- https://www.lekker.cl/quienessomos · https://ruasalon.cl/vista-norte-diseno-con-intencion-construccion-con-oficio/
- https://viralfactory.es/de-0-a-280-000-seguidores-ensenando-cocinas-en-instagram-ep-6-miguel-gomez-formas-cocinas/
- https://www.univision.com/entretenimiento/cultura-pop/tiktoker-diego-alvarado-juve-3d-studio-videos-virales-arquitectura
- https://www.tiktok.com/@reformagenz/video/7461957309388934432
- https://estudionalca.cl/construir-casa-sur-chile/
- https://www.threebirdsrenovations.com/about
- https://www.davidmeermanscott.com/blog/how-a-youtube-channel-grows-business-to-20-million
- https://thirtybyforty.com/about
- https://businessofhome.com/articles/looking-for-clients-on-tiktok-try-this-designer-s-strategy

**Creadores**
- https://www.sabrina.dev/p/claude-canva-design-and-post-everywhere
- https://learnwithhasan.com/guide/claude-code-video-editing/
- https://www.nateherk.com/about
- https://vilmanunez.substack.com/p/como-cocrear-con-ia-sin-perder-tu
- https://lucianomarchisio.com/curso-de-marketing-para-arquitectos/
- https://dparra.com/
