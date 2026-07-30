#!/usr/bin/env python3
"""
Arma la página HTML de revisión del presupuesto V7 de Portofino: el itemizado
completo + los totales de control + qué cambia respecto de la V6 que ya está
cargada. Es la pieza que MJ mira para aprobar (§4.10 — no revisa código,
revisa el resultado).

Lee el JSON FINAL que deja `carga-portofino-v7.ts` en su dry-run, o sea las
mismas filas que se van a escribir en la base: el calefont ya con el precio del
PDF y la partida de descuento incluida. Un solo cálculo, sin copia paralela.

Estética BLARQ (§3): blanco/negro/gris, sin emojis, tabular-nums, 1px de borde.
"""
import json

JSON_FINAL = "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad/portofino-v7-partidas-final.json"
SALIDA = "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad/portofino-v7-revision.html"

# Diferencias contra la V6 cargada (salida de diag-portofino-v6-vs-v7.ts).
CAMBIOS_MO = {
    "REPARACION DE MUROS": 303838,
    "MODIFICACIONES SANITARIAS COCINA": 80556,
    "MODIFICACIONES SANITARIAS BAÑO": 177483,
    "PINTURA DE MURO EXTERIOR|8.10": 477885,
    "ENCHUFE SOBREPUESTO": 0,
}
NUEVAS = {"TOPE DE PUERTA", "INSTALACION CUBREJUNTA"}
V6_TOTAL_CLIENTE = 61919250

d = json.load(open(JSON_FINAL))
caps = {c["numero"]: c["nombre"] for c in d["capitulos"]}
ctrl = d["control"]


def clp(n):
    s = f"{abs(round(n)):,}".replace(",", ".")
    return ("-$" if n < 0 else "$") + s


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


filas = []
cap_visto = None
sub_visto = None
for p in d["filas"]:
    if p["capitulo"] != cap_visto:
        cap_visto = p["capitulo"]
        sub_visto = None
        filas.append(
            f'<tr class="cap"><td colspan="8">{cap_visto} · {esc(caps[str(cap_visto)] if str(cap_visto) in caps else caps[cap_visto])}</td></tr>'
        )
    if p.get("subCapitulo") and p["subCapitulo"] != sub_visto:
        sub_visto = p["subCapitulo"]
        filas.append(f'<tr class="sub"><td colspan="8">{esc(sub_visto)}</td></tr>')

    nota = ""
    clave_alt = f'{p["nombre"]}|{p["item"]}'
    if p["nombre"] in NUEVAS:
        nota = '<span class="tag">nueva</span>'
    elif clave_alt in CAMBIOS_MO or p["nombre"] in CAMBIOS_MO:
        antes = CAMBIOS_MO.get(clave_alt, CAMBIOS_MO.get(p["nombre"]))
        nota = f'<span class="tag">mano de obra antes {clp(antes)}</span>'
    if p["nombre"] == "INSTALACION CALEFONT O CALDERA":
        nota = f'<span class="tag">el Excel decía {clp(ctrl["calefontExcel"])}</span>'

    if p["noCobrado"]:
        marca = '<span class="tag tag-rojo">No cobrar</span>'
    elif p["tipo"] == "descuento":
        marca = '<span class="tag tag-rojo">Descuento</span>'
    else:
        marca = ""

    desc = f'<div class="desc">{esc(p["descripcion"])}</div>' if p.get("descripcion") else ""
    clase = "rojo" if p["noCobrado"] or p["tipo"] == "descuento" else ""
    filas.append(
        f'<tr class="{clase}">'
        f'<td class="it">{esc(p["item"])}</td>'
        f'<td class="nom">{esc(p["nombre"])} {marca} {nota}{desc}</td>'
        f'<td class="n">{esc(p["unidad"])}</td>'
        f'<td class="n num">{p["cantidad"]:g}</td>'
        f'<td class="num">{clp(p["puCosto"])}</td>'
        f'<td class="num fuerte">{clp(p["totalCosto"])}</td>'
        f'<td class="num">{clp(p["puMO"]) if p["puMO"] else "—"}</td>'
        f'<td class="num">{clp(p["totalMO"]) if p["totalMO"] else "—"}</td>'
        f"</tr>"
    )

