// Generador del documento de contexto BLARQ.
// Estética blanco/negro/gris, sans, denso, sin emojis.
//
// Uso: node scripts/generate-context-doc.js
// Salida: ~/Desktop/BLARQ-contexto.docx
//
// Vive en repo (no en /tmp) para poder re-generar el doc cuando algo
// estructural cambia. Cuando MJ pida actualizar el doc de contexto del
// Project de Claude.ai, editar este archivo y volver a correr.

const fs = require("fs");
const path = require("path");

// Resolver docx desde donde sea — en /tmp/node_modules o repo node_modules.
let docxPath;
try { docxPath = require.resolve("docx"); }
catch {
  try { docxPath = require.resolve("/tmp/node_modules/docx"); }
  catch { docxPath = "/tmp/node_modules/docx"; }
}
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
} = require(docxPath);

// ---- helpers ----
const SANS = "Helvetica";
const GRAY_LIGHT = "F5F5F5";
const GRAY_MID = "D0D0D0";
const GRAY_DARK = "707070";
const BLACK = "000000";

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: GRAY_MID };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 100 },
    alignment: opts.align,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size ?? 20, color: opts.color ?? BLACK, font: SANS })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, size: 32, font: SANS })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, font: SANS })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 },
    children: [new TextRun({ text, bold: true, size: 22, font: SANS })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, font: SANS })],
  });
}

function bulletKV(label, rest, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: [
      new TextRun({ text: label, bold: true, size: 20, font: SANS }),
      new TextRun({ text: " — " + rest, size: 20, font: SANS }),
    ],
  });
}

function cell(text, opts = {}) {
  const widthDxa = opts.width;
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text: String(text), bold: opts.bold, size: 18, font: SANS, color: opts.color ?? BLACK })];
  return new TableCell({
    borders: cellBorders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: opts.header ? { fill: GRAY_LIGHT, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: opts.align, children: runs })],
  });
}

function simpleTable(rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, idx) => new TableRow({
      tableHeader: idx === 0,
      children: r.map((text, i) => cell(text, { width: widths[i], header: idx === 0, bold: idx === 0 })),
    })),
  });
}

// ---- contenido ----

const children = [];

