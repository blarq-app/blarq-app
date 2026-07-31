/**
 * Captura anotada de la página del WC Atenas en mk.cl para el informe de
 * auditoría. Marca el precio de venta y el % de descuento (lo que la app NO
 * está leyendo en "Comparar con la tienda web").
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const OUT = "docs/auditoria-artefactos-precios-2026-07-assets";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("https://www.mk.cl/wcs300257-wc-atenas-pison-rimless-sanitarios/p", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  // Anotar: recuadro rojo sobre venta+dcto, azul sobre la lista tachada.
  // OJO gotcha tsx+Playwright: un callback de page.evaluate transpilado por
  // tsx inyecta el helper __name, que no existe dentro de la página → se pasa
  // el código como STRING para esquivar la transpilación.
  await page.evaluate(`(() => {
    const mark = (el, color, label) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;left:" + (r.left - 8) + "px;top:" + (r.top - 8) + "px;width:" + (r.width + 16) + "px;height:" + (r.height + 16) + "px;border:3px solid " + color + ";border-radius:6px;z-index:99999;pointer-events:none;";
      document.body.appendChild(box);
      if (!label) return;
      const tag = document.createElement("div");
      tag.textContent = label;
      const tagLeft = Math.min(r.left - 8, window.innerWidth - 380);
      tag.style.cssText = "position:fixed;left:" + tagLeft + "px;top:" + (r.bottom + 12) + "px;background:" + color + ";color:#fff;font:600 13px/1.4 sans-serif;padding:3px 8px;border-radius:4px;z-index:99999;pointer-events:none;max-width:340px;";
      document.body.appendChild(tag);
    };
    // El elemento MAS CHICO (por area) que contiene el texto, para no
    // recuadrar contenedores de ancho completo.
    const smallest = (re) => {
      let best = null, bestArea = Infinity;
      for (const e of document.querySelectorAll("span,div,p,h1,h2,h3,del,s,strike")) {
        const t = (e.textContent || "").trim();
        if (!re.test(t) || t.length > 30) continue;
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 8 || r.width > 300) continue;
        const area = r.width * r.height;
        if (area < bestArea) { bestArea = area; best = e; }
      }
      return best;
    };
    const venta = smallest(/\\$\\s?139\\.990/);
    const dcto = smallest(/39%\\s*DCTO/i);
    const lista = smallest(/229\\.840/);
    mark(venta, "#b91c1c", "");
    mark(dcto, "#b91c1c", "La app NO lee esto: venta con descuento");
    if (lista) {
      mark(lista, "#1d4ed8", '"Comparar con la tienda web" SOLO lee esto: la lista (no cambio)');
    } else if (venta) {
      // Fallback: la lista tachada esta justo debajo del precio de venta.
      const r = venta.getBoundingClientRect();
      const fake = { getBoundingClientRect: () => ({ left: r.left, top: r.bottom + 8, bottom: r.bottom + 30, width: r.width + 30, height: 22 }) };
      mark(fake, "#1d4ed8", '"Comparar con la tienda web" SOLO lee esto: la lista (no cambio)');
    }
  })()`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/mk-wc-atenas-2026-07-31.png` });
  await browser.close();
  console.log("Captura en", `${OUT}/mk-wc-atenas-2026-07-31.png`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
