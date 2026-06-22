import urllib.request, urllib.parse, re, json, html as ihtml
UA={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'}
def get(url): return urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=30).read().decode('utf-8','ignore')
def parse_items(html):
    out=[]
    for block in re.split(r'product-item-info', html)[1:]:
        m=re.search(r'class="product-item-link"\s+href="([^"]+)"[^>]*>\s*([^<]+)', block)
        if not m: continue
        img=re.search(r'(https://www\.hbt\.cl/media/catalog/product/[^"\' ]+\.(?:jpg|jpeg|png|webp))', block, re.I)
        out.append(dict(name=ihtml.unescape(m.group(2)).strip(), link=m.group(1), img=img.group(1) if img else None))
    return out
def norm(s): return re.sub(r'[^a-z0-9 ]','',s.lower())

PRODS=[
 dict(name="CAJÓN MERIVOBOX E 500MM CON GUARDACUERPO", measure="500mm", finish="Blanco Seda", cost=64000, category="cajon", subgroup="Merivobox", sku="CAMERCAJCOCACA02PBLU", q="merivobox e 500 guardacuerpo", must=["merivobox","e","guardacuerpo"], notmust=["orion","gris","boxcap"], color="blanco"),
 dict(name="CAJÓN MERIVOBOX M 500MM 40KG (KIT)", measure="500mm", finish="Blanco Seda", cost=59000, category="cajon", subgroup="Merivobox", sku="CAMERCAJCOCACA8JGBLU", q="merivobox m 500", must=["merivobox","m","500"], notmust=["orion","gris"], color="blanco"),
 dict(name="DESPENSA SPACETOWER MERIVOBOX 500MM", measure="500mm", finish="Blanco Seda", cost=490000, category="despensa", subgroup="Spacetower", sku="CODESDESCOCOCOWCLBLU", q="despensa spacetower merivobox 500", must=["despensa","spacetower","500"], notmust=["orion","gris"], color="blanco"),
 dict(name="GUÍA OCULTA MOVENTO BLUMOTION 500MM 40KG C/ACOPLE", measure="500mm", finish=None, cost=36000, category="corredera", subgroup="Oculta extensión total", sku="CATANCAJCOMOCAQ7HBLU", q="movento blumotion", must=["movento","500","acoples"], notmust=["kit","piso"], color=None),
 dict(name="PAR BISAGRAS CLIPTOP 155° BLUMOTION 0 ENTRADA", measure=None, finish=None, cost=17000, category="bisagra", subgroup="Cliptop", sku="BIBISBISCOBIBI75WBLU", q="cliptop 155 blumotion", must=["cliptop","155"], notmust=[], color=None),
 dict(name="BISAGRA CLIPTOP 110° BLUMOTION RECTA (X10)", measure=None, finish=None, cost=40000, category="bisagra", subgroup="Cliptop", sku="BICLIPABI110010REBLU", q="cliptop 110 blumotion recta", must=["cliptop","110","recta"], notmust=[], color=None),
 dict(name="PLANCHETA CLIPTOP EN CRUZ 5MM (X10)", measure=None, finish=None, cost=5000, category="accesorio", subgroup="Repuestos", sku="BICLIPAPL001000TABLU", q="plancheta cliptop cruz", must=["plancheta","cruz"], notmust=[], color=None),
 dict(name="BASURERO 2X33L PARA FRENTE 450MM", measure="450mm", finish="Antracita", cost=126042, category="accesorio", subgroup="Basureros", sku="COBASBASORMAORVBDMET", q=None, must=[], notmust=[], color=None),  # ya no está en hbt.cl → sin foto
 dict(name="ROTONDA MEDIA LUNA PUERTA 450MM BASE", measure="450mm", finish="Antracita", cost=92850, category="accesorio", subgroup="Organizadores", sku="COSOLROTORS-86BMVSTX", q="media luna", must=["rotonda","luna"], notmust=[], color="antracita"),
 dict(name="RIEL DE 6 GANCHOS LIBELL", measure=None, finish="Antracita", cost=7850, category="accesorio", subgroup="Organizadores", sku="LOASERIEOR6076WBNPEK", q="libell", must=["riel","ganchos","libell"], notmust=[], color="antracita"),
 dict(name="PORTA ESCOBAS LIBELL", measure=None, finish="Antracita", cost=18564, category="accesorio", subgroup="Organizadores", sku="LOASECOLOR6076K6VPEK", q="libell", must=["porta","escoba","libell"], notmust=[], color="antracita"),
 dict(name="PIEZA DELANTERA MERIVOBOX 1200MM (PACK)", measure="1200mm", finish="Blanco Seda", cost=21000, category="accesorio", subgroup="Repuestos", sku="CAMERPIECOCACAW73BLU", q="pieza delantera merivobox 1200", must=["pieza","delantera","merivobox"], notmust=[], color="blanco"),
 dict(name="FIJACIÓN FRONTAL M INT. MERIVOBOX (PAR)", measure=None, finish="Blanco Seda", cost=15000, category="accesorio", subgroup="Repuestos", sku="CAMERFIJCO339071VBLU", q="fijacion frontal merivobox", must=["fijacion","frontal","merivobox"], notmust=["orion","gris"], color="blanco"),
]
out=[]
for p in PRODS:
    best=None
    if p['q']:
        try:
            items=parse_items(get('https://www.hbt.cl/catalogsearch/result/?q='+urllib.parse.quote(p['q'])))
            for it in items:
                n=norm(it['name'])
                if all(norm(k) in n for k in p['must']) and not any(norm(k) in n for k in p['notmust']):
                    if p['color'] and p['color'] not in n: continue
                    best=it; break
        except Exception as e:
            print("ERR", p['name'][:30], repr(e)[:50])
    p['_match']=best
    out.append(p)
    tag='[foto]' if best and best['img'] else ('[sin foto]' if not best else '[match sin img]')
    print(f"{'OK ' if best else '-- '} {p['name'][:42]:42} -> {best['name'][:46] if best else '(sin match en hbt.cl)'} {tag}")
json.dump(out, open('scripts/herrajes-hbt-borrador.json','w'), ensure_ascii=False, indent=1)
print("\nmatcheados:", sum(1 for p in out if p['_match']), "/", len(out), "| con foto:", sum(1 for p in out if p['_match'] and p['_match']['img']))
