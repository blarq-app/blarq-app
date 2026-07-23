// HTML del "PDF del mes" de Contabilidad → Gastos: el respaldo mensual de los
// gastos de la empresa que NO tienen documento electrónico del SII (boletas de
// papel y cargos internacionales). Lo consume renderPDF() (Puppeteer).
//
// Para qué existe: en el F22 estos gastos se declaran igual que los demás, pero
// el respaldo no lo puede sacar el SII — es la foto de la boleta. Este PDF junta
// la planilla del mes con la foto de cada respaldo, numeradas, en un solo
// archivo que se le puede pasar al contador o guardar por si preguntan.
//
// Formato elegido por MJ (22-jul-2026): planilla en la primera página, después
// una foto grande por respaldo, dos por hoja. El número de la primera columna
// de la planilla es el que rotula cada foto — es lo que ata la fila con su
// respaldo.
//
// NO calcula plata: recibe los mismos gastos que ya muestra la pantalla y los
// suma tal cual (son montos totales pagados, sin IVA recuperable).

export interface GastoPDFItem {
  // Número de orden dentro del mes (1, 2, 3…). Rotula la foto del respaldo.
  orden: number;
  fecha: Date;
  tipo: "boleta" | "internacional";
  // Número impreso en la boleta. Null cuando todavía no se cargó (o cuando es
  // un cargo internacional, que no tiene número de boleta chileno).
  numeroDoc: string | null;
  comercio: string | null;
  // Quién puso la plata: la persona a la que se le reembolsó, o "BLARQ" cuando
  // el cargo salió directo de la cuenta de la empresa.
  quienPago: string;
  monto: number;
  // Foto del respaldo, SOLO si es una imagen (data URL). El PDF mensual la
  // embebe a media página. Null = no hay imagen (o el respaldo es un PDF).
  foto: string | null;
  // El respaldo cargado es un PDF (factura de proveedor internacional). No se
  // puede embeber como imagen acá, así que en la planilla se marca "PDF" y el
  // documento vive adjunto en la app.
  respaldoPdf?: boolean;
}

export interface GastosMesPDFInput {
  mesNombre: string;
  year: number;
  items: GastoPDFItem[];
  emitidoEl: Date;
  // false = solo la planilla, sin las páginas de fotos (archivo liviano).
  incluirFotos: boolean;
}

const BLARQ_RUT = "77.270.733-9";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCLP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

