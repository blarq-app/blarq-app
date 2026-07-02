// Render de verificación del generador real de Obra (renderObraHTML) con datos
// de Paseo del Sena. Sale un PDF al scratchpad para revisar el diseño de marca.
import { renderObraHTML, type ObraItemInput } from "../src/lib/pdf/ObraPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import fs from "node:fs";

const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));

type Row = [string, string, string, string, string, string, string];
function mk(chapter: string, zone: string | null, rows: Row[]): ObraItemInput[] {
  return rows.map((r) => ({
    chapter,
    subChapter: zone,
    itemNumber: r[0],
    name: r[1],
    descriptionCliente: r[2] || null,
    unit: r[3],
    quantity: num(r[4]),
    unitPrice: num(r[5]),
    total: num(r[6]),
    changeMarker: null,
  }));
}

const items: ObraItemInput[] = [
  ...mk("demoliciones", "Cocina", [
    ["1.1", "Perforación muro / losa hormigón", "Nueva pasada a comedor y escritorio. Valor sujeto a consulta con ing. calculista.", "GL", "1", "330.000", "330.000"],
    ["1.2", "Retiro mobiliario cocina", "Considera retiro de muebles y artefactos.", "GL", "1", "232.000", "232.000"],
    ["1.3", "Retiro piso cerámico", "", "M²", "12,1", "8.263", "99.985"],
    ["1.4", "Retiro puertas", "", "UN", "2", "26.000", "52.000"],
    ["1.5", "Retiro revestimiento cerámico", "", "M²", "32,4", "7.969", "258.202"],
  ]),
  ...mk("demoliciones", "Baños", [
    ["1.6", "Retiro artefactos y accesorios de baño", "WC, vanitorio, tina, receptáculos, accesorios, etc.", "GL", "3", "88.000", "264.000"],
    ["1.7", "Retiro piso cerámico", "Se considera en 3 baños.", "M²", "6,8", "8.263", "56.190"],
    ["1.8", "Retiro revestimiento cerámico", "Se considera en 3 baños.", "M²", "43", "7.969", "342.676"],
  ]),
  ...mk("reparaciones", "Cocina", [
    ["2.1", "Construcción tabique interior", "Cierro de puerta hacia comedor y escritorio.", "M²", "3,36", "60.448", "203.106"],
    ["2.2", "Enlucido de muros", "Se considera en muros cocina para pintura.", "M²", "30,63", "21.195", "649.193"],
    ["2.3", "Reparación general", "Reparaciones de muros y cielos por modificaciones eléctricas y sanitarias en cocina; rasgos de perforación para puerta.", "GL", "1", "482.400", "482.400"],
  ]),
  ...mk("reparaciones", "Baños", [
    ["2.4", "Reparación general", "Reparaciones en muro por modificaciones sanitarias.", "GL", "1", "170.000", "170.000"],
  ]),
  ...mk("sanitarias", "Cocina", [
    ["3.1", "Modificaciones sanitarias cocina", "Valor se ajustará según proyecto.", "GL", "1", "368.550", "368.550"],
    ["3.2", "Modificación tubería gas", "Valor se ajustará según proyecto.", "GL", "1", "108.830", "108.830"],
    ["3.3", "Instalación grifería lavaplatos", "", "UN", "1", "38.500", "38.500"],
    ["3.4", "Instalación desagüe lavaplatos / lavamanos", "", "UN", "1", "36.933", "36.933"],
    ["3.5", "Llave de paso gas", "Considera provisión. Llave de paso Nibsa.", "UN", "1", "87.251", "87.251"],
    ["3.6", "Instalación encimera gas", "", "UN", "1", "62.419", "62.419"],
    ["3.7", "Instalación lavavajillas", "", "UN", "1", "54.000", "54.000"],
  ]),
  ...mk("sanitarias", "Baños", [
    ["3.8", "Modificaciones sanitarias baño", "2 lavamanos en baño principal; ajustes para columna de ducha en 3 baños.", "GL", "1", "445.636", "445.636"],
    ["3.9", "Instalación desagüe lavaplatos / lavamanos", "", "UN", "4", "36.933", "147.732"],
    ["3.10", "Instalación grifería lavamanos", "", "UN", "4", "34.500", "138.000"],
    ["3.11", "Instalación WC", "", "UN", "3", "63.000", "189.000"],
    ["3.12", "Instalación grifería ducha / tina", "", "UN", "3", "38.500", "115.500"],
    ["3.13", "Construcción ducha en obra", "", "UN", "3", "384.968", "1.154.903"],
    ["3.14", "Instalación desagüe ducha / tina", "", "UN", "3", "60.000", "180.000"],
    ["3.15", "Instalación mampara cristal", "No considera artefacto.", "UN", "3", "69.000", "207.000"],
    ["3.16", "Instalación muebles vanitorio", "Mueble y cubierta prefabricada armados. Baños secundarios.", "UN", "2", "47.500", "95.000"],
    ["3.17", "Instalación accesorios de baño", "Portarrollos, perchas, toalleros.", "GL", "3", "25.000", "75.000"],
  ]),
  ...mk("electricas", "Cocina", [
    ["4.1", "Instalación luminaria", "Reutilización de 2 puntos de luz existentes. No considera provisión.", "UN", "3", "17.250", "51.750"],
    ["4.2", "Nuevo arranque eléctrico", "3 arranques para luz LED bajo muebles superiores; arranque en cielo sector despensa.", "UN", "4", "55.200", "220.800"],
    ["4.3", "Enchufe / interruptor nuevo Sinthesi S33", "Modificación o traslado. Se debe revisar según proyecto.", "UN", "9", "58.782", "529.036"],
    ["4.4", "Cambio módulo eléctrico", "Para enchufes e interruptores existentes. Se debe revisar según proyecto.", "UN", "3", "14.926", "44.777"],
    ["4.5", "Instalación campana", "", "UN", "1", "48.000", "48.000"],
    ["4.6", "Instalación horno eléctrico", "", "UN", "1", "23.150", "23.150"],
    ["4.7", "Traslado interruptor", "Interruptor comedor por demolición para puerta.", "UN", "1", "57.600", "57.600"],
  ]),
  ...mk("electricas", "Baños", [
    ["4.8", "Nuevo arranque eléctrico", "3 arranques nuevos para cinta LED espejo.", "UN", "3", "55.200", "165.600"],
    ["4.9", "Cambio módulo eléctrico", "Cambio 3 módulos en baños para 2 teclas.", "UN", "3", "14.926", "44.777"],
    ["4.10", "Enchufe / interruptor nuevo Sinthesi S33", "Considerado en baño principal.", "UN", "1", "58.782", "58.782"],
    ["4.11", "Instalación luminaria", "En 3 baños (2 c/u). No considera provisión.", "UN", "6", "23.000", "138.000"],
    ["4.12", "Instalación extractor", "Considera extractor Briggs blanco.", "UN", "1", "63.499", "63.499"],
  ]),
  ...mk("terminaciones", "Cocina", [
    ["5.1", "Instalación pavimento porcelanato", "En cocina. Provisión proforma $25.000/m² IVA incl. Formato mediano.", "M²", "12,1", "47.931", "579.965"],
    ["5.2", "Pintura de muros", "Esmalte al agua Sherwin Williams en muros de cocina, escritorio y comedor.", "M²", "60,39", "10.714", "646.996"],
    ["5.3", "Pintura de cielos baños / cocina", "Esmalte al agua satín blanco.", "M²", "12,1", "9.699", "117.359"],
    ["5.4", "Pintura de cielos", "Látex blanco en zona comedor y escritorio.", "M²", "23", "8.179", "188.127"],
    ["5.5", "Instalación de puertas", "Reinstalación de puerta existente.", "UN", "2", "20.000", "40.000"],
    ["5.6", "Instalación guardapolvo porcelanato", "En cocina.", "ML", "11,72", "19.311", "226.330"],
  ]),
  ...mk("terminaciones", "Baños", [
    ["5.7", "Espejo a medida", "Espejos con iluminación LED; baño niños con perfil negro de borde.", "UN", "1", "612.000", "612.000"],
    ["5.8", "Instalación pavimento porcelanato", "En baños. Provisión $20.000/m² IVA incl. Formato mediano.", "M²", "6,8", "43.077", "292.927"],
    ["5.9", "Instalación revestimiento porcelanato", "Porcelanato o cerámica en muros. Provisión $20.000 IVA incl./m². Formato mediano.", "M²", "44,65", "48.127", "2.148.869"],
    ["5.10", "Pintura de cielos baños / cocina", "Esmalte al agua satín blanco.", "M²", "6,8", "9.699", "65.954"],
    ["5.11", "Construcción tabique interior RH", "Tabique y sobretabique para nicho shampoo. Repisas de vidrio.", "GL", "1", "126.042", "126.042"],
  ]),
  ...mk("limpieza", null, [
    ["6.1", "Limpieza y cuidado general de obra", "Protección de puertas, pisos y elementos; mantener la obra ordenada y limpia.", "GL", "1", "377.256", "377.256"],
    ["6.2", "Retiro de escombros mediano", "", "UN", "3", "352.334", "1.057.003"],
  ]),
];

