/**
 * PDF "Listado de herrajes para el mueblista" (Fase 3 herrajes, 2026-06-22).
 *
 * Es la SEGUNDA salida de la cotización de muebles: el mismo set de herrajes
 * pero SIN PRECIOS, agrupado por SECTOR, para pasarle al mueblista y que sepa
 * dónde va cada herraje y cuántos (y, si BLARQ los compró, dónde se los
 * consideró). Solo nombre + medida/color + proveedor + cantidad.
 *
 * Self-contained a propósito (no toca el PDF de muebles al cliente).
 */
import fs from "fs";
import path from "path";
import { formatHerrajeName } from "@/lib/presupuesto/herrajeNombre";

export interface MueblistaHerrajeInput {
  sector: string;
  name: string;
  measure: string | null;
  finish: string | null;
  supplier: string;
  quantity: number;
}

export interface MueblistaChapterInput {
  name: string;
  herrajes: MueblistaHerrajeInput[];
}

export interface MueblistaHTMLInput {
  project: { name: string; clientName: string; address?: string | null };
  budget: { version: string; date: string | Date };
  chapters: MueblistaChapterInput[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function getLogoDataUri(): string {
  try {
    const bytes = fs.readFileSync(
      path.join(process.cwd(), "public", "assets", "logo-blarq.png"),
    );
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Montserrat', sans-serif; color: #1A1A1A; font-size: 9pt; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5pt solid #1A1A1A; padding-bottom: 8pt; margin-bottom: 12pt; }
  .logo { display: block; height: 42px; width: auto; }
  .title { font-size: 14pt; font-weight: 600; letter-spacing: 0.04em; }
  .subtitle { font-size: 8pt; color: #666; margin-top: 2pt; }
  .meta { text-align: right; font-size: 8pt; color: #444; }
  .meta strong { color: #1A1A1A; }
  .note { font-size: 8pt; color: #555; background: #F5F5F5; padding: 6pt 8pt; border-radius: 4pt; margin-bottom: 12pt; }
  .chapter { font-size: 10pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 14pt 0 4pt; padding-bottom: 2pt; border-bottom: 1pt solid #CCC; }
  .sector { font-size: 8.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #555; background: #F5F5F5; padding: 3pt 6pt; margin-top: 8pt; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #888; text-align: left; padding: 4pt 6pt; border-bottom: 1pt solid #DDD; font-weight: 600; }
  tbody td { padding: 3.5pt 6pt; border-bottom: 0.5pt solid #EEE; vertical-align: top; }
  .c-spec { color: #666; text-transform: uppercase; font-size: 8pt; }
  .c-prov { color: #888; text-transform: uppercase; font-size: 7.5pt; }
  .c-qty { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { font-size: 9pt; color: #888; font-style: italic; padding: 12pt 0; }
`;

function renderSector(sector: string, lines: MueblistaHerrajeInput[]): string {
  const rows = lines
    .map((h) => {
      const spec = [h.measure, h.finish].filter(Boolean).join(" · ");
      // El nombre va homologado en estilo oración (pendiente 139) con el mismo
      // helper que usa el editor, para que PDF y pantalla no puedan divergir.
      return `
      <tr>
        <td>${esc(formatHerrajeName(h.name))}</td>
        <td class="c-spec">${esc(spec) || "—"}</td>
        <td class="c-prov">${esc(h.supplier)}</td>
        <td class="c-qty">${fmtQty(h.quantity)}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="sector">${esc(sector ? sector.toUpperCase() : "Sin sector")}</div>
    <table>
      <thead>
        <tr><th style="width:48%">Herraje</th><th style="width:28%">Medida / color</th><th style="width:14%">Prov.</th><th style="width:10%;text-align:right">Cant.</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderMueblistaHTML(input: MueblistaHTMLInput): string {
  const { project, budget, chapters } = input;
  const logoUri = getLogoDataUri();
  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="title">BLARQ</div>`;

  // Solo capítulos con herrajes; dentro, agrupar por sector preservando orden.
  const body = chapters
    .filter((ch) => ch.herrajes.length > 0)
    .map((ch) => {
      const order: string[] = [];
      const bySector = new Map<string, MueblistaHerrajeInput[]>();
      for (const h of ch.herrajes) {
        const key = h.sector || "";
        if (!bySector.has(key)) {
          bySector.set(key, []);
          order.push(key);
        }
        bySector.get(key)!.push(h);
      }
      const sectors = order
        .map((s) => renderSector(s, bySector.get(s)!))
        .join("");
      return `<div class="chapter">${esc(ch.name)}</div>${sectors}`;
    })
    .join("");

  const hasHerrajes = body.length > 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Herrajes mueblista — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  <div class="header">
    <div>
      ${logoHtml}
      <div class="title">Listado de herrajes — mueblista</div>
      <div class="subtitle">${esc(project.name)}${project.clientName ? ` · ${esc(project.clientName)}` : ""}</div>
    </div>
    <div class="meta">
      <div>Versión: <strong>${esc(budget.version)}</strong></div>
      <div>Fecha: <strong>${fmtDate(budget.date)}</strong></div>
      ${project.address ? `<div>${esc(project.address)}</div>` : ""}
    </div>
  </div>

  <div class="note">Listado sin precios. Indica en qué sector va cada herraje y cuántos. Si BLARQ compró los herrajes, este listado señala dónde se consideraron.</div>

  ${hasHerrajes ? body : `<div class="empty">Esta cotización no tiene herrajes cargados.</div>`}
</body>
</html>`;
}
