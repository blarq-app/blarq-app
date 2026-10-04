/**
 * Regresión del PDF cliente, sin base de datos ni cambios en presupuestos.
 * Datos del diseño 2a entregado por MJ; no son una consulta a la base viva.
 * Uso: node --import tsx scripts/test-muebles-pdf.ts [--render]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { renderMueblesHTML, type MueblesHTMLInput } from "../src/lib/pdf/MueblesPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import fixture from "./fixtures/muebles-diseno-2a.json";

const input: MueblesHTMLInput = fixture;
const original = JSON.stringify(input);
const html = renderMueblesHTML(input);
const $ = load(html);
assert.equal($('.pad-cover').length, 1, 'Conserva la portada');
assert.equal($('.mhd .ct').text(), 'Cant');
assert.deepEqual($('.mqty').map((_, el) => $(el).text()).get(), ['1', '1', '1']);
assert.deepEqual($('.mtt').map((_, el) => $(el).text()).get(), ['$ 25.133.276', '$ 2.598.001', '$ 3.906.624']);
assert.equal($('.tv').text(), '$ 31.637.901');
assert.equal($('.hrow').length, 8, 'Resume las medidas sin duplicar productos');
assert.equal($('.hqty').first().text(), '7 un');
assert.match($('.hname').first().text(), /500 × 1 \/ 450 × 4 \/ 350 × 2/);
assert.equal($('.hrow .speclbl').filter((_, el) => $(el).text() === 'Correderas').length, 1);
assert.equal($('.obs-item').length, 5);
assert.equal(JSON.stringify(input), original, 'Renderizar no modifica los datos');

const variants = structuredClone(input);
const base = variants.chapters[0].items[0];
base.quantity = 2;
base.alternativas = [{ ...base, name: 'Alternativa encina', quantity: 2, clientPriceIva: 30000000, details: [{ name: 'Frentes', material: 'Encina' }] }];
variants.budget.conditions = [];
const variantsHtml = load(renderMueblesHTML(variants));
assert.equal(variantsHtml('.tv').text(), '$ 56.771.177', 'Multiplica cantidades; excluye alternativas');
assert.equal(variantsHtml('.alt-price').text(), '$ 60.000.000');
assert.equal(variantsHtml('.obs').length, 0, 'Sin condiciones no imprime un título vacío');

const separated = structuredClone(input);
const hardware = separated.chapters[0].items[1];
const h = hardware.herrajes![0];
hardware.herrajes = [
  { ...h, brand: 'Blum · HBT', measure: '500mm', quantity: 1, sector: 'UBICACIÓN INTERNA' },
  { ...h, brand: 'Blum · HBT', measure: '450mm', quantity: 2 },
  { ...h, brand: 'Blum · HBT', measure: '450mm', quantity: 3 },
  { ...h, brand: 'DPH', measure: '450mm', quantity: 4 },
  { ...h, brand: 'Blum · HBT', finish: 'Negro', quantity: 5 },
  { ...h, name: 'Cajón alto 183mm', brand: 'Blum · HBT', quantity: 6 },
  { ...h, name: '<script> & producto manual', category: null, measure: null, quantity: 0.5 },
];
const separatedHtml = renderMueblesHTML(separated);
const sep = load(separatedHtml);
assert.equal(sep('.hrow').length, 5, 'No mezcla proveedores, acabados ni modelos');
assert.equal(sep('.hqty').first().text(), '6 un');
assert.match(sep('.hname').first().text(), /500mm × 1 \/ 450mm × 5/);
assert.equal(sep('.hqty').last().text(), '0,5 un');
assert.ok(!separatedHtml.includes('UBICACIÓN INTERNA'), 'La ubicación no llega al cliente');
assert.equal(sep('script').length, 0, 'Los textos se escapan');
assert.match(sep('.hname').last().text(), /&/);
console.log('PDF muebles: portada, montos, cantidades, agrupación, alternativas y textos verificados.');

async function main() {
  if (!process.argv.includes('--render')) return;
  const out = path.resolve('output/pdf');
  fs.mkdirSync(out, { recursive: true });
  const documents: [string, MueblesHTMLInput][] = [['presupuesto-muebles-candelaria', input]];
  const long = structuredClone(input);
  long.chapters = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(input.chapters[0]), name: `Ambiente ${i + 1}` }));
  long.chapters[0].items[0].alternativas = base.alternativas;
  long.chapters[1].items[0].details = Array.from({ length: 90 }, (_, i) => ({ name: `Componente ${i + 1}`, material: 'Materialidad extensa para verificar saltos de página sin cortes ni superposición. '.repeat(3) }));
  documents.push(['verificacion-muebles-multipagina', long]);
  for (const [name, data] of documents) {
    const content = renderMueblesHTML(data);
    fs.writeFileSync(path.join(out, `${name}.html`), content);
    fs.writeFileSync(path.join(out, `${name}.pdf`), await renderPDF(content, { preferCSSPageSize: true }));
    console.log(`PDF generado: ${path.join(out, `${name}.pdf`)}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