// Fecha de un gasto: es un día calendario guardado a medianoche UTC, así que
// se formatea en UTC. Con getDate() (local) mostraría un día menos en Chile.
function fmtFecha(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// La fecha de emisión del PDF es un instante real (cuándo se generó), no un día
// calendario: se muestra en hora local.
function fmtEmitido(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function cabecera(titulo: string, emitidoEl: Date): string {
  return `<div class="head">
    <div>
      <div class="marca">BLARQ</div>
      <h1>${esc(titulo)}</h1>
      <div class="sub">Gastos de la empresa sin documento electrónico del SII — respaldo para el F22</div>
    </div>
    <div class="head-der">
      <div class="sub">Emitido ${fmtEmitido(emitidoEl)}</div>
      <div class="sub">RUT ${BLARQ_RUT}</div>
    </div>
  </div>`;
}

export function renderGastosMesHtml(input: GastosMesPDFInput): string {
  const { items, mesNombre, year, emitidoEl, incluirFotos } = input;

  const total = items.reduce((s, g) => s + g.monto, 0);
  const totalBoletas = items
    .filter((g) => g.tipo === "boleta")
    .reduce((s, g) => s + g.monto, 0);
  const totalInternacionales = items
    .filter((g) => g.tipo === "internacional")
    .reduce((s, g) => s + g.monto, 0);
  // Un gasto tiene respaldo si trae foto (imagen) o un PDF adjunto. Los que no
  // tienen ninguno son los que hay que perseguir.
  const conPdf = items.filter((g) => g.respaldoPdf).length;
  const sinRespaldo = items.filter((g) => !g.foto && !g.respaldoPdf).length;

  // Los gastos sin foto no ocupan página de respaldo, así que la página donde
  // cae cada foto se cuenta sobre los que SÍ tienen (dos por hoja, arrancando
  // en la 2). Calcularlo sobre el orden general dejaría la referencia corrida
  // apenas falte una foto.
  const conFotoItems = items.filter((g) => g.foto);
  const paginaDelRespaldo = new Map<number, number>();
  conFotoItems.forEach((g, i) => {
    paginaDelRespaldo.set(g.orden, 2 + Math.floor(i / 2));
  });

  const filas = items
    .map(
      (g) => `<tr>
      <td class="ord">${g.orden}</td>
      <td class="fecha">${fmtFecha(g.fecha)}</td>
      <td>${g.numeroDoc ? esc(g.numeroDoc) : '<span class="vacio">—</span>'}</td>
      <td>${g.comercio ? esc(g.comercio) : '<span class="vacio">sin nombre</span>'}</td>
      <td>${esc(g.quienPago)}</td>
      <td><span class="pill">${g.tipo === "boleta" ? "Boleta" : "Internac."}</span></td>
      <td class="num">${fmtCLP(g.monto)}</td>
      <td class="resp">${
        g.foto
          ? incluirFotos
            ? `pág. ${paginaDelRespaldo.get(g.orden)}`
            : "sí"
          : g.respaldoPdf
            ? "PDF"
            : '<span class="vacio">falta</span>'
      }</td>
    </tr>`
    )
    .join("");

  // Páginas de respaldos: dos fotos por hoja, en el mismo orden de la planilla.
  // Los gastos sin foto no ocupan página (aparecen como "falta" en la planilla).
  const paginasFotos: string[] = [];
  if (incluirFotos) {
    for (let i = 0; i < conFotoItems.length; i += 2) {
      const par = conFotoItems.slice(i, i + 2);
      paginasFotos.push(`<div class="page">
        ${cabecera(`${mesNombre} ${year} · Respaldos`, emitidoEl)}
        ${par
          .map(
            (g) => `<div class="respaldo">
              <div class="foto-wrap"><img src="${g.foto}" alt="Respaldo ${g.orden}" /></div>
              <div class="rot">
                <span><b>${g.orden}</b> · ${
                  g.tipo === "boleta"
                    ? g.numeroDoc
                      ? `Boleta N° ${esc(g.numeroDoc)}`
                      : "Boleta"
                    : "Cargo internacional"
                } · ${g.comercio ? esc(g.comercio) : "sin nombre"}</span>
                <span>${fmtFecha(g.fecha)} · ${esc(g.quienPago)} · <b>${fmtCLP(g.monto)}</b></span>
              </div>
            </div>`
          )
          .join("")}
      </div>`);
    }
  }

  const vacio = items.length === 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Gastos ${esc(mesNombre)} ${year} — BLARQ</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    margin: 0;
    font-size: 10pt;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
  }
  .page { padding: 14mm 15mm 16mm; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  .head {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 1px solid #111827; padding-bottom: 9px; margin-bottom: 16px;
  }
  .marca { font-size: 8pt; letter-spacing: .28em; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 15pt; margin: 5px 0 0; font-weight: 700; letter-spacing: -.01em; }
  .sub { font-size: 8pt; color: #6b7280; margin-top: 3px; }
  .head-der { text-align: right; }

  .tiles { display: flex; gap: 26px; margin: 14px 0 18px; }
  .tile .l { font-size: 7pt; letter-spacing: .1em; text-transform: uppercase; color: #9ca3af; }
  .tile .v { font-size: 14pt; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .tile.small .v { font-size: 11pt; font-weight: 500; color: #374151; }

  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th {
    text-align: left; font-size: 7pt; letter-spacing: .1em; text-transform: uppercase;
    color: #6b7280; font-weight: 600; padding: 0 8px 6px 0; border-bottom: 1px solid #d1d5db;
  }
  td { padding: 6px 8px 6px 0; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .num, .fecha { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .num { text-align: right; }
  .ord { color: #9ca3af; font-variant-numeric: tabular-nums; width: 20px; }
  .resp { font-size: 7.5pt; color: #9ca3af; white-space: nowrap; }
  .vacio { color: #9ca3af; }
  .pill {
    font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase;
    border: 1px solid #d1d5db; border-radius: 999px; padding: 1px 6px; color: #4b5563;
  }
  tr.tot td {
    border-top: 1px solid #111827; border-bottom: none;
    font-weight: 700; padding-top: 9px; font-size: 10pt;
  }

  .respaldo { margin-bottom: 14px; page-break-inside: avoid; }
  .foto-wrap {
    border: 1px solid #e5e7eb; background: #fafafa; height: 104mm;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .foto-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .rot {
    display: flex; justify-content: space-between; gap: 12px;
    font-size: 8pt; color: #4b5563; margin-top: 5px;
  }
  .rot b { color: #111827; }

  .pie {
    font-size: 7.5pt; color: #9ca3af; margin-top: 18px;
    border-top: 1px solid #f3f4f6; padding-top: 8px; line-height: 1.6;
  }
  .aviso-falta { color: #b45309; }
</style>
</head>
<body>
  <div class="page">
    ${cabecera(`${mesNombre} ${year}`, emitidoEl)}
    ${
      vacio
        ? `<p style="font-size:9pt;color:#6b7280;margin:26px 0">No hay gastos registrados en ${esc(
            mesNombre
          )} ${year}.</p>`
        : `<div class="tiles">
      <div class="tile"><div class="l">Total del mes</div><div class="v">${fmtCLP(total)}</div></div>
      <div class="tile small"><div class="l">Boletas</div><div class="v">${fmtCLP(totalBoletas)}</div></div>
      <div class="tile small"><div class="l">Internacionales</div><div class="v">${fmtCLP(totalInternacionales)}</div></div>
      <div class="tile small"><div class="l">Documentos</div><div class="v">${items.length}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th></th><th>Fecha</th><th>N° doc.</th><th>Comercio</th>
          <th>Quién pagó</th><th>Tipo</th><th class="num">Monto</th><th>Respaldo</th>
        </tr>
      </thead>
      <tbody>
        ${filas}
        <tr class="tot">
          <td></td>
          <td colspan="5">Total ${items.length} ${items.length === 1 ? "documento" : "documentos"}</td>
          <td class="num">${fmtCLP(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>`
    }
    <div class="pie">
      ${
        incluirFotos && conFotoItems.length > 0
          ? "El número de la primera columna corresponde a la foto del respaldo en las páginas siguientes.<br />"
          : !incluirFotos
            ? "Copia sin las fotos de los respaldos.<br />"
            : ""
      }
      Boletas y gastos internacionales no dan crédito de IVA: el monto es el costo total pagado.
      ${
        conPdf > 0
          ? `<br />${conPdf} ${
              conPdf === 1
                ? "gasto tiene su factura en PDF adjunta"
                : "gastos tienen su factura en PDF adjunta"
            } en la app (no se incluye acá).`
          : ""
      }
      ${
        sinRespaldo > 0
          ? `<br /><span class="aviso-falta">${sinRespaldo} ${
              sinRespaldo === 1 ? "gasto no tiene" : "gastos no tienen"
            } respaldo cargado.</span>`
          : ""
      }
    </div>
  </div>
  ${paginasFotos.join("\n")}
</body>
</html>`;
}