// Marcas de prueba para verificar el render (nuevo "*", flechitas ↑/↓). En
// producción vienen de computeChangeMarkers; acá se fuerzan a mano.
const marks: Record<string, "added" | "up" | "down"> = {
  "4.7": "added", "4.8": "added", "4.9": "added", "4.10": "added",
  "4.11": "added", "4.12": "added", "4.1": "up", "4.4": "down", "3.13": "up",
};
for (const it of items) {
  if (marks[it.itemNumber]) it.changeMarker = marks[it.itemNumber];
}

const html = renderObraHTML({
  project: {
    name: "Paseo del Sena",
    clientName: "Verónica Villarreal",
    clientPhone: null,
    clientEmail: null,
    address: "Las Condes",
    ufReference: null,
  },
  budget: {
    version: "V2", date: "2026-05-22", ggPercentage: 20, utilityPercentage: 10,
    coverTitle: "Remodelación de cocina y baños",
    coverSubtitle: null,
    coverNote: "Cotización sujeta a visita técnica y rectificación de medidas en terreno.",
  },
  items,
  paymentTerms: [
    { stage: "Anticipo", percentage: 40 },
    { stage: "Avance 1", percentage: 25 },
    { stage: "Avance 2", percentage: 25 },
    { stage: "Saldo final", percentage: 10 },
  ],
});

async function main() {
  const out = process.env.OUT || "/tmp/obra_gen.pdf";
  const pdf = await renderPDF(html, {
    format: "A4",
    preferCSSPageSize: true,
  });
  fs.writeFileSync(out, pdf);
  console.log("PDF:", out);
}
main();
