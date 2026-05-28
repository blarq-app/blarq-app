// Render del Timbre Electrónico (TED) de un DTE como código de barras PDF417.
//
// El TED es un fragmento XML (<TED>...</TED>) que va dentro del DTE firmado.
// En la representación impresa de la factura, ese TED se muestra como un
// código de barras PDF417 (el cuadradito denso del pie). El SII lo exige.
//
// Acá NO generamos el TED (eso lo hace quien emite el DTE — el portal del SII
// en el camino B); solo lo dibujamos. Recibimos el string del TED tal cual
// viene en el XML del documento emitido y devolvemos un PNG como data URI,
// listo para <img src="..."> en el PDF.

import bwipjs from "bwip-js/node";

/**
 * Convierte el XML del TED en un código de barras PDF417 (PNG data URI).
 *
 * El formato PDF417 es el que define el SII para el timbre. Usamos error
 * correction level 5 (recomendado por el SII) y un escalado que da una
 * imagen nítida a ~50mm de ancho en el PDF.
 */
export async function renderTimbrePdf417(tedXml: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "pdf417",
    text: tedXml,
    eclevel: 5, // nivel de corrección de error recomendado por el SII
    columns: 18, // ancho del bloque; el alto se ajusta solo a los datos
    scaleX: 2,
    scaleY: 2,
    padding: 2,
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
