// Render de verificación del generador real de Muebles con datos de Paseo del Sena.
import { renderMueblesHTML } from "../src/lib/pdf/MueblesPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import fs from "node:fs";

const h = (
  name: string,
  measure: string | null,
  finish: string | null,
  quantity: number
) => ({ sector: "", name, measure, finish, quantity });

const html = renderMueblesHTML({
  project: { name: "Paseo del Sena", clientName: "Verónica Villarreal", address: "Las Condes" },
  budget: { version: "V2", date: "2026-06-16", observations: null },
  chapters: [
    {
      chapterNumber: 1,
      name: "Muebles de cocina",
      items: [
        {
          itemNumber: "1.1", name: "Muebles", descriptionGeneral: "Según planos arquitectura",
          quantity: 1, clientPriceIva: 11033680,
          details: [
            { name: "Cuerpo interior", material: "Melamina blanca 18mm, tapacanto PVC 0,4mm, tapacanto ídem color frentes." },
            { name: "Trasera", material: "Melamina blanca 15mm." },
            { name: "Frente mueble base", material: "Melamina madera Ciprés Dorado 18mm." },
            { name: "Frente mueble mural", material: "Melamina madera Ciprés Dorado 18mm." },
            { name: "Zócalo", material: "Terciado mueblería revestido en porcelanato en obra." },
            { name: "Vitrinas", material: "Cuerpo interior melamina Ciprés Dorado, puertas perfil Omnia enchapado en encina." },
          ],
        },
        {
          itemNumber: "1.2", name: "Cubiertas", descriptionGeneral: "Porcelanato ultracompacto 12mm · color por definir",
          quantity: 1, clientPriceIva: 3732986,
          details: [
            { name: "Respaldos", material: "Considera respaldo alto 600mm en mesón de trabajo y encimera." },
            { name: "Comedor diario", material: "Considera comedor diario con faldón 70mm." },
          ],
        },
        {
          itemNumber: "1.3", name: "Herrajes", descriptionGeneral: null,
          quantity: 1, clientPriceIva: 1314819, details: [],
          herrajes: [
            h("Bisagra 3D recta cierre suave par", null, null, 26),
            h("Cajón metálico blanco frente madera altura 183mm", "500mm", "blanco", 10),
            h("Cajón metálico blanco frente madera altura 119mm", "500mm", "blanco", 2),
            h("Cajón metálico blanco frente madera altura 119mm", "450mm", "blanco", 1),
            h("Bisagra recta para marco de aluminio cierre suave par", null, "níquel", 2),
            h("Bisagra 155° 3D cierre suave para despensa", null, "níquel", 4),
            h("Bisagra costado falso cierre suave par", null, null, 2),
            h("Rotonda esquinera antracita", null, null, 2),
            h("Basurero anclado a puerta (66L)", null, null, 1),
            h("Despensa 5 cajones extracción total · ancho 1000mm", "500mm", "blanco", 1),
            h("Pistón a gas con cierre suave", null, null, 1),
          ],
        },
      ],
    },
    {
      chapterNumber: 2,
      name: "Baño principal",
      items: [
        {
          itemNumber: "2.1", name: "Mueble versión chapa madera", descriptionGeneral: "Según planos",
          quantity: 1, clientPriceIva: 952000,
          details: [
            { name: "Cuerpo interior", material: "Melamina blanca 18mm." },
            { name: "Frente cajón", material: "Chapa madera Enko Nogal Bruma." },
          ],
        },
        {
          itemNumber: "2.2", name: "Herrajes", descriptionGeneral: null,
          quantity: 1, clientPriceIva: 61690, details: [],
          herrajes: [h("Corredera oculta extensión total cierre suave juego", "500mm", null, 4)],
        },
        {
          itemNumber: "2.3", name: "Cubiertas", descriptionGeneral: "Porcelanato ultracompacto 12mm · color por definir",
          quantity: 1, clientPriceIva: 902008, details: [],
        },
      ],
    },
  ],
  paymentTerms: [
    { stage: "Anticipo", percentage: 60 },
    { stage: "Inicio instalación", percentage: 30 },
    { stage: "Saldo", percentage: 10 },
  ],
});

async function main() {
  const out = process.env.OUT || "/tmp/muebles_gen.pdf";
  const pdf = await renderPDF(html, {
    format: "A4",
    preferCSSPageSize: true,
  });
  fs.writeFileSync(out, pdf);
  console.log("PDF:", out);
}
main();
