/**
 * Verificación visual de la banda clara del Cuadro Resumen (pendiente 163).
 *
 * No replica el diseño a mano: LEE las clases del render de exportación
 * directamente de `CuadroResumenAvance.tsx` y arma la tabla con ESAS clases,
 * sobre el CSS REAL de la app compilado por Tailwind. Así lo que se ve acá es
 * lo que resuelven las clases que quedaron en el componente — si `bg-banda` no
 * existiera, o un `border-y` no aplicara, saldría roto en esta captura.
 *
 * Los números son los reales de Casa Los Algarrobos (/tmp/cuadro-algarrobos.json).
 */
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { chromium } from "playwright";

const RAIZ = "/Users/mjblanco/Desktop/blarq-app/.claude/worktrees/mockups-cuadro-resumen-163";
const COMPONENTE = `${RAIZ}/src/components/proyecto/CuadroResumenAvance.tsx`;

const fuente = readFileSync(COMPONENTE, "utf8");

// Sacar del componente las clases de las tres filas de cierre del render de
// EXPORTACIÓN (el bloque `data-export-cuadro`, de la segunda mitad del archivo).
const exportacion = fuente.slice(fuente.indexOf("data-export-cuadro"));
function claseDeFila(rotulo: string): string {
  const i = exportacion.indexOf(`>${rotulo}</td>`);
  if (i < 0) throw new Error(`no encontré la fila ${rotulo}`);
  const antes = exportacion.slice(0, i);
  const tr = antes.lastIndexOf("<tr className=");
  return antes.slice(tr).match(/className="([^"]*)"/)![1];
}
const clsTotalPagos = claseDeFila("Total pagos");
const clsAvance = claseDeFila("Avance a cobrar");
const clsSaldo = claseDeFila("Saldo pendiente");
console.log("Total pagos :", clsTotalPagos);
console.log("Avance      :", clsAvance);
console.log("Saldo       :", clsSaldo);

// ── Datos reales ───────────────────────────────────────────────────────────
type Concepto = { key: string; label: string; acordado: number; pagado: number; avancePct: number; fecha: string };
const dump = JSON.parse(readFileSync("/tmp/cuadro-algarrobos.json", "utf8")) as {
  projectName: string;
  objetivosGuardados: Record<string, number | boolean>;
  data: { conceptos: Concepto[]; totalAcordado: number; totalPagado: number; versionLabel: string };
};
const { conceptos, totalAcordado, totalPagado, versionLabel } = dump.data;
const clp = (n: number) => "$" + new Intl.NumberFormat("es-CL").format(Math.round(n));
const filas = conceptos.map((c) => {
  const obj = ((dump.objetivosGuardados[c.key] as number) ?? 0) / 100;
  const aPedir = Math.max(0, obj * c.acordado - c.pagado);
  return { ...c, pct: (dump.objetivosGuardados[c.key] as number) ?? 0, aPedir,
           saldo: Math.max(0, c.acordado - c.pagado - aPedir) };
});
const totalAPedir = filas.reduce((s, f) => s + f.aPedir, 0);
const totalSaldo = filas.reduce((s, f) => s + f.saldo, 0);

const isotipo = "data:image/png;base64," +
  readFileSync(`${RAIZ}/public/assets/blarq-isotipo-piedra.png`).toString("base64");

const guion = '<span class="text-gray-300">—</span>';

