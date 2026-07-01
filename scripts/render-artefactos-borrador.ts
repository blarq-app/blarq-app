// Render de verificación del generador real de Artefactos con datos de Paseo del Sena.
import { renderArtefactosHTML, type ArtefactoItemInput } from "../src/lib/pdf/ArtefactosPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import fs from "node:fs";

const it = (
  subcategory: string, room: string, name: string, detail: string, brand: string,
  quantity: number, listPrice: number, discountPercent: number | null, clientPrice: number
): ArtefactoItemInput => ({ subcategory, room, name, detail, brand, quantity, listPrice, discountPercent, clientPrice, imageUrl: null });

const items: ArtefactoItemInput[] = [
  // Sanitarios · Baño principal
  it("sanitario", "bano_principal", "Grifería lavamanos Urban Bronce", "Grifería lavamanos Urban baja 9 cm Antique Bronze.", "Klipen", 1, 84990, 0, 84990),
  it("sanitario", "bano_principal", "WC two piece Atenas", "WC two piece Atenas descarga a muro.", "Klipen", 1, 221640, 0.36, 141840),
  it("sanitario", "bano_principal", "Mueble baño New Delfos 600 Light Oak", "Mueble de baño completo New Delfos 2 cajones 1000×450×600 mm.", "Klipen", 1, 339650, 0, 339650),
  // Sanitarios · Baño secundario
  it("sanitario", "bano_secundario", "Grifería lavamanos Stellar Brushed", "Grifería lavamanos Stellar baja 12 cm.", "Klipen", 1, 90690, 0.19, 73459),
  it("sanitario", "bano_secundario", "Mueble WC Delfos Light Oak", "Mueble de baño colgante New Delfos 2 cajones 1000×450×600 mm.", "Klipen", 1, 339650, 0, 339650),
  // Cocina
  it("cocina", "cocina", "Horno empotrable Teka HLB 8400", "Horno empotrable 72 L, zona Halógena HBB 8300 FBK.", "Teka", 1, 287990, 0, 287990),
  it("cocina", "cocina", "Encimera a gas Teka EW 60", "Encimera gas 4 quemadores GG Lux 4G AI AL.", "Teka", 1, 147990, 0.10, 133191),
  it("cocina", "cocina", "Campana integrada Teka GFT 60", "Campana integrada GFT 60 flujo aire 603 m³/h.", "Teka", 1, 189990, 0.10, 170991),
  // Iluminación
  it("iluminacion", "otro", "Lámpara colgante LED 113 cm", "Lámpara colgante o sobrepuesta LED 40W CCT 3000-4000K, H8 6×113 cm.", "LED Studio", 2, 79900, 0, 79900),
  it("iluminacion", "otro", "Downlight LED slim 10 W", "Downlight LED Studio slim 10W luz cálida, neutra y fría.", "LED Studio", 7, 14490, 0, 14490),
];

const html = renderArtefactosHTML({
  project: { name: "Paseo del Sena", clientName: "Verónica Villarreal", address: "Las Condes", clientPhone: null, ufReference: null },
  budget: { version: "V2", date: "2026-06-11", observations: null },
  items,
  paymentTerms: [
    { stage: "Anticipo", percentage: 60 },
    { stage: "Despacho", percentage: 30 },
    { stage: "Saldo", percentage: 10 },
  ],
});

async function main() {
  const out = process.env.OUT || "/tmp/artefactos_gen.pdf";
  const pdf = await renderPDF(html, {
    format: "A4",
    margin: { top: "14mm", bottom: "14mm", left: "0", right: "0" },
  });
  fs.writeFileSync(out, pdf);
  console.log("PDF:", out);
}
main();
