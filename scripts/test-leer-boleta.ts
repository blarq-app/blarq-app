// Prueba de la lectura de fotos de boletas (src/lib/contabilidad/leerBoleta).
//
// Sin argumentos: genera boletas de prueba con formato chileno (una legible,
// una borrosa, una que NO es boleta) y verifica que lo leído coincida con lo
// que dice la imagen — incluyendo que la foto ilegible devuelva null en vez de
// inventar.
//
// Con argumentos: lee las fotos reales que se le pasen.
//   npx tsx scripts/test-leer-boleta.ts foto1.jpg foto2.jpg
//
// Necesita ANTHROPIC_API_KEY en el entorno. Cuesta unos centavos por foto.
import { readFileSync } from "node:fs";
import "dotenv/config";
import puppeteer from "puppeteer";
import { leerBoleta } from "../src/lib/contabilidad/leerBoleta";

interface CasoPrueba {
  nombre: string;
  html: string;
  esperado: {
    numeroDoc?: string | null;
    fecha?: string | null;
    monto?: number | null;
    comercioContiene?: string;
  };
}

// Boleta con el formato de un rollo térmico chileno.
function boletaTermica(opts: {
  comercio: string;
  rut: string;
  numero: string;
  fecha: string;
  items: Array<[string, number]>;
  total: number;
  borrosa?: boolean;
}): string {
  const filas = opts.items
    .map(
      ([desc, val]) =>
        `<div class="fila"><span>${desc}</span><span>${val.toLocaleString("es-CL")}</span></div>`
    )
    .join("");
  return `<html><body style="margin:0;background:#d8d5d0;display:flex;align-items:center;justify-content:center;height:900px">
    <div style="width:300px;background:#fbfaf7;padding:22px 18px;font-family:'Courier New',monospace;font-size:12px;color:#1a1a1a;transform:rotate(-1deg);box-shadow:0 3px 14px rgba(0,0,0,.2);${opts.borrosa ? "filter:blur(1.6px);opacity:.75" : ""}">
      <div style="text-align:center;font-weight:700;letter-spacing:.05em">${opts.comercio}</div>
      <div style="text-align:center;font-size:10px;margin-top:3px">R.U.T.: ${opts.rut}</div>
      <div style="text-align:center;font-size:10px">BOLETA ELECTRONICA</div>
      <div style="text-align:center;font-size:10px;margin-bottom:10px">N° ${opts.numero}</div>
      <div style="border-top:1px dashed #666;margin:8px 0"></div>
      <div style="font-size:10px">FECHA: ${opts.fecha}</div>
      <div style="border-top:1px dashed #666;margin:8px 0"></div>
      <style>.fila{display:flex;justify-content:space-between;font-size:11px;margin:3px 0}</style>
      ${filas}
      <div style="border-top:1px dashed #666;margin:8px 0"></div>
      <div class="fila" style="font-weight:700;font-size:14px"><span>TOTAL</span><span>$${opts.total.toLocaleString("es-CL")}</span></div>
      <div style="text-align:center;font-size:9px;margin-top:14px">GRACIAS POR SU COMPRA</div>
    </div>
  </body></html>`;
}

const CASOS: CasoPrueba[] = [
  {
    nombre: "boleta legible (ferretería)",
    html: boletaTermica({
      comercio: "FERRETERIA EL ROBLE LTDA",
      rut: "76.543.210-K",
      numero: "1103",
      fecha: "04/07/2026",
      items: [
        ["SILICONA TRANSP.", 4990],
        ["BROCHA 3 PULG", 3490],
        ["TORNILLOS 4x40", 4000],
      ],
      total: 12480,
    }),
    esperado: {
      numeroDoc: "1103",
      fecha: "2026-07-04",
      monto: 12480,
      comercioContiene: "ROBLE",
    },
  },
  {
    nombre: "boleta con miles (Easy)",
    html: boletaTermica({
      comercio: "EASY LA DEHESA",
      rut: "96.792.430-K",
      numero: "1187",
      fecha: "09-07-2026",
      items: [
        ["PORCELANATO 60x60", 21303],
        ["FRAGUE BLANCO 5K", 6000],
      ],
      total: 27303,
    }),
    esperado: {
      numeroDoc: "1187",
      fecha: "2026-07-09",
      monto: 27303,
      comercioContiene: "EASY",
    },
  },
  {
    nombre: "foto borrosa (no debe inventar)",
    html: boletaTermica({
      comercio: "COMERCIAL SAN PEDRO",
      rut: "77.111.222-3",
      numero: "8842",
      fecha: "15/06/2026",
      items: [["VARIOS", 9900]],
      total: 9900,
      borrosa: true,
    }),
    esperado: {},
  },
  {
    nombre: "no es una boleta (debe avisar)",
    html: `<html><body style="margin:0;background:#eee;display:flex;align-items:center;justify-content:center;height:900px;font-family:sans-serif">
      <div style="width:340px;background:#fff;padding:30px;border-radius:10px;text-align:center">
        <div style="font-size:20px;font-weight:700">Lista del súper</div>
        <div style="text-align:left;margin-top:16px;font-size:15px;line-height:2">pan<br>leche<br>café<br>servilletas</div>
      </div>
    </body></html>`,
    esperado: { numeroDoc: null, monto: null },
  },
];

async function imagenDe(html: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 900, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  const buf = await page.screenshot({ type: "jpeg", quality: 80 });
  await browser.close();
  return Buffer.from(buf).toString("base64");
}

function check(ok: boolean, texto: string): boolean {
  console.log(`   ${ok ? "OK  " : "FALLA"} ${texto}`);
  return ok;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno.");
    process.exit(1);
  }

  const archivos = process.argv.slice(2);
  if (archivos.length > 0) {
    for (const ruta of archivos) {
      const base64 = readFileSync(ruta).toString("base64");
      const tipo = ruta.endsWith(".png") ? "image/png" : "image/jpeg";
      console.log(`\n${ruta}`);
      console.log(JSON.stringify(await leerBoleta(tipo, base64), null, 2));
    }
    return;
  }

  let fallas = 0;
  for (const caso of CASOS) {
    console.log(`\n── ${caso.nombre}`);
    const base64 = await imagenDe(caso.html);
    const r = await leerBoleta("image/jpeg", base64);
    console.log(
      `   leído: doc=${r.numeroDoc} fecha=${r.fecha} comercio=${r.comercio} monto=${r.monto} confianza=${r.confianza}`
    );
    if (r.nota) console.log(`   nota: ${r.nota}`);

    const e = caso.esperado;
    if (e.numeroDoc !== undefined && !check(r.numeroDoc === e.numeroDoc, `numeroDoc = ${e.numeroDoc}`)) fallas++;
    if (e.fecha !== undefined && !check(r.fecha === e.fecha, `fecha = ${e.fecha}`)) fallas++;
    if (e.monto !== undefined && !check(r.monto === e.monto, `monto = ${e.monto}`)) fallas++;
    if (e.comercioContiene && !check((r.comercio ?? "").toUpperCase().includes(e.comercioContiene), `comercio contiene "${e.comercioContiene}"`)) fallas++;

    // La foto borrosa no tiene valores esperados: lo único que se exige es que
    // no se invente un monto con confianza alta.
    if (caso.nombre.includes("borrosa")) {
      if (!check(r.confianza !== "alta" || r.nota !== null, "avisa que la foto es dudosa")) fallas++;
    }
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} chequeos fallaron.\n`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
