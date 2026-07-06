// Genera el "Manual de Marca BLARQ v2 Claro" como PDF editorial, usando las
// tipografías y la paleta greige reales — el manual ES un ejemplo de sí mismo.
// Incorpora los arreglos surgidos de la crítica de Impeccable (marcados NUEVO).
// No toca la app ni datos; solo produce un PDF/PNG para MJ.
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const ASSETS = path.resolve(process.env.HOME, "Desktop/blarq-marca/public/assets");
const dataUri = (f) => {
  const p = path.join(ASSETS, f);
  const b = fs.readFileSync(p).toString("base64");
  const ext = path.extname(f).slice(1).replace("jpeg", "jpeg");
  return `data:image/${ext};base64,${b}`;
};
const iso = dataUri("blarq-isotipo-piedra.png");
const logo = dataUri("blarq-logo-horizontal-ink.png");

// Paleta greige + contraste medido sobre blanco (regla AA: cuerpo>=4.5, grande>=3.0)
const PAL = [
  ["Tinta", "#38342D", 12.65, "Texto principal, títulos"],
  ["Grafito", "#5C5449", 7.70, "Texto, íconos"],
  ["Piedra", "#776E60", 5.32, "Texto secundario (piso legible)"],
  ["Taupe", "#9D9385", 3.11, "Solo títulos grandes / etiquetas"],
  ["Greige", "#C2BCB4", 1.92, "Bordes"],
  ["Lino", "#E3E1DF", 1.30, "Divisores, fondos suaves"],
  ["Bruma", "#F4F4F4", 1.10, "Fondo más claro"],
  ["Banda", "#EDEDEC", 1.17, "Bandas de tabla, chips"],
];
const badge = (r) =>
  r >= 4.5
    ? `<span class="cb ok">texto ✓</span>`
    : r >= 3.0
    ? `<span class="cb mid">solo grande</span>`
    : `<span class="cb no">no texto</span>`;

const swatch = ([n, hex, r, use]) => `
  <div class="sw">
    <div class="chip" style="background:${hex}"></div>
    <div class="swb">
      <div class="swtop"><b>${n}</b><span class="hex">${hex}</span></div>
      <div class="swuse">${use}</div>
      <div class="swc">${r.toFixed(2)}:1 &nbsp; ${badge(r)}</div>
    </div>
  </div>`;

const N = `<span class="nuevo">NUEVO</span>`;