html = f"""<title>Portofino V7 — obra, para revisar antes de cargar</title>
<style>
  :root {{
    --papel:#FCFCFB; --panel:#FFFFFF; --tinta:#2A2722; --tinta-2:#6B665E;
    --tinta-3:#948E84; --linea:#E4E1DB; --linea-2:#F1EFEB;
    --marca:#8F3A30; --marca-tinte:#F8EFED; --banda:#F4F2ED;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --papel:#171614; --panel:#1E1D1A; --tinta:#EDEAE4; --tinta-2:#A8A29A;
      --tinta-3:#7C766D; --linea:#33312D; --linea-2:#26241F;
      --marca:#D98A7E; --marca-tinte:#2E211E; --banda:#232120;
    }}
  }}
  :root[data-theme="dark"] {{
      --papel:#171614; --panel:#1E1D1A; --tinta:#EDEAE4; --tinta-2:#A8A29A;
      --tinta-3:#7C766D; --linea:#33312D; --linea-2:#26241F;
      --marca:#D98A7E; --marca-tinte:#2E211E; --banda:#232120;
  }}
  :root[data-theme="light"] {{
    --papel:#FCFCFB; --panel:#FFFFFF; --tinta:#2A2722; --tinta-2:#6B665E;
    --tinta-3:#948E84; --linea:#E4E1DB; --linea-2:#F1EFEB;
    --marca:#8F3A30; --marca-tinte:#F8EFED; --banda:#F4F2ED;
  }}
  body {{
    background:var(--papel); color:var(--tinta); margin:0;
    font-family:ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;
    font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
  }}
  .hoja {{ max-width:1080px; margin:0 auto; padding:48px 28px 96px; }}
  .eyebrow {{
    font-size:11.5px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--tinta-3); margin:0 0 10px;
  }}
  h1 {{ font-size:27px; font-weight:600; letter-spacing:-.015em; margin:0 0 6px; text-wrap:balance; }}
  .bajada {{ color:var(--tinta-2); margin:0 0 34px; max-width:64ch; }}
  .cifras {{
    display:grid; grid-template-columns:repeat(auto-fit,minmax(168px,1fr));
    gap:1px; background:var(--linea); border:1px solid var(--linea);
    border-radius:12px; overflow:hidden; margin:0 0 14px;
  }}
  .cifra {{ background:var(--panel); padding:14px 16px; }}
  .cifra dt {{ font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--tinta-3); }}
  .cifra dd {{ margin:4px 0 0; font-size:20px; font-weight:600; font-variant-numeric:tabular-nums; }}
  .cifra dd small {{ display:block; font-size:11.5px; font-weight:400; color:var(--tinta-2); letter-spacing:0; }}
  h2 {{ font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--tinta-3);
       font-weight:600; margin:44px 0 12px; }}
  .marco {{ border:1px solid var(--linea); border-radius:12px; overflow-x:auto; background:var(--panel); }}
  table {{ border-collapse:collapse; width:100%; min-width:880px; font-size:13.5px; }}
  thead th {{
    position:sticky; top:0; background:var(--panel); z-index:2;
    font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--tinta-3);
    font-weight:600; text-align:left; padding:11px 12px; border-bottom:1px solid var(--linea);
  }}
  thead th.num {{ text-align:right; }}
  td {{ padding:9px 12px; border-bottom:1px solid var(--linea-2); vertical-align:top; }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }}
  .fuerte {{ font-weight:600; }}
  .it {{ color:var(--tinta-2); font-variant-numeric:tabular-nums; white-space:nowrap; }}
  .n {{ color:var(--tinta-2); white-space:nowrap; }}
  .nom {{ min-width:300px; }}
  .desc {{ font-size:12px; color:var(--tinta-3); margin-top:2px; max-width:54ch; }}
  tr.cap td {{
    background:var(--banda); font-size:11.5px; letter-spacing:.1em; text-transform:uppercase;
    font-weight:600; color:var(--tinta); padding:10px 12px; border-bottom:1px solid var(--linea);
  }}
  tr.sub td {{ font-size:12px; letter-spacing:.06em; text-transform:uppercase;
              color:var(--tinta-2); padding-left:26px; }}
  tr.rojo td {{ background:var(--marca-tinte); }}
  .tag {{
    display:inline-block; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase;
    padding:1px 7px; border-radius:999px; border:1px solid var(--linea); color:var(--tinta-2);
    vertical-align:1px; white-space:nowrap;
  }}
  .tag-rojo {{ color:var(--marca); border-color:var(--marca); }}
  .cierre {{ margin-top:0; border:1px solid var(--linea); border-radius:12px; background:var(--panel); }}
  .cierre table {{ min-width:0; font-size:14px; }}
  .cierre td {{ border-bottom:1px solid var(--linea-2); }}
  .cierre tr:last-child td {{ border-bottom:0; font-weight:600; font-size:15.5px; }}
  .cierre tr.sangria td:first-child {{ padding-left:28px; color:var(--tinta-2); }}
  .nota {{ font-size:13px; color:var(--tinta-2); max-width:68ch; margin:14px 0 0; }}
  .nota b {{ font-weight:600; color:var(--tinta); }}
</style>

<div class="hoja">
  <p class="eyebrow">Proyecto 60 · Portofino 4208 · obra</p>
  <h1>Presupuesto V7, tal como va a quedar cargado</h1>
  <p class="bajada">Esto es exactamente lo que se escribe en la app. Todavía no se escribió nada.
  El total al cliente cierra en $0 de diferencia contra el PDF de entrega del 17.06.26.</p>

  <dl class="cifras">
    <div class="cifra"><dt>Total al cliente</dt><dd>{clp(ctrl["totalCliente"])}<small>igual que el PDF de entrega</small></dd></div>
    <div class="cifra"><dt>Costo directo</dt><dd>{clp(ctrl["costoDirectoSinDescuento"])}<small>antes del descuento</small></dd></div>
    <div class="cifra"><dt>Mano de obra</dt><dd>{clp(ctrl["moTotal"])}<small>incluye {clp(ctrl["moRojos"])} de no cobradas</small></dd></div>
    <div class="cifra"><dt>Partidas</dt><dd>{ctrl["nCobrables"]} + {ctrl["nRojos"]}<small>cobrables + no cobradas</small></dd></div>
  </dl>

  <h2>Cómo cierra el total al cliente</h2>
  <div class="cierre">
    <table>
      <tr><td>Costo directo</td><td class="num">{clp(ctrl["costoDirectoSinDescuento"])}</td></tr>
      <tr class="sangria"><td>menos la partida de descuento</td><td class="num">{clp(ctrl["descuentoCD"])}</td></tr>
      <tr><td>Costo directo cargado</td><td class="num">{clp(ctrl["costoDirecto"])}</td></tr>
      <tr><td>Gastos generales 20%</td><td class="num">{clp(ctrl["gg"])}</td></tr>
      <tr><td>Utilidad 7%</td><td class="num">{clp(ctrl["utilidad"])}</td></tr>
      <tr><td>Costo neto</td><td class="num">{clp(ctrl["neto"])}</td></tr>
      <tr><td>IVA 19%</td><td class="num">{clp(ctrl["iva"])}</td></tr>
      <tr><td>Total al cliente</td><td class="num">{clp(ctrl["totalCliente"])}</td></tr>
    </table>
  </div>
  <p class="nota">El PDF resta los {clp(ctrl["descuentoCliente"])} al final, después del IVA. La app solo sabe sumar
  desde el costo directo, así que el descuento entra como una partida de {clp(ctrl["descuentoCD"])}: al pasarle
  encima los gastos generales, la utilidad y el IVA vuelve a valer exactamente {clp(ctrl["descuentoCliente"])}.
  <b>El total final es idéntico al del PDF.</b> Su mano de obra y su material quedan en cero a propósito —
  un descuento no es un costo y no tiene que aparecer en el presupuesto por categoría.</p>

  <h2>Las {ctrl["nRojos"]} partidas que no se le cobran a la clienta</h2>
  <p class="nota">Van marcadas <b>No cobrar</b>: se le pagan al maestro y aparecen en su alcance y sus estados de pago,
  pero quedan fuera del total de la clienta y fuera del PDF que ella firma. Suman {clp(ctrl["moRojos"])} que BLARQ absorbe.</p>

  <h2>Itemizado completo</h2>
  <div class="marco">
    <table>
      <thead><tr>
        <th>Item</th><th>Partida</th><th>Un.</th><th class="num">Cant.</th>
        <th class="num">P.U. costo</th><th class="num">Costo total</th>
        <th class="num">P.U. mano obra</th><th class="num">Mano obra</th>
      </tr></thead>
      <tbody>
        {"".join(filas)}
      </tbody>
    </table>
  </div>

  <h2>Qué cambia respecto de la V6 que ya está cargada</h2>
  <div class="cierre">
    <table>
      <tr><td>Dos partidas nuevas: tope de puerta y cubrejunta</td><td class="num">+ {clp(204517)}</td></tr>
      <tr><td>Calefont corregido al precio del PDF</td><td class="num">− {clp(125000)}</td></tr>
      <tr><td>Descuento acordado, ahora sí en el presupuesto</td><td class="num">− {clp(ctrl["descuentoCliente"])} al final</td></tr>
      <tr><td>13 partidas no cobradas, que no tocan el total</td><td class="num">+ {clp(ctrl["moRojos"])} de mano de obra</td></tr>
      <tr><td>Cinco partidas con la mano de obra corregida</td><td class="num">+ {clp(70237)} de mano de obra</td></tr>
      <tr><td>Total al cliente: V6 {clp(V6_TOTAL_CLIENTE)} → V7</td><td class="num">{clp(ctrl["totalCliente"])}</td></tr>
    </table>
  </div>
  <p class="nota">Ninguna partida de la V6 desaparece. La V6 queda intacta y consultable; la V7 pasa a ser
  la versión que manda en el Resumen, la utilidad y las alertas del proyecto.</p>
</div>
"""

open(SALIDA, "w").write(html)
print("HTML ->", SALIDA, len(html), "bytes")
