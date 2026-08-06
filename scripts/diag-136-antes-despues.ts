/**
 * Pendiente 136 — lámina antes/después con lo que quedó elegido (0.6px #625A4F).
 *
 * Compara el PDF con la línea de hoy (1px tinta plena) contra el PDF generado
 * con el código ya modificado. Ambos ya existen en /tmp; este script solo los
 * abre en el visor de Chromium y recorta la línea.
 *
 * Correr: npx tsx scripts/diag-136-antes-despues.ts
 */
import fs from "node:fs";
import puppeteer from "puppeteer";

const PARES = [
  {
    file: "/tmp/blarq-136-linea-capitulo/algarrobos-v1-cap-1px.pdf",
    rotulo: "ANTES — 1px, tinta plena (#36322C)",
  },
  {
    file: "/tmp/blarq-136-linea-capitulo/FINAL-algarrobos-v1.pdf",
    rotulo: "DESPUÉS — 0.6px, #625A4F",
  },
];

const VISTAS = [
  { nombre: "real", zoom: 100, clip: { x: 453, y: 248, width: 786, height: 118 } },
  { nombre: "zoom", zoom: 300, clip: { x: 458, y: 712, width: 820, height: 112 } },
];

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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

  const capturas: { vista: string; rotulo: string; uri: string }[] = [];

  try {
    for (const vista of VISTAS) {
      for (const par of PARES) {
        if (!fs.existsSync(par.file)) throw new Error(`Falta ${par.file}`);
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
        await page.goto(`file://${par.file}#page=2&zoom=${vista.zoom}`, {
          waitUntil: "networkidle0",
          timeout: 60_000,
        });
        let png = "";
        for (let intento = 1; intento <= 12; intento++) {
          await new Promise((r) => setTimeout(r, 2500));
          png = (await page.screenshot({
            clip: { ...vista.clip, scale: 2 },
            encoding: "base64",
          })) as unknown as string;
          if ((await brillo(`data:image/png;base64,${png}`)) > 150) break;
          if (intento % 4 === 0) await page.reload({ waitUntil: "networkidle0" });
          if (intento === 12) throw new Error(`El visor no pintó (${par.rotulo})`);
        }
        capturas.push({ vista: vista.nombre, rotulo: par.rotulo, uri: `data:image/png;base64,${png}` });
        console.log(`${vista.nombre.padEnd(4)} ${par.rotulo}`);
        await page.close();
      }
    }

    for (const vista of VISTAS) {
      const lamina = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 22px; background: #fff; font-family: -apple-system, sans-serif; }
        h1 { font-size: 15px; font-weight: 600; color: #36322C; margin: 0 0 4px; }
        .sub { font-size: 11px; color: #9B9182; margin-bottom: 18px; }
        .caso { margin-bottom: 20px; }
        .rot { font-size: 12px; font-weight: 700; color: #36322C; margin-bottom: 5px; letter-spacing: .04em; }
        img { display: block; width: 660px; border: 1px solid #E7E6E4; }
      </style></head><body>
        <h1>Antes / después — ${vista.nombre === "real" ? "tamaño real del PDF" : "ampliado 3 veces"}</h1>
        <div class="sub">Casa Los Algarrobos V1, PDF real generado desde la base viva.</div>
        ${capturas
          .filter((c) => c.vista === vista.nombre)
          .map((c) => `<div class="caso"><div class="rot">${c.rotulo}</div><img src="${c.uri}" /></div>`)
          .join("")}
      </body></html>`;
      const p = await browser.newPage();
      await p.setViewport({ width: 720, height: 800, deviceScaleFactor: 2 });
      await p.setContent(lamina, { waitUntil: "load" });
      const out = `/tmp/blarq-136-linea-capitulo/antes-despues-${vista.nombre}.png`;
      fs.writeFileSync(out, await p.screenshot({ fullPage: true }));
      console.log(`lámina → ${out}`);
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
