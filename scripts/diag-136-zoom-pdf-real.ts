/**
 * Pendiente 136 — zoom sobre el PDF REAL (no sobre el HTML en pantalla).
 *
 * Al mirar el HTML en pantalla, Chromium redondea los bordes a píxeles enteros
 * y 0.75 / 0.6 / 0.4px se ven casi iguales. En el PDF la línea es vectorial y
 * el grosor se respeta. Por eso esta lámina abre los PDFs ya generados por
 * scripts/diag-136-linea-capitulo-grosores.ts en el visor de PDF de Chromium,
 * con zoom, y recorta la línea del capítulo 1.
 *
 * Correr después del script de grosores:
 *   npx tsx scripts/diag-136-zoom-pdf-real.ts
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const OUT = "/tmp/blarq-136-linea-capitulo";
const GROSORES = ["1px", "0.75px", "0.6px", "0.4px"];
const ROTULOS: Record<string, string> = {
  "1px": "1px — ACTUAL",
  "0.75px": "0.75px",
  "0.6px": "0.6px — alineada con los títulos de bloque",
  "0.4px": "0.4px",
};

// Recortes dentro del visor, en px de viewport. Todos los PDFs tienen el mismo
// layout (solo cambia el grosor), así que los mismos recortes sirven para los
// cuatro: uno al 100% (cómo se lee de verdad) y otro al 300% (para verla).
const VISTAS = [
  { nombre: "real", zoom: 100, clip: { x: 453, y: 248, width: 786, height: 118 } },
  { nombre: "zoom", zoom: 300, clip: { x: 458, y: 712, width: 820, height: 112 } },
];

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const capturas: { vista: string; grosor: string; uri: string }[] = [];

  // El visor de PDF pinta la página cuando quiere: si se captura antes, sale el
  // fondo gris oscuro del visor. Esta página auxiliar mide el brillo promedio
  // del recorte para saber si ya está la hoja blanca o hay que esperar más.
  const medidor = await browser.newPage();
  await medidor.setContent("<canvas id='c'></canvas>", { waitUntil: "load" });
  const brillo = (uri: string) =>
    medidor.evaluate(async (u: string) => {
      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.src = u;
      });
      const c = document.getElementById("c") as HTMLCanvasElement;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let suma = 0;
      for (let i = 0; i < d.length; i += 4) suma += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return suma / (d.length / 4);
    }, uri);

  try {
    for (const vista of VISTAS) {
      for (const grosor of GROSORES) {
        const pdf = path.join(OUT, `algarrobos-v1-cap-${grosor.replace(".", "_")}.pdf`);
        if (!fs.existsSync(pdf)) throw new Error(`Falta ${pdf}`);

        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
        await page.goto(`file://${pdf}#page=2&zoom=${vista.zoom}`, {
          waitUntil: "networkidle0",
          timeout: 60_000,
        });
        // Reintenta hasta que el recorte deje de ser el fondo oscuro del visor.
        let png = "";
        for (let intento = 1; intento <= 12; intento++) {
          await new Promise((r) => setTimeout(r, 2500));
          png = (await page.screenshot({
            clip: { ...vista.clip, scale: 2 },
            encoding: "base64",
          })) as unknown as string;
          const b = await brillo(`data:image/png;base64,${png}`);
          if (b > 150) break;
          // A veces el visor se queda pegado sin pintar: recargarlo lo destraba.
          if (intento % 4 === 0) await page.reload({ waitUntil: "networkidle0" });
          if (intento === 12) throw new Error(`El visor no pintó la página (${grosor})`);
        }

        fs.writeFileSync(
          path.join(OUT, `pdf-${vista.nombre}-${grosor.replace(".", "_")}.png`),
          Buffer.from(png, "base64")
        );
        capturas.push({ vista: vista.nombre, grosor, uri: `data:image/png;base64,${png}` });
        console.log(`${vista.nombre.padEnd(4)} ${grosor.padStart(7)} capturado del PDF`);
        await page.close();
      }
    }

    for (const vista of VISTAS) {
      const titulo =
        vista.nombre === "real"
          ? "Cómo se lee de verdad (tamaño real del PDF)"
          : "La misma línea, ampliada 3 veces";
      const lamina = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 22px; background: #fff; font-family: -apple-system, sans-serif; }
        h1 { font-size: 15px; font-weight: 600; color: #36322C; margin: 0 0 4px; }
        .sub { font-size: 11px; color: #9B9182; margin-bottom: 20px; }
        .caso { margin-bottom: 18px; }
        .rot { font-size: 12px; font-weight: 700; color: #36322C; margin-bottom: 5px; letter-spacing: .04em; }
        img { display: block; width: 660px; border: 1px solid #E7E6E4; }
      </style></head><body>
        <h1>${titulo} — Casa Los Algarrobos V1</h1>
        <div class="sub">Recorte del PDF real. Los cuatro son idénticos salvo el grosor de la línea bajo "1 · DEMOLICIONES".</div>
        ${capturas
          .filter((c) => c.vista === vista.nombre)
          .map(
            (c) => `<div class="caso">
          <div class="rot">${ROTULOS[c.grosor] ?? c.grosor}</div>
          <img src="${c.uri}" />
        </div>`
          )
          .join("")}
      </body></html>`;

      const p = await browser.newPage();
      await p.setViewport({ width: 720, height: 900, deviceScaleFactor: 2 });
      await p.setContent(lamina, { waitUntil: "load" });
      const file = path.join(OUT, `comparativa-pdf-${vista.nombre}.png`);
      fs.writeFileSync(file, await p.screenshot({ fullPage: true }));
      console.log(`lámina → ${file}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