const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Nunito Sans',sans-serif; color:#38342D; font-size:10pt; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { position:relative; width:210mm; min-height:297mm; padding:18mm 18mm 16mm; page-break-after:always; overflow:hidden; background:#fff; }
  .page:last-child { page-break-after:auto; }
  h1,h2,h3 { font-family:'Hanken Grotesk',sans-serif; font-weight:200; text-transform:uppercase; color:#38342D; margin:0; }
  .kick { font-size:6.4pt; letter-spacing:.28em; text-transform:uppercase; color:#9D9385; font-weight:700; }
  .baj { font-family:'Spectral',serif; font-style:italic; color:#776E60; }
  .rule { height:1px; background:#C2BCB4; border:0; margin:5mm 0; }

  /* Portada */
  .cover { display:flex; flex-direction:column; justify-content:space-between; }
  .cwm { position:absolute; right:-8mm; bottom:14mm; width:92mm; opacity:.06; z-index:0; }
  .ctop,.cmid,.cfoot { position:relative; z-index:1; }
  .clogo { width:34mm; opacity:.78; }
  .ctitle { font-size:30pt; letter-spacing:.14em; line-height:1.1; margin-top:2mm; }
  .csub { font-family:'Spectral',serif; font-style:italic; font-size:14pt; color:#9D9385; margin-top:3mm; }
  .cmeta { font-size:6.6pt; letter-spacing:.22em; text-transform:uppercase; color:#9D9385; font-weight:700; }

  /* Secciones */
  .sechead { display:flex; align-items:baseline; gap:5mm; border-bottom:1px solid #38342D; padding-bottom:2.5mm; margin-bottom:5mm; }
  .sechead h2 { font-size:15pt; letter-spacing:.12em; }
  .sechead .no { font-family:'Hanken Grotesk'; font-weight:200; font-size:15pt; color:#C2BCB4; }
  .block { margin-bottom:6mm; }
  .lbl { font-size:6.4pt; letter-spacing:.2em; text-transform:uppercase; color:#9D9385; font-weight:700; margin-bottom:1.5mm; }

  /* Tipografía specimens */
  .spec { border:1px solid #E3E1DF; border-radius:8px; padding:5mm 6mm; margin-bottom:4mm; }
  .spec .role { font-size:6.4pt; letter-spacing:.2em; text-transform:uppercase; color:#9D9385; font-weight:700; }
  .spec .sample { margin-top:2.5mm; }
  .s-nunito { font-family:'Nunito Sans'; font-size:11pt; }
  .s-nunito .nums { font-variant-numeric:tabular-nums; font-weight:700; letter-spacing:.01em; }
  .s-hanken { font-family:'Hanken Grotesk'; font-weight:200; text-transform:uppercase; letter-spacing:.14em; font-size:19pt; color:#38342D; }
  .s-spectral { font-family:'Spectral'; font-style:italic; font-size:13pt; color:#776E60; }
  .note { font-size:8.5pt; color:#5C5449; margin-top:1.5mm; }

  /* Paleta */
  .swgrid { display:grid; grid-template-columns:1fr 1fr; gap:3mm 6mm; }
  .sw { display:flex; gap:3mm; align-items:stretch; }
  .chip { width:16mm; border-radius:6px; border:1px solid #E3E1DF; flex:0 0 auto; }
  .swb { flex:1; min-width:0; }
  .swtop { display:flex; justify-content:space-between; align-items:baseline; }
  .swtop b { font-weight:700; }
  .hex { font-variant-numeric:tabular-nums; color:#9D9385; font-size:8.5pt; }
  .swuse { font-size:8.5pt; color:#776E60; margin:.5mm 0; }
  .swc { font-size:8pt; color:#5C5449; font-variant-numeric:tabular-nums; }
  .cb { display:inline-block; padding:1px 6px; border-radius:999px; font-size:6.6pt; font-weight:700; letter-spacing:.02em; vertical-align:middle; }
  .cb.ok { background:#e6f4ea; color:#217a3b; }
  .cb.mid { background:#fbf1dc; color:#9a6a12; }
  .cb.no { background:#ECECEB; color:#9D9385; }

  /* Callouts */
  .callout { border:1px solid #E3E1DF; border-radius:8px; padding:4mm 5mm; margin-bottom:4mm; background:#F4F4F4; }
  .callout.key { border-color:#C2BCB4; background:#EDEDEC; }
  .callout .ch { font-family:'Hanken Grotesk'; font-weight:200; text-transform:uppercase; letter-spacing:.1em; font-size:11pt; margin-bottom:1.5mm; }
  .callout p { margin:.5mm 0; font-size:9pt; color:#5C5449; }
  .nuevo { display:inline-block; background:#38342D; color:#fff; font-family:'Nunito Sans'; font-size:5.6pt; font-weight:700; letter-spacing:.14em; padding:1px 5px; border-radius:999px; vertical-align:middle; margin-left:3px; }

  /* Semántico */
  .chips { display:flex; gap:4mm; flex-wrap:wrap; }
  .sem { display:flex; align-items:center; gap:2.5mm; border:1px solid #E3E1DF; border-radius:999px; padding:2mm 4mm; font-size:9pt; }
  .dot { width:9px; height:9px; border-radius:999px; }

  /* Reglas de forma en grilla */
  .rules { display:grid; grid-template-columns:1fr 1fr; gap:3mm 6mm; }
  .rc { border-top:1px solid #E3E1DF; padding-top:2mm; }
  .rc .rt { font-weight:700; font-size:9pt; }
  .rc .rd { font-size:8.5pt; color:#776E60; }

  .dodont { display:grid; grid-template-columns:1fr 1fr; gap:6mm; }
  .dd h3 { font-size:10pt; letter-spacing:.1em; margin-bottom:2mm; }
  .dd ul { margin:0; padding-left:4mm; }
  .dd li { font-size:8.6pt; color:#5C5449; margin:1mm 0; }
  .foot { position:absolute; bottom:9mm; left:18mm; right:18mm; display:flex; justify-content:space-between; font-size:6.4pt; letter-spacing:.16em; text-transform:uppercase; color:#AEA699; border-top:1px solid #E3E1DF; padding-top:2mm; }
`;

const foot = (n) => `<div class="foot"><span>BLARQ · Manual de Marca v2 Claro</span><span>${n}</span></div>`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>

<!-- PORTADA -->
<div class="page cover">
  <img class="cwm" src="${iso}" />
  <div class="ctop">
    <img class="clogo" src="${logo}" />
  </div>
  <div class="cmid">
    <hr class="rule" style="width:14mm;margin:0 0 5mm">
    <div class="kick">Sistema visual · App y documentos</div>
    <h1 class="ctitle">Manual de<br>marca</h1>
    <div class="csub">BLARQ · v2 Claro — revisado</div>
  </div>
  <div class="cfoot">
    <div class="cmeta">Blanco Larraín Arquitectos · Julio 2026</div>
    <div class="baj" style="font-size:9pt;margin-top:2mm;color:#9D9385;">Incorpora los ajustes de la revisión de diseño (marcados <span class="nuevo">NUEVO</span>).</div>
  </div>
</div>

<!-- TIPOGRAFÍA -->
<div class="page">
  <div class="sechead"><span class="no">01</span><h2>Tipografía</h2></div>
  <div class="baj" style="font-size:10pt;margin-bottom:5mm;">Tres roles, una voz. La jerarquía la hacen el tamaño, la caja y el espaciado — no el color.</div>

  <div class="spec">
    <div class="role">Cuerpo · datos · cifras — Nunito Sans</div>
    <div class="sample s-nunito">Cotización de obra, facturas y estados de pago. Los números van tabulares y alineados:
      <span class="nums">$ 12.480.900 · 34,7% · 145.630-8</span></div>
  </div>
  <div class="spec">
    <div class="role">Títulos — Hanken Grotesk ExtraLight, mayúsculas</div>
    <div class="sample s-hanken">Remodelación integral</div>
  </div>
  <div class="spec">
    <div class="role">Bajadas y citas — Spectral itálica</div>
    <div class="sample s-spectral">Compras del período · conciliación con banco</div>
  </div>

  <hr class="rule">
  <div class="lbl">Reglas de uso</div>
  <div class="callout key">
    <div class="ch">Piso de peso ExtraLight ${N}</div>
    <p>Hanken ExtraLight (200) solo en títulos grandes (≥ 18px / ~13pt). Más chico que eso se ve desteñido en pantalla y en PDF → subir a peso 300–400.</p>
  </div>
  <div class="callout">
    <div class="ch">Hanken vive en su carril ${N}</div>
    <p>Hanken solo en mayúsculas de título (display). Nunca en texto corrido: son dos sans y solo conviven si tienen roles bien separados. El cuerpo siempre es Nunito.</p>
  </div>
  <div class="callout">
    <div class="ch">El "mini-título en mayúsculas" se reserva ${N}</div>
    <p>Las mayúsculas espaciadas son la voz del título de página. No repetirlas como etiqueta en cada tarjeta y cada sección: en exceso se vuelven un tic. Para etiquetas chicas, Nunito 600 en caja normal.</p>
  </div>
  ${foot("01 · Tipografía")}
</div>

<!-- PALETA -->
<div class="page">
  <div class="sechead"><span class="no">02</span><h2>Paleta greige</h2></div>
  <div class="baj" style="font-size:10pt;margin-bottom:5mm;">Ocho neutros de una sola temperatura, grises apenas tibios — sin el amarillo que se leía crema. Fondo blanco: nunca beige.</div>

  <div class="swgrid">
    ${PAL.map(swatch).join("")}
  </div>

  <hr class="rule">
  <div class="callout key">
    <div class="ch">Piso de contraste ${N}</div>
    <p><b>De Taupe (#9D9385) hacia arriba (más claro): prohibido para texto que haya que leer.</b> Falla la legibilidad AA (necesita 4.5:1). El texto secundario y los "placeholder" van en Piedra (#776E60) o más oscuro.</p>
    <p>Taupe se permite solo en etiquetas grandes o decoración. Greige, Lino, Bruma y Banda: únicamente bordes, divisores y fondos — nunca texto.</p>
  </div>
  ${foot("02 · Paleta")}
</div>

<!-- COLOR SEMÁNTICO + FORMA -->
<div class="page">
  <div class="sechead"><span class="no">03</span><h2>Color semántico</h2></div>
  <div class="baj" style="font-size:10pt;margin-bottom:4mm;">El único color permitido, y solo cuando significa algo. El default es gris — nunca verde por inercia.</div>
  <div class="chips" style="margin-bottom:5mm;">
    <span class="sem"><span class="dot" style="background:#a52a2a"></span> Rojo — excedido · vencido · error</span>
    <span class="sem"><span class="dot" style="background:#217a3b"></span> Verde — pagado · confirmado</span>
    <span class="sem"><span class="dot" style="background:#9a6a12"></span> Ámbar — atención</span>
  </div>
  <div class="callout"><p>Sin morado, sin rosado, sin acentos decorativos. Un valor "OK" no se pinta de verde salvo que ese "OK" sea el dato relevante.</p></div>

  <div class="sechead" style="margin-top:8mm;"><span class="no">04</span><h2>Forma y densidad</h2></div>
  <div class="rules">
    <div class="rc"><div class="rt">Sombras</div><div class="rd">shadow-sm como máximo. Sin sombras gruesas.</div></div>
    <div class="rc"><div class="rt">Bordes</div><div class="rd">1px siempre. Nunca 2–3px decorativos.</div></div>
    <div class="rc"><div class="rt">Esquinas</div><div class="rd">rounded-xl (cards) · rounded-full (badges) · rounded (inputs/botones). Nada de rounded-none ni 3xl.</div></div>
    <div class="rc"><div class="rt">Tablas</div><div class="rd">Densas, sin alternancia de color. Totales con borde superior y peso bold.</div></div>
    <div class="rc"><div class="rt">Íconos</div><div class="rd">Monocromáticos (lucide). Sin emojis, en UI ni en código.</div></div>
    <div class="rc"><div class="rt">El cero es discreto</div><div class="rd">0 / $0 / 0% en gris claro o "—". No compite por atención.</div></div>
  </div>
  ${foot("03–04 · Color y forma")}
</div>

<!-- QUÉ EVITAR -->
<div class="page">
  <div class="sechead"><span class="no">05</span><h2>Qué cuidar</h2></div>
  <div class="baj" style="font-size:10pt;margin-bottom:5mm;">De la revisión de diseño: dónde este sistema se puede tropezar, y qué lo hace de BLARQ y no "genérico bonito".</div>

  <div class="callout key">
    <div class="ch">El greige está de moda ${N}</div>
    <p>Greige + sans fina en mayúsculas + bajada en serif itálica es, hoy, una estética que abunda. Lo que hace única a BLARQ no es la paleta: es la <b>densidad de datos, los números tabulares y la disciplina del cero</b>. Apoyarse en eso, no en el color.</p>
  </div>

  <div class="dodont">
    <div class="dd">
      <h3>Sí</h3>
      <ul>
        <li>Texto legible: Piedra o más oscuro.</li>
        <li>Tablas densas, números alineados.</li>
        <li>Color solo con significado.</li>
        <li>Títulos grandes en ExtraLight; el resto con más peso.</li>
        <li>Jerarquía por tamaño y caja.</li>
      </ul>
    </div>
    <div class="dd">
      <h3>No</h3>
      <ul>
        <li>Gris apagado (Taupe+) sobre blanco para leer.</li>
        <li>Mayúsculas espaciadas en cada tarjeta.</li>
        <li>Hanken en texto corrido.</li>
        <li>Fondo beige "para dar calor".</li>
        <li>Verde/colores por inercia o decoración.</li>
      </ul>
    </div>
  </div>

  <hr class="rule">
  <div class="baj" style="font-size:9pt;color:#9D9385;">Revisión asistida por Impeccable (skill de diseño) sobre el manual v2 Claro · Julio 2026. Los ítems <span class="nuevo">NUEVO</span> son los cambios respecto de la versión anterior.</div>
  ${foot("05 · Qué cuidar")}
</div>

</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400)); // asegurar fuentes
const out = process.env.OUT || "/tmp/manual-marca.pdf";
await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
fs.writeSync(1, `PDF: ${out}\n`);