const cuerpo = `
<div class="bg-white p-8 inline-block" style="font-family:'Nunito Sans',sans-serif">
  <div class="flex items-end justify-between mb-5 gap-8">
    <div>
      <p class="text-[11px] uppercase tracking-[0.2em] text-gray-400 mb-1">Cuadro Resumen</p>
      <h1 class="text-2xl font-semibold text-gray-900 leading-tight">${dump.projectName}</h1>
    </div>
    <div class="text-right text-[11px] text-gray-400 leading-snug">
      <img src="${isotipo}" style="width:40px;opacity:.55" class="inline-block mb-2" />
      <p>17-08-2026</p>
    </div>
  </div>
  <table class="text-xs border-collapse tabular-nums" style="min-width:760px">
    <thead>
      <tr class="text-gray-600"><th class="pb-1 pr-2 text-left"></th>
        ${conceptos.map((c) => `<th colspan="3" class="pb-1 px-2 text-center border-l border-gray-200 font-semibold uppercase tracking-wide text-[10px]">${c.label}</th>`).join("")}
        <th class="pb-1 pl-2 text-right border-l border-gray-200 font-semibold uppercase tracking-wide text-[10px]">Total</th></tr>
      <tr class="text-gray-400 border-b border-gray-300 text-[9px] uppercase tracking-wide"><th></th>
        ${conceptos.map(() => `<th class="pb-1 px-2 border-l border-gray-100 text-left font-medium">Fecha</th><th class="pb-1 px-2 text-right font-medium">Monto</th><th class="pb-1 px-2 text-right font-medium whitespace-nowrap">Factura</th>`).join("")}
        <th class="pb-1 pl-2 border-l border-gray-200"></th></tr>
    </thead>
    <tbody>
      <tr class="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
        <td class="py-1.5 pr-2 text-left">${versionLabel}</td>
        ${conceptos.map((c) => `<td class="py-1.5 px-2 border-l border-gray-200 text-left text-gray-500 font-normal whitespace-nowrap">${c.fecha}</td><td class="py-1.5 px-2 text-right whitespace-nowrap">${clp(c.acordado)}</td><td class="py-1.5 px-2"></td>`).join("")}
        <td class="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">${clp(totalAcordado)}</td></tr>
      <tr aria-hidden="true"><td colspan="${2 + conceptos.length * 3}" class="h-5"></td></tr>

      <tr class="${clsTotalPagos}">
        <td class="py-1.5 pr-2 text-left uppercase tracking-wide text-[10px]">Total pagos</td>
        ${conceptos.map((c) => `<td class="py-1.5 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">${(c.avancePct * 100).toFixed(0)}%</td><td colspan="2" class="py-1.5 px-2 text-right whitespace-nowrap">${c.pagado > 0 ? clp(c.pagado) : guion}</td>`).join("")}
        <td class="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">${clp(totalPagado)}</td></tr>

      <tr class="${clsAvance}">
        <td class="py-2 pr-2 pl-1 text-left uppercase tracking-wide text-[10px]">Avance a cobrar</td>
        ${filas.map((f) => `<td class="py-2 px-2 border-l border-gray-300 text-left text-gray-600 font-normal">${f.pct}%</td><td colspan="2" class="py-2 px-2 text-right whitespace-nowrap">${f.aPedir > 0 ? clp(f.aPedir) : '<span class="text-gray-400">—</span>'}</td>`).join("")}
        <td class="py-2 pl-2 pr-1 border-l border-gray-300 text-right whitespace-nowrap font-bold">${clp(totalAPedir)}</td></tr>

      <tr class="${clsSaldo}">
        <td class="py-1.5 pr-2 text-left uppercase tracking-wide text-[10px]">Saldo pendiente</td>
        ${filas.map((f) => `<td colspan="3" class="py-1.5 px-2 border-l border-gray-200 text-right whitespace-nowrap">${f.saldo > 0 ? clp(f.saldo) : guion}</td>`).join("")}
        <td class="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">${clp(totalSaldo)}</td></tr>
    </tbody>
  </table>
</div>`;

async function main() {
  // CSS REAL de la app: se compila globals.css usando como contenido el propio
  // componente + este HTML, así las clases salen exactamente como en la app.
  writeFileSync("/tmp/163-verif-cuerpo.html", cuerpo);
  const css = execFileSync(
    "npx",
    ["@tailwindcss/cli", "-i", "src/app/globals.css", "-o", "/tmp/163-verif.css",
     "--content", `${COMPONENTE},/tmp/163-verif-cuerpo.html`],
    { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  console.log(css.trim().split("\n").pop());

  const hoja = readFileSync("/tmp/163-verif.css", "utf8");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700&family=Hanken+Grotesk:wght@200;300&display=swap" rel="stylesheet">
    <style>${hoja}</style></head><body style="background:#fff">${cuerpo}</body></html>`;
  writeFileSync("/tmp/163-verif.html", html);

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ deviceScaleFactor: 2 });
  await pagina.goto("file:///tmp/163-verif.html", { waitUntil: "networkidle" });
  await pagina.evaluate(() => document.fonts.ready);

  // Chequeo duro: el color que REALMENTE resolvió la fila del avance. Si
  // `bg-banda` no compilara, esto saldría transparente y hay que enterarse.
  const fondo = await pagina.evaluate(() => {
    const tr = Array.from(document.querySelectorAll("tr")).find((r) =>
      r.textContent?.includes("Avance a cobrar")
    )!;
    return getComputedStyle(tr).backgroundColor;
  });
  console.log("Fondo real de la fila AVANCE:", fondo);

  const destino = `${RAIZ}/scripts/_capturas/163-IMPLEMENTADO-algarrobos.png`;
  await (await pagina.$("div.bg-white"))!.screenshot({ path: destino });
  console.log("✓", destino);
  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