// Portada
children.push(
  new Paragraph({
    spacing: { before: 1200, after: 400 },
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: "BLARQ", bold: true, size: 56, font: SANS })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: "Documento de contexto", size: 28, font: SANS })],
  }),
  new Paragraph({
    spacing: { after: 1200 },
    children: [new TextRun({ text: "Síntesis del negocio, la app y las decisiones de diseño que rigen ambos. Pensado como archivo base para sesiones de Claude.ai en el Project del estudio.", size: 22, color: GRAY_DARK, font: SANS })],
  }),
  new Paragraph({
    children: [
      new TextRun({ text: "Generado: ", size: 18, color: GRAY_DARK, font: SANS }),
      new TextRun({ text: "2026-05-04", size: 18, font: SANS }),
    ],
  }),
  new Paragraph({
    children: [
      new TextRun({ text: "Versión: ", size: 18, color: GRAY_DARK, font: SANS }),
      new TextRun({ text: "1.1", size: 18, font: SANS }),
    ],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({ text: "Cambios v1.1: ", size: 16, color: GRAY_DARK, font: SANS, italics: true }),
      new TextRun({ text: "tres tareas del Sprint 1 (A1, A2, A3) ya estaban implementadas en código y se sacan del plan. Nueva UI de cambio de estado del proyecto (menú \"...\" en header y tabla). Conversación de paleta de colores abierta (revisión con Claude.ai design pendiente).", size: 16, color: GRAY_DARK, font: SANS, italics: true }),
    ],
  }),
  new Paragraph({
    children: [
      new TextRun({ text: "Fuente: ", size: 18, color: GRAY_DARK, font: SANS }),
      new TextRun({ text: "/docs/ del repo blarq-app + estado actual de la BD prod (Neon).", size: 18, font: SANS }),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// 1. Identidad de BLARQ
children.push(h1("1. Identidad de BLARQ"));

children.push(h2("Qué es"));
children.push(p("BLARQ es un estudio chileno que hace remodelaciones de casas y departamentos, con foco en cocinas, baños y closets. Volumen reciente con apertura a obras de construcción menor (paneles SIP). Lo arman dos socios igualitarios."));

children.push(h2("Personas"));
children.push(bulletKV("María José Blanco (MJ)", "arquitecta, dueña del estudio. Lidera muebles, interiorismo y terminaciones. Es la usuaria principal de la app y quien construye este sistema apoyándose en IA. No es desarrolladora."));
children.push(bulletKV("José Tomás Larraín (JT)", "arquitecto con expertiz en obra y supervisión. Socio igualitario. Lidera obra y construcción, supervisa terreno. Lee la app, entra con su email."));
children.push(bulletKV("Juan Pablo (JP)", "arquitecto jr. del estudio. Hace cubicaciones y dibujos. Sin acceso al sistema financiero por ahora; se le dará acceso limitado a presupuesto cuando exista el rol colaborador."));
children.push(bulletKV("Maestros", "tres cuadrillas activas. Una factura formalmente, dos son informales. Reciben sus Estados de Pago como PDF entregado por JT. Los maestros NO usan la app."));

children.push(h2("Tipo de proyectos"));
children.push(p("Volumen típico: cuatro proyectos en obra activa en paralelo, más cotizaciones rotando. Cada proyecto entrega tres documentos al cliente — Obra, Muebles y Artefactos — separados, con responsables y formas de cobro distintas."));

children.push(simpleTable([
  ["Documento", "A cargo", "Lógica de precio", "Cuotas típicas"],
  ["Obra", "JT", "Costo directo + GG (20%) + utilidad (5–10%) + IVA", "40 / 25 / 25 / 10"],
  ["Muebles", "MJ", "Mueble + cubiertas + herrajes. Utilidad implícita, no declarada.", "60 / 30 / 10"],
  ["Artefactos", "MJ", "Precios mercado menos descuentos de proveedor.", "Variables"],
], [1900, 900, 4900, 1326]));
children.push(p("", { after: 100 }));
children.push(p("El formato de los PDFs replica el Excel V3 que BLARQ usaba antes de la app (referencia: V3 Cristian Lefevre, abril 2026).", { italics: true, color: GRAY_DARK }));

children.push(h2("Forma de operar"));
children.push(p("El flujo comercial de BLARQ es relacional, no de embudo masivo:"));
children.push(bullet("Lead llega por referido o Instagram."));
children.push(bullet("Reunión presencial — se construye confianza."));
children.push(bullet("Levantamiento (planos / medidas en obra)."));
children.push(bullet("Cotización V1 separada en los tres documentos."));
children.push(bullet("Ida y vuelta con el cliente (V2, V3...) hasta aprobación."));
children.push(bullet("Cotización aprobada equivale a contrato — letra chica liviana, no muy formalizada."));
children.push(bullet("Ejecución: facturas de proveedores + EPs a maestros + cobros del cliente."));
children.push(bullet("Cierre: terminado, archivo."));

// 2. Negocio
children.push(h1("2. El negocio modelado por la app"));

children.push(h2("Numeración paralela cotización ↔ proyecto"));
children.push(p("Cada proyecto vive primero como cotización y, si se aprueba, recibe número de proyecto. Son dos contadores monotónicos paralelos, ambos correlativos, ninguno se reusa. La memoria espacial del estudio funciona por número, no por nombre: MJ y JT recuerdan los proyectos como “el 60 es Portofino, el 61 es Lefevre”."));
children.push(bullet("numeroCotizacion se asigna al crear el proyecto. Lo recibe todo lead que entra al embudo."));
children.push(bullet("numeroProyecto se asigna al pasar a estado ejecucion."));
children.push(bullet("Una cotización rechazada conserva su numeroCotizacion y queda con numeroProyecto en null."));
children.push(bullet("Centros de costo internos (BLARQ entidad, autos, gastos generales) tienen ambos en null y se distinguen con isInternal=true."));

children.push(h2("Estados del proyecto"));
children.push(simpleTable([
  ["Estado", "Significado", "Dónde aparece"],
  ["cotizacion", "En etapa comercial. No aprobado aún.", "/cotizaciones"],
  ["ejecucion", "Cotización aprobada, obra en curso.", "/proyectos"],
  ["terminado", "Obra entregada.", "Archivado, sin tracking activo"],
  ["archivado", "Cancelado o dropeado.", "Oculto por default"],
], [1700, 4500, 2826]));
children.push(p("", { after: 80 }));
children.push(p("Legacy: el valor aprobado se renombró a ejecucion en migración 2026-04-28. El estado en la app mapea al estado de la carpeta en Drive de MJ (1- Cotizaciones / 2- Proyectos / 3- Proyectos Terminados).", { italics: true, color: GRAY_DARK }));
children.push(p("El cambio de estado se hace desde la app: en el detalle del proyecto y en cada fila de la tabla de proyectos hay un menú \"...\" con \"Marcar como terminado\" (si está en ejecución) o \"Reabrir proyecto\" (si está terminado). Implementado 2026-05-04."));

children.push(h2("Cobro al cliente"));
children.push(p("Importante: en BLARQ el cliente paga primero y la factura se emite después. La factura emitida (DTE 33) es prácticamente un comprobante de pago ya recibido, no una cuenta por cobrar."));
children.push(bullet("totalCobrado = suma de facturas emitidas. Lo facturado es semánticamente lo cobrado."));
children.push(bullet("No tiene sentido en este contexto sugerir tracking de “facturas emitidas pendientes de cobro”."));
children.push(bullet("Cuando un cliente paga en cuotas, BLARQ emite una factura por cuota cobrada."));
children.push(bullet("La emisión de facturas hoy se hace en Maxxa (sistema externo, sin API). La salida de Maxxa hacia emisión propia desde la app es decisión pendiente."));

children.push(h2("Pago a maestros — Estados de Pago"));
children.push(p("El EP es el documento operativo que BLARQ paga al maestro contra avance. Reemplaza la hoja MANO OBRA del Excel V3."));
children.push(bullet("El maestro NO ve precios ni márgenes. Solo partida, unidad, cantidad, % avance, monto a pagar al precio de mano de obra interno."));
children.push(bullet("La cantidad ejecutada acumulada es la verdad financiera. El % se deriva. La UI tipea %, internamente se guarda cantidad."));
children.push(bullet("Cada partida tiene descripción dual: una para el cliente (PDF presupuesto) y otra para el maestro (PDF EP)."));
children.push(bullet("Al cerrar un EP los montos se snapshotean inmutables en amountPaid. Si la versión del presupuesto cambia después, los pagos viejos no se recalculan retroactivamente."));
children.push(bullet("La identidad de cada partida sobrevive el cambio de versión gracias a lineageId."));

children.push(h2("BLARQ como centro de costo interno"));
children.push(p("Una práctica explícita del estudio: la app también modela los gastos internos. BLARQ entidad, los autos y gastos generales son “proyectos internos” (isInternal=true) sin numeración. Esto permite que la conciliación bancaria, el control de categorías y el flujo de caja vivan todos en un solo sistema, sin separar “lo del negocio” de “lo de los proyectos”."));

// 3. Vocabulario
children.push(h1("3. Vocabulario y convenciones"));

children.push(h2("Términos del oficio"));
children.push(simpleTable([
  ["Término", "Significado"],
  ["Partida", "Línea ítem del presupuesto Obra (ej: 1.3 RETIRO PISO CERAMICO). Tiene unidad, cantidad y P.U. Internamente es la suma de varios componentes (Material + MO + Margen + ...)."],
  ["Capítulo", "Agrupación de partidas en Obra (DEMOLICIONES, INSTALACIONES, TERMINACIONES, etc.) o de items en Muebles."],
  ["Concepto", "Unidad atómica que compone una partida. Tipos: material, labor (MO), margin, tool, loss, subcontract."],
  ["Versión de presupuesto", "V1, V2, V3. Cada cambio sustantivo genera versión nueva. Histórico inmutable. Identidad de partida estable vía lineageId."],
  ["Mandante", "Sinónimo de cliente del proyecto. El que firma y paga la cotización."],
  ["Maestro", "Cuadrilla de mano de obra. BLARQ tiene tres."],
  ["EP (Estado de Pago)", "Documento periódico (semanal típico) que BLARQ paga al maestro contra avance."],
  ["Cobro parcial", "Una factura pagada en varios movimientos bancarios. Se modela con InvoicePayment many-to-many."],
  ["Centro de costo", "Sinónimo de proyecto en lenguaje contable Maxxa. Cada Project es un CC. BLARQ y autos son CCs internos."],
  ["Fondo Sueldos", "Plata reservada para pagar a los socios, derivada de cobros del cliente. Se calcula proyecto a proyecto."],
], [2100, 6926]));

children.push(h2("Cálculo y montos"));
children.push(simpleTable([
  ["Término", "Significado"],
  ["Costo Directo", "Suma de costos materiales, MO, herramientas, subcontrato y pérdidas del presupuesto Obra. Antes de GG y utilidad."],
  ["GG (Gastos Generales)", "20–25% del Costo Directo. Es lo que se traspasa al fondo sueldos cuando el cliente paga obra."],
  ["Utilidad", "En Obra: 5–10% sobre Costo Directo + GG, declarada al cliente. En Muebles: implícita en cada item, NO declarada."],
  ["MO (Mano de Obra)", "Componente del costo directo. Incluye jornal/maestro + leyes sociales (1%). Columna interna que el maestro no ve."],
  ["IVA", "19% sobre Costo Neto. La app distingue siempre netAmount y totalAmount."],
  ["Neto / c/IVA", "Etiquetas explícitas en la UI tras un bug de cálculo en abril 2026."],
  ["P.U. (Precio Unitario)", "Por unidad de partida. P.U. = Σ (cantidad × precio neto) de los conceptos."],
], [2100, 6926]));

children.push(h2("SII y facturación"));
children.push(simpleTable([
  ["Término", "Significado"],
  ["DTE", "Documento Tributario Electrónico (estándar SII Chile)."],
  ["FE (DTE 33)", "Factura Electrónica afecta a IVA."],
  ["FE Exenta (DTE 34)", "Factura Electrónica Exenta. Sin IVA."],
  ["NC (DTE 61)", "Nota de Crédito. Resta del cobrado/gastado en metrics.ts. Anula o ajusta una factura previa."],
  ["ND (DTE 56)", "Nota de Débito. Suma adicional sobre una factura previa."],
  ["Folio", "Número correlativo asignado por el SII a cada DTE."],
  ["Recibida / Emitida", "Recibida = factura del proveedor hacia BLARQ. Emitida = factura de BLARQ al cliente."],
  ["Origin sii_automatica", "Marca en Invoice.origin para facturas que llegaron por sync SII (no cargadas a mano)."],
  ["Concepto de cobro", "Campo en facturas emitidas: obra | muebles | artefactos | mixto. Define cómo aporta al fondo sueldos."],
], [2100, 6926]));

children.push(h2("Convenciones de naming"));
children.push(bullet("Nombres de proyecto descriptivos: dirección o cliente (ej: Portofino, Lefevre, Francisco de Aguirre, Cocina Las Condes)."));
children.push(bullet("numeroCotizacion y numeroProyecto siempre visibles, son la identidad real del proyecto."));
children.push(bullet("Versiones de presupuesto: V1, V2, V3 (string)."));
children.push(bullet("Identificadores en código: inglés (camelCase) si es la convención del archivo. Nombres de UI, comentarios y commits: español."));
children.push(bullet("Conventional commits en español: feat(facturas):, chore(infra):, fix(banco):."));

// 4. Visión de producto
children.push(h1("4. La app — visión de producto"));

children.push(h2("Propósito"));
children.push(p("Centralizar la operación administrativa y financiera del estudio en un solo sistema. Reemplazar el Excel V3 (cotización + ejecución), absorber lo que hoy hacen Maxxa y planillas paralelas, y dar a los socios un dashboard común sobre cómo va el negocio."));

children.push(h2("Para quién"));
children.push(bulletKV("MJ (admin)", "uso intensivo. Cataloga facturas, arma presupuestos, opera conciliación bancaria, sigue márgenes."));
children.push(bulletKV("JT (admin)", "lectura y operación de obra. Mira KPIs, edita cantidad ejecutada en EPs, supervisa flujo."));
children.push(bulletKV("JP (futuro, rol colaborador)", "presupuesto sin acceso financiero. No implementado todavía."));
children.push(bulletKV("Maestros", "no entran. Reciben PDFs de EP impresos o enviados por mensaje."));

children.push(h2("Qué reemplaza"));
children.push(bullet("El Excel V3 BLARQ (cotización Obra + control de Mano de Obra)."));
children.push(bullet("Maxxa, transitoriamente — la app ya muestra y compara facturas, pero la emisión sigue en Maxxa hasta que se decida proveedor para emitir desde la app."));
children.push(bullet("Planillas paralelas de cobros, pagos y categorías."));
children.push(bullet("La gestión interna de gastos de empresa (BLARQ, autos) que vivía en otras planillas."));

children.push(h2("Qué NO hace la app"));
children.push(bullet("No es contabilidad formal. No reemplaza al contador externo ni emite informes tributarios."));
children.push(bullet("No es CRM. No registra conversaciones con clientes, no manda emails, no agenda reuniones."));
children.push(bullet("No es comunicación con clientes. Los PDFs se generan en la app pero el envío al cliente sigue siendo manual (mail, WhatsApp)."));
children.push(bullet("No es herramienta de planificación de obra. No hay Gantt, no hay calendario, no hay asignación de recursos en el tiempo."));
children.push(bullet("No es gestión de equipo. Los maestros no se loguean, no hay notificaciones, no hay roles operativos."));
children.push(bullet("No emite facturas todavía. Solo lee."));

// 5. Arquitectura
children.push(h1("5. Arquitectura técnica"));

children.push(h2("Stack"));
children.push(simpleTable([
  ["Capa", "Tecnología", "Versión"],
  ["Framework", "Next.js (App Router)", "16.2.3"],
  ["UI", "React", "19.2.4"],
  ["Lenguaje", "TypeScript", "5"],
  ["Estilos", "Tailwind CSS", "4"],
  ["ORM", "Prisma", "6.19"],
  ["BD prod / dev", "Neon Postgres", "branches separados"],
  ["Auth", "NextAuth (Auth.js)", "5.0 beta"],
  ["PDFs internos", "Puppeteer", "render HTML→PDF"],
  ["Sync local SII", "Playwright + node-forge", "mTLS con cert digital"],
  ["Hosting", "Vercel", "Hobby tier, deploy on-push a main"],
], [2400, 4500, 2126]));
children.push(p("", { after: 80 }));
children.push(p("Nota: Next.js 16.2 es posterior a los training datasets de la mayoría de los modelos. Cualquier asistente que dude de un API debe leer node_modules/next/dist/docs/ antes de codear.", { italics: true, color: GRAY_DARK }));

children.push(h2("Estructura de carpetas"));
children.push(bulletKV("/CLAUDE.md", "instrucciones permanentes para asistentes IA. Punto de entrada."));
children.push(bulletKV("/docs/", "documentación viva (architecture, business-model, glossary, principles, decisions/, WIP, CHANGELOG)."));
children.push(bulletKV("/prisma/schema.prisma", "26 modelos. Comentarios in-line del por qué de varios campos."));
children.push(bulletKV("/scripts/", "CLIs (sync SII, backup, compare-vs-maxxa, tests puntuales, imports históricos, generate-context-doc)."));
children.push(bulletKV("/src/app/", "Next App Router. Rutas autenticadas en (dashboard)/, route handlers en api/."));
children.push(bulletKV("/src/components/", "componentes React, organizados por dominio."));
children.push(bulletKV("/src/lib/", "lógica de negocio (ver más abajo)."));
children.push(bulletKV("/public/", "estáticos."));

children.push(h2("Modelo de datos — 26 entidades agrupadas por dominio"));

children.push(h3("Usuarios y proyectos"));
children.push(bulletKV("User", "admin igualitario MJ + JT. Hash bcrypt en password."));
children.push(bulletKV("Project", "núcleo del modelo. numeroCotizacion + numeroProyecto. isInternal para CCs internos. Status: cotizacion | ejecucion | terminado | archivado."));
children.push(bulletKV("Maestro", "equipo de mano de obra. emitsInvoice indica si factura formalmente."));
children.push(bulletKV("PaymentTerm", "cuotas de cobro al cliente (Anticipo / Avance / Saldo)."));

children.push(h3("Presupuesto"));
children.push(bulletKV("BudgetVersion", "V1, V2, V3 por proyecto. Tipo: obra | muebles | artefactos. Lleva ggPercentage y utilityPercentage para Obra."));
children.push(bulletKV("ObraItem", "líneas del presupuesto Obra. lineageId para identidad estable a través de versiones. Desglose interno por costMaterial / costLabor / costMargin / etc."));
children.push(bulletKV("MuebleChapter", "capítulos de muebles (cocina, closet, walk-in)."));
children.push(bulletKV("MuebleItem", "items dentro de un capítulo (mueble, herrajes, cubiertas). Cálculo interno con costDistributor + utilityPercentage."));
children.push(bulletKV("MuebleQuote", "cotizaciones alternativas para un MuebleItem (compara proveedores). Una marcada isSelected."));
children.push(bulletKV("MuebleDetail", "componentes de detalle del mueble (cuerpo interior, trasera, frente, zócalo) con materialidad."));
children.push(bulletKV("ArtefactoItem", "items de artefactos por ambiente (baño principal, cocina, etc.) con precio lista, descuento y precio cliente."));

children.push(h3("Catálogos"));
children.push(bulletKV("PartidaCatalog", "catálogo global de partidas reutilizables entre proyectos. 206 partidas hoy. Descripción dual cliente/maestro."));
children.push(bulletKV("PartidaComponent", "desglose de una partida en conceptos (material | labor | margin | tool | loss | subcontract)."));
children.push(bulletKV("MaterialCatalog", "catálogo global de materiales. 332 hoy. Precio neto + linkable a Sodimac u otra tienda."));
children.push(bulletKV("MaterialPriceOffer", "ofertas por tienda para un material. Permite comparar precios y elegir uno como pinned."));
children.push(bulletKV("MaterialPriceHistory", "snapshot histórico de precios por material y tienda."));

children.push(h3("Estados de Pago"));
children.push(bulletKV("EstadoPago", "vinculado a BudgetVersion (snapshot del ppto vigente al crear). Status: borrador | cerrado."));
children.push(bulletKV("EstadoPagoItem", "quantityExecuted como verdad financiera. amountPaid snapshot inmutable al cerrar. lineageId para sobrevivir cambios de versión."));

children.push(h3("Lista de compra"));
children.push(bulletKV("ShoppingItem", "items de la lista de compra agregada del proyecto. En construcción, no totalmente conectado al presupuesto."));

children.push(h3("Facturas y categorías"));
children.push(bulletKV("Invoice", "DTEs recibidos y emitidos. Unique key (type, tipoDoc, folioNumber, rutIssuer). origin: manual | sii_automatica. Campos PDF oficial: siiCodigo, pdfContent, pdfFetchedAt."));
children.push(bulletKV("CostCategory", "jerárquica padre/sub. type: directo | indirecto."));
children.push(bulletKV("InvoiceCategorizationRule", "regla RUT proveedor → categoría. Aprende de asignaciones manuales."));
children.push(bulletKV("InvoicePayment", "many-to-many BankMovement ↔ Invoice con amountApplied (cobros parciales y splits)."));

children.push(h3("Banco"));
children.push(bulletKV("BankAccount", "Operativa 8913459-5 + Sueldos 9987891-6. role: operating | salary_fund | other. Lleva lastKnownBalance del banco."));
children.push(bulletKV("BankMovement", "movimientos importados de cartolas Santander. internalTransferToId para transferencias entre cuentas BLARQ."));
children.push(bulletKV("BankCategorizationRule", "regla por descripción para auto-categorizar movimientos sin factura."));

children.push(h2("Lógica de negocio (/src/lib/)"));
children.push(bulletKV("projects/metrics.ts", "ÚNICA fuente de verdad para cobrado, gastado, utilidad real, % avance, alertas. Los consumidores no calculan, solo eligen qué mostrar."));
children.push(bulletKV("ep/calculations.ts", "lógica pura de EP, cubierta por scripts/test-ep-calculations.ts (26 asserts)."));
children.push(bulletKV("ep/snapshot.ts", "snapshot inmutable al cerrar EP."));
children.push(bulletKV("ep/sync.ts", "sync EP ↔ versión más reciente del presupuesto vía lineageId."));
children.push(bulletKV("facturas/categorizationRules.ts", "motor de reglas RUT→categoría."));
children.push(bulletKV("banco/santanderParser.ts", "parser de cartolas Santander (formato provisoria + histórica)."));
children.push(bulletKV("banco/invoicePayments.ts", "InvoicePayment many-to-many."));
children.push(bulletKV("banco/fondoSueldos.ts", "cálculo del fondo sueldos (GG obra + utilidad muebles)."));
children.push(bulletKV("sii/", "cert.ts (carga .pfx con node-forge), siiAuth.ts (SOAP getSeed + token), siiRcv.ts (REST), linkNcReferences.ts (auto-link NCs), simpleFacturaClient.ts, siiBrowser.ts (Playwright local-only)."));
children.push(bulletKV("pdf/", "renderPDF.ts (wrapper Puppeteer), ObraPDF.html.ts, MueblesPDF.html.ts, ArtefactosPDF.html.ts, EstadoPagoPDF.html.ts, InvoicePDF.html.ts, ListaCompraPDF.html.ts."));

children.push(h2("Integraciones externas"));
children.push(bulletKV("SimpleFactura", "lectura de DTEs vía API REST. Solo lectura. La app no emite. Plan Independiente $15.000+IVA mensual; el adicional “Bandeja DTE recibidos” cuesta $4.000/mes y no está activo todavía."));
children.push(bulletKV("SII directo (auto-link NCs)", "auth SOAP propia con cert digital + REST consdcvinternetui. Linkea notas de crédito a sus facturas originales sin parsear XMLs. Funciona en Vercel."));
children.push(bulletKV("SII directo (PDFs oficiales)", "Playwright + cert para bajar PDFs oficiales del portal MIPE. Local only — el WAF F5 BIG-IP del SII bloquea no-Chromium y rechaza IPs cloud. Corre en mac de MJ vía LaunchAgent diario 9 AM."));
children.push(bulletKV("Maxxa", "transitorio. Sistema externo donde BLARQ emite facturas hoy. Sin API. Comparable contra la BD vía npm run compare:maxxa."));

children.push(h2("Hosting y deploy"));
children.push(bullet("Vercel Hobby tier en https://blarq-app.vercel.app, deploy automático on-push a main."));
children.push(bullet("Neon Postgres con dos branches: prod (ep-shy-morning) + dev (ep-solitary-mud). PITR 7 días en plan free."));
children.push(bullet("MJ y JT entran con sus emails reales (mjblanco@blarq.cl, jtlarrain@blarq.cl)."));
children.push(bullet("Variables sensibles (cert base64, DATABASE_URL prod) en Vercel env vars, no en repo."));
children.push(bullet("Build TypeScript estricto (scripts/ excluido en tsconfig)."));

// 6. Decisiones de diseño no negociables
children.push(h1("6. Decisiones de diseño no negociables"));
children.push(p("Lista completa de principios que rigen la app. Si algo nuevo viola alguno, primero discutirlo con MJ. Fuente: docs/principles.md.", { italics: true, color: GRAY_DARK }));
children.push(p("Nota v1.1: hay una conversación abierta sobre paleta de colores. La marca BLARQ tiene paleta propia (grises cálidos + acento tierra/topo) que difiere de la regla actual de principles.md (blanco/negro/gris + rojo/verde/ámbar como semánticos). MJ va a llevar esa conversación a Claude.ai design. Hasta que se cierre, mantener lo que dice principles.md.", { italics: true, color: GRAY_DARK }));

children.push(h2("Lenguaje visual BLARQ unificado"));
children.push(p("Toda la app habla el mismo idioma estético. No hay zonas con look distinto. La estética también aplica al propio documento que estás leyendo."));
children.push(h3("Paleta"));
children.push(bullet("Blanco / negro / gris. Es la base."));
children.push(bullet("Colores semánticos solo cuando aportan significado: rojo = excedido o vencido; verde = confirmado o pagado; ámbar = atención."));
children.push(bullet("Default es gris neutro, no verde. Un valor OK no se pinta de verde por inercia."));
children.push(bullet("No hay morado, rosado ni acentos decorativos. El banner SII original morado se migró a gris."));
children.push(h3("Tipografía y números"));
children.push(bullet("Tipografía sans (Geist por default)."));
children.push(bullet("Jerarquía por peso y tamaño, no por color. Un H1 no es azul; es más grande."));
children.push(bullet("tabular-nums en columnas numéricas para que los dígitos alineen verticalmente."));
children.push(bullet("Negrita reservada para énfasis real, no decorativo."));
children.push(h3("Iconografía"));
children.push(bullet("Iconos monocromáticos. La doc menciona lucide-react como biblioteca; en la práctica los iconos están como SVG inline (sin lucide instalado). Inconsistencia menor de doc, no funcional."));
children.push(bullet("Sin emojis en UI ni en código. Rompen el tono editorial sobrio."));
children.push(h3("Forma"));
children.push(bullet("Sombras: shadow-sm máximo. Sin sombras gruesas decorativas."));
children.push(bullet("Bordes: 1px. Nunca 2–3px decorativos."));
children.push(bullet("Esquinas: rounded-xl para containers, rounded-full para badges, rounded para inputs y botones. No rounded-none, no rounded-3xl."));
children.push(h3("Tablas densas"));
children.push(bullet("thead.bg-gray-50 + divide-y divide-gray-100. Filas sin alternancia de color, padding chico."));
children.push(bullet("Totales en última fila con borde superior y peso bold."));

children.push(h2("El cero no ocupa espacio prominente"));
children.push(p("Una cantidad 0, un avance 0%, un saldo $0 deben ser visualmente discretos. No se usa color destacado, ni énfasis tipográfico, ni íconos. Cuando todo lo relevante es lo que NO está en cero, el cero compite por atención sin aportar."));
children.push(bullet("Mostrar — o $0 en gris claro en vez de número negro."));
children.push(bullet("En totales, si hay 0 categorías ocupadas, no listarlas con badge."));

children.push(h2("Memoria espacial por número correlativo"));
children.push(p("numeroCotizacion y numeroProyecto son la memoria espacial del estudio. MJ y JT recuerdan los proyectos por su número antes que por su nombre."));
children.push(bullet("Los números son visibles, no relegados a id técnico."));
children.push(bullet("En listados, columna número primero o muy cerca del nombre."));
children.push(bullet("Nunca renumerar. Nunca reusar."));

children.push(h2("Cantidad ejecutada como base en EPs (no porcentaje)"));
children.push(p("La verdad financiera es cantidad ejecutada acumulada, no %. El % se deriva. La UI tipea %, internamente se guarda cantidad. Esto blinda los pagos contra cambios de versión del presupuesto."));

children.push(h2("Descripción dual cliente/maestro"));
children.push(p("Cada partida tiene dos descripciones independientes:"));
children.push(bulletKV("descriptionCliente", "va al PDF presupuesto. Habla en términos del cliente (alcance, materialidad, terminación visible)."));
children.push(bulletKV("descriptionMaestro", "va al PDF del EP. Habla en términos del maestro (ejecución, técnica, cuidados)."));
children.push(p("Una partida con la misma descripción para ambos es un mal por defecto: cliente y maestro no quieren leer lo mismo."));

children.push(h2("metrics.ts es la única fuente de verdad"));
children.push(p("Todos los cálculos por proyecto (cobrado, gastado, utilidad real, % avance, alertas) viven en src/lib/projects/metrics.ts. Los consumidores (cards, banners, EERR, dashboard) no calculan: solo eligen qué mostrar."));
children.push(bullet("Si necesitás un nuevo cálculo, agregalo a metrics.ts. No lo dupliques en el componente."));
children.push(bullet("Antes de modificar metrics.ts, snapshot pre/post (no hay tests automatizados)."));

children.push(h2("Jerarquía por tipografía, no por color"));
children.push(p("Aplica a UI, PDFs, emails, todo. Repetido del lenguaje visual: la jerarquía se construye con peso y tamaño, no con color."));

children.push(h2("El proyecto NUNCA se auto-asigna"));
children.push(p("Las facturas que llegan por sync SII tienen projectId=null. Nunca se infiere el proyecto desde el RUT del proveedor o desde otra heurística. MJ las cataloga manualmente."));
children.push(p("Razón: una vez que se inserta un proyecto incorrecto, el costo del error es alto (modifica métricas, altera el fondo sueldos, ensucia el comparativo vs Maxxa). El costo de catalogar a mano es bajo."));
children.push(p("La misma regla aplica a categoría: el motor de reglas RUT→categoría aprende de asignaciones manuales, pero el primer contacto con un RUT desconocido la deja en null."));

children.push(h2("Sync SII de PDFs solo local — no Vercel"));
children.push(p("El SII tiene WAF F5 BIG-IP que detecta clientes no-Chromium y bloquea con 503. Validado: Node + headers Chrome-like falla, Chromium real de Playwright pasa. Vercel además agrega IP cloud que muchos WAFs marcan como no-residencial."));
children.push(p("Decisión final: el sync de PDFs corre solo en mac de MJ (LaunchAgent diario + on-demand). No reabrir esta discusión sin nueva evidencia (ej: WAF cambia política, o aparece un proveedor mTLS cloud nativo)."));

children.push(h2("No suavizar el estado del código"));
children.push(p("Cuando algo está roto, a medias o dudoso, decirlo claro. Frases prohibidas en respuestas y en código: robusto, potente, innovador, perfecto. Si una sección de doc no está clara, “no estoy seguro de X” es mejor que inventar."));

children.push(h2("Placeholders ↔ null"));
children.push(p("Si un campo tiene un motor de automatización que decide en base a “está vacío o no”, no introducir un valor placeholder (Pendiente de asignar, Por definir) que signifique lo mismo que null. Las queries de “uncategorized” se escriben con IS NULL, y un placeholder vuelve invisibles esos registros para los retroactivos."));
children.push(p("Para distinguir visualmente las sin clasificar, hacerlo en el render (itálica gris, badge), no creando un valor de dominio."));

children.push(h2("Reiniciar dev server al editar schema Prisma"));
children.push(p("Después de cualquier edit a prisma/schema.prisma que agregue un model o cambie un campo:"));
children.push(bullet("npx prisma db push --skip-generate"));
children.push(bullet("npx prisma generate"));
children.push(bullet("Reiniciar el dev server. Hot-reload no actualiza el cliente Prisma en memoria."));

children.push(h2("Pedir aclaración cuando hay ambigüedad"));
children.push(p("Si una decisión razonable tiene 2+ opciones (estructura de datos, UX, naming), no asumir. Preguntar a MJ con las opciones puestas adelante y la recomendación."));
children.push(p("Acotar la acción a lo que se pidió: si pidió arreglar el bug X, no aprovechar para refactorizar Y. Lo extra se ofrece, no se hace silencioso."));

children.push(h2("Idioma español en todo"));
children.push(p("Respuestas, comentarios de código, mensajes de commit, mensajes de UI, doc nueva: todo en español (chileno cuando aplica). Inglés solo en identificadores (variables, tipos, funciones) si así está la convención del archivo."));

// 7. Estado actual y roadmap
children.push(h1("7. Estado actual y roadmap"));

children.push(h2("Implementado y estable"));
children.push(bullet("App en producción en Vercel + Neon Postgres. MJ y JT entrando con sus emails reales."));
children.push(bullet("Sync de DTEs vía SimpleFactura → Invoices con origin sii_automatica y projectId null esperando catalogación manual."));
children.push(bullet("Auto-link de NCs ↔ facturas vía SII directo (cert mTLS): 18/20 NCs históricas linkeadas en prod."));
children.push(bullet("PDFs oficiales SII (Fase 2 entregada 2026-05-04): 473/507 facturas con pdfContent en BD. Endpoint /api/facturas/[id]/pdf sirve oficial cuando existe, fallback a interno. LaunchAgent corre diario 9 AM en mac de MJ."));
children.push(bullet("Backup CLI (npm run db:backup) probado en dev y prod."));
children.push(bullet("Comparador BLARQ vs Maxxa generalizado por proyecto (npm run compare:maxxa)."));
children.push(bullet("Conciliación bancaria con cobros parciales y splits (InvoicePayment many-to-many). Reglas que aprenden por descripción."));
children.push(bullet("Fondo Sueldos calculado por proyecto (GG obra + utilidad muebles)."));
children.push(bullet("Módulo EP completo: cantidad ejecutada como verdad, snapshot inmutable, sync por lineageId, descripción dual, PDF maestro. 26 tests pasando."));
children.push(bullet("Banner SII en /facturas y / con estilo gris/icono mono (sin morado)."));
children.push(bullet("Tabs filtrados en proyectos internos (BLARQ, CASA): solo Resumen + Facturas; Presupuesto/EPs/Lista de compra ocultos."));
children.push(bullet("Validación de unicidad de numeroProyecto en PATCH /api/proyectos/[id], con error legible (no P2002 crudo de Prisma)."));
children.push(bullet("Cambio de estado de proyecto desde la UI (nuevo 2026-05-04): menú \"...\" en el header del proyecto y en cada fila de la tabla, con \"Marcar como terminado\" / \"Reabrir proyecto\". Botón sutil (gris claro, sin borde) para no competir con acciones primarias."));

children.push(h2("Implementado parcial o con deuda"));
children.push(bulletKV("descriptionMaestro en PartidaCatalog", "el campo existe en schema pero el catálogo está prácticamente sin poblar (206 partidas, ~0 con descripción de maestro completada). Se va llenando caso a caso al editar EP. Decisión pendiente: hacer un backfill batch o seguir gradual."));
children.push(bulletKV("ShoppingItem (lista de compra)", "modelo y UI básica existen, pero la conexión al presupuesto está incompleta."));
children.push(bulletKV("Branch modo-b-emision", "sin mergear desde 28-abr-2026 (commit 808327e, 7 archivos de emisión). Esperando certificación SimpleFactura. Cuanto más tarde, más conflictos al merge en resumen, facturas y proyectos/[id]/facturas."));
children.push(bulletKV("Edge case PDFs SII", "34 facturas (~7%) no aparecen en MIPE — son típicamente NCs por intercambio directo emisor-receptor. Sin vía conocida para PDF oficial, la app cae al PDF interno."));
children.push(bulletKV("Cosa rara observada", "en /proyectos/[id]/resumen, el “Cobrado” del header muestra valores que no coinciden con Invoice.status='pagada'. Hay dos lógicas distintas de “cobrado” conviviendo en código. Este problema queda agendado para B1 del Sprint 2 (consolidación de cálculos en metrics.ts)."));

children.push(h2("Sprint 1 — pendientes reales (post auditoría 2026-05-04)"));
children.push(p("De las 7 sub-tareas del Sprint 1 originales, 3 estaban ya implementadas en código (banner SII gris, tabs filtrados en internos, validación numeroProyecto único) y se sacan del plan. Otras 2 cambian de forma: la reclasificación de proyectos ahora la hace MJ desde la UI (botón nuevo), y el TODO obsoleto del script no se encontró. Lo que queda real:"));
children.push(bullet("Casa → marcar como centro de costo interno (isInternal=true). El botón nuevo de la UI cambia status pero NO el flag isInternal. Decisión pendiente: hacer cambio puntual en BD, agregar UI para marcar internos, o dejar."));
children.push(bullet("Reclasificar 3 proyectos a terminado: Martín de Zamora, Cerro San Luis, Vitacura 81. MJ los puede mover ella misma desde el menú \"...\" en el header o la tabla."));
children.push(bullet("Criterios de alerta crítica: factura recibida vencida (ya implementado), categoría excedida >100% (cablear hasAlert), EP atrasado (umbral 30d configurable, no aplica a proyectos sin EPs)."));
children.push(bullet("Snapshot pre/post para B1 del Sprint 2: incluye terminados, sin tope numérico, umbrales $1 conceptos / $10 totales."));

children.push(h2("Sprint 2 (3–4h) — consolidación crítica"));
children.push(bullet("B1: eliminar duplicación de cálculos. resumen/page.tsx debe usar computeProjectMetrics() de metrics.ts. metrics.ts es la ÚNICA fuente de verdad para gastado, cobrado, utilidad, avance."));
children.push(bullet("Snapshot pre/post: incluir proyectos terminados también. Diff log con fuente del cálculo de cada lado. Sin tope numérico — toda diferencia > umbral debe ser justificada por escrito."));
children.push(bullet("Umbrales del snapshot: $1 conceptos individuales, $10 totales."));
children.push(bullet("Tests metrics.ts cubriendo: cálculo gastado NETO contra presupuesto NETO (regresión bug IVA), cálculo cobrado vs total acordado, cálculo utilidad real, caso borde de proyecto sin facturas/EPs/presupuesto aprobado (devuelve 0, no explota)."));

children.push(h2("Sprint 3 (1–2h) — reducir riesgo branch"));
children.push(bullet("Rebase preventivo de modo-b-emision sobre main."));
children.push(bullet("Reportar conflictos encontrados y decisiones no triviales."));

children.push(h2("Backlog largo"));
children.push(bullet("Conciliación bancaria fina: completar la cobertura de los ~91 movimientos sin asignar de la importación marzo+abril."));
children.push(bullet("Salida de Maxxa hacia emisión propia: definir proveedor (OpenFactura, LibreDTE, SimpleAPI, Haulmer, integración directa). Tolerancia a fallos baja — correr en paralelo durante transición. Sin urgencia hoy."));
children.push(bullet("UI cómoda para clasificar facturas masivamente (hoy se hace una a una)."));
children.push(bullet("Automatización de clasificación con reglas más finas (más allá de RUT → categoría)."));
children.push(bullet("Proyectos solo arquitectura como tipo (sin obra ni muebles): Guanay es el primer caso real. Cuando aparezca un segundo, evaluar con datos reales si vale modelarlo como tipo separado."));
children.push(bullet("Sub-capítulos en EP (ej: 4.2 COCINA dentro de 4 INSTALACIONES SANITARIAS). Schema actual no soporta. Lefevre no los necesita; Portofino sí los usaba en Excel original. Decisión postergada."));
children.push(bullet("Renovación cert digital antes de 2026-08-01 (~89 días al cierre de esta versión del doc). Trámite manual de MJ."));
children.push(bullet("Plan Neon free vs paid: a ~17 MB/mes de PDFs oficiales se llega al límite del free en ~24 meses. Decidir cuándo migrar o archivar."));
children.push(bullet("Revisión de paleta de colores con Claude.ai design: alinear la paleta de la app con la paleta de marca BLARQ (grises cálidos + acento tierra/topo). Hoy la app usa azul/verde/rojo en algunos lugares que no están en la marca."));

// 8. Forma de trabajar con IA
children.push(h1("8. Forma de trabajar con IA"));
children.push(p("MJ no es desarrolladora. Construye esta app apoyándose en sesiones de IA (Claude Code para codificación, Claude.ai para pensamiento y diseño). Reglas de la colaboración:"));

children.push(bulletKV("Idioma", "español, chileno cuando aplica. Respuestas, comentarios de código, commits, UI: todo en español. Inglés solo en identificadores de código si así está la convención del archivo."));
children.push(bulletKV("Lenguaje simple, sin jerga", "MJ entiende perfectamente “frecuencia con la que actualizo X” y no necesita “cadencia”. Antes de mandar el mensaje final, escanear: ¿hay alguna palabra que requiera contexto de developer para entenderse? Reemplazarla. Si necesito un término técnico (schema, branch, deploy), explicarlo brevemente la primera vez."));
children.push(bulletKV("Ver opciones antes de soluciones", "cuando una decisión razonable tiene 2+ opciones, presentar las alternativas con la recomendación, no asumir y avanzar."));
children.push(bulletKV("Revisar antes de actuar", "para cualquier cambio no trivial, primero plan o lectura, después escritura. Acotar la acción a lo que se pidió, sin aprovechar para meter cambios extra."));
children.push(bulletKV("Confirmar antes de cambios grandes", "no reversibles, alta blast radius (push --force, drop tabla, deploy a prod, cambios en env vars de Vercel) requieren confirmación explícita."));
children.push(bulletKV("Estética BLARQ no negociable", "cualquier cambio de UI debe respetar la paleta, tipografía, densidad y formas descritas en §6."));
children.push(bulletKV("Tomar postura, no decir “depende del contexto”", "si la pregunta tiene una respuesta razonable, dar la respuesta y justificarla. Si no la tiene, decir “no estoy seguro de X” en vez de inventar."));
children.push(bulletKV("Auditar antes de planear", "lo que figura como pendiente en /docs/WIP.md no siempre es lo que está pendiente en código. Revisar el código antes de ejecutar tareas del plan — la lección de la sesión 2026-05-04, donde 3 de 7 tareas del Sprint 1 ya estaban resueltas."));
children.push(bulletKV("Dos canales de doc", "info estable del proyecto vive en /docs/ del repo (commiteado, accesible para JT y otras instancias). Memoria efímera de Claude Code (preferencias, hipótesis vivas) vive en ~/.claude/ y es privada de cada instancia."));
children.push(bulletKV("Frases prohibidas", "robusto, potente, innovador, perfecto. Sumar a esa lista cualquier término que sea jerga gratuita."));

// 9. Estado de los datos
children.push(h1("9. Estado de los datos hoy (BD prod)"));
children.push(p("Snapshot al momento de generar este documento (2026-05-04).", { italics: true, color: GRAY_DARK }));

children.push(simpleTable([
  ["Entidad", "Cantidad"],
  ["Proyectos totales", "22"],
  ["  – Internos (BLARQ, CASA)", "2"],
  ["  – En cotizacion", "4"],
  ["  – En ejecucion", "11"],
  ["  – Terminados", "4"],
  ["  – Archivados", "2"],
  ["Facturas totales", "535"],
  ["  – Recibidas", "512"],
  ["  – Emitidas", "23"],
  ["Catálogo de partidas", "206"],
  ["Catálogo de materiales", "332"],
  ["Categorías de costo", "21"],
  ["Estados de Pago", "1"],
], [5500, 3526]));
children.push(p("", { after: 80 }));

children.push(h2("Notas sobre los datos"));
children.push(bullet("Las cotizaciones presentes en la BD (numeroCotizacion 1..20) son datos sembrados por código durante imports y desarrollo, no representan los correlativos comerciales reales del estudio."));
children.push(bullet("Los proyectos en estado ejecucion incluyen los dos centros de costo internos (BLARQ y CASA). Proyectos de cliente reales en ejecucion: 9. Casa pendiente de marcar isInternal=true (decisión abierta)."));
children.push(bullet("Solo hay 1 EP cargado: el módulo está implementado y testeado, pero el primer proyecto que lo va a usar productivamente será Lefevre. Portofino seguirá en modo Excel (ya estaba avanzado cuando la app empezó)."));
children.push(bullet("Guanay es el primer proyecto solo-arquitectura del estudio (sin obra ni muebles). Sigue activo. Cuando aparezca un segundo, evaluar si vale modelarlo como tipo separado."));
children.push(bullet("BLARQ usa hoy 92 MB de los 500 MB del plan Neon free."));

// 10. Documentos relacionados
children.push(h1("10. Documentos relacionados en el repo"));
children.push(p("Para detalle, revisar los siguientes archivos del repo blarq-app. Esta lista no es exhaustiva — la fuente de verdad sigue siendo /docs/."));

children.push(simpleTable([
  ["Archivo", "Para qué"],
  ["CLAUDE.md (raíz)", "Instrucciones permanentes para asistentes IA. Idioma, estética, reglas duras, workflow Prisma."],
  ["docs/business-model.md", "Modelo de negocio en lenguaje no técnico. Las 11 secciones del cómo opera BLARQ."],
  ["docs/architecture.md", "Vista técnica: stack, carpetas, rutas, modelo de datos por dominio, integraciones, deploy, tests."],
  ["docs/principles.md", "Decisiones de diseño no negociables (la fuente de verdad para esa parte de este documento)."],
  ["docs/glossary.md", "Vocabulario completo del dominio."],
  ["docs/decisions/", "ADRs: numeración paralela (2026-04-28), cantidad ejecutada base EPs (2026-04-26), descripción dual cliente/maestro (2026-04-26)."],
  ["docs/CHANGELOG.md", "Log cronológico de cambios estructurales."],
  ["docs/WIP.md", "Estado actual del trabajo, próximos pasos, decisiones pendientes. Se actualiza al cierre de cada sesión."],
  ["docs/SETUP_SII_simplefactura.md", "Configuración de la integración SII vía SimpleFactura."],
  ["docs/SETUP_SII_pdf-oficial.md", "PDFs oficiales SII vía Playwright + cert digital, local-only."],
  ["docs/MIGRATION_POSTGRES.md", "Cutover SQLite → Postgres + Vercel."],
  ["docs/REVIEW_navegacion_2026-04-27.md", "Revisión histórica de navegación de la app."],
  ["docs/REVIEW_autorevision_2026-04-29.md", "Auto-revisión del estado del código en abril 2026."],
  ["scripts/generate-context-doc.js", "Este documento. Para regenerar: node scripts/generate-context-doc.js."],
], [3000, 6026]));

children.push(p("", { after: 100 }));
children.push(p("Fin del documento.", { italics: true, color: GRAY_DARK, align: AlignmentType.CENTER }));

// ---- documento ----

const doc = new Document({
  styles: {
    default: { document: { run: { font: SANS, size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: SANS, color: BLACK },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: SANS, color: BLACK },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: SANS, color: BLACK },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 960, hanging: 240 } } } },
      ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
          children: [
            new TextRun({ text: "BLARQ", bold: true, size: 16, font: SANS, color: GRAY_DARK }),
            new TextRun({ text: "\tDocumento de contexto", size: 16, font: SANS, color: GRAY_DARK }),
          ],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
          children: [
            new TextRun({ text: "v1.1 · 2026-05-04", size: 16, font: SANS, color: GRAY_DARK }),
            new TextRun({ text: "\t", size: 16, font: SANS }),
            new TextRun({ text: "Página ", size: 16, font: SANS, color: GRAY_DARK }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: SANS, color: GRAY_DARK }),
            new TextRun({ text: " de ", size: 16, font: SANS, color: GRAY_DARK }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: SANS, color: GRAY_DARK }),
          ],
        })],
      }),
    },
    children,
  }],
});

const out = path.join(process.env.HOME, "Desktop", "BLARQ-contexto.docx");
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log("OK:", out, buf.length, "bytes");
});
