// Ancla la paleta al color del isotipo BLARQ (#6F6960, hue cálido ~36°).
// Recolorea cada GRIS greige a ese matiz manteniendo su luminosidad; el beige se
// apaga en los tonos muy claros (así los fondos grandes de la app quedan neutros
// y no caen en crema). NO toca semánticos (rojos, verde, ámbar, dorado descuento).
// Lista de grises EXPLÍCITA por archivo → cero riesgo de pisar un color con significado.
import fs from "node:fs";

const H = 36 / 360;
// curva de saturación: cálido en medios/oscuros, casi neutro en los muy claros
function satForL(L) {
  if (L <= 0.75) return 0.11;
  if (L >= 0.97) return 0.02;
  return 0.11 + (0.02 - 0.11) * ((L - 0.75) / (0.97 - 0.75));
}
function hexToRgb(h){h=h.replace("#","");return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);}
function rgbToHex(r){return "#"+r.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join("").toUpperCase();}
function rgbToHsl([r,g,b]){const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;if(mx===mn){h=s=0;}else{const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6;}return [h,s,l];}
function hslToRgb([h,s,l]){if(s===0)return [l,l,l];const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;const t=(t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};return [t(h+1/3),t(h),t(h-1/3)];}
function recolor(hex){
  const [, , L] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([H, satForL(L), L]));
}

// grises EXPLÍCITOS por archivo (semánticos NO se listan → quedan intactos)
const FILES = {
  "src/lib/pdf/ObraPDF.html.ts": ["#333332","#94928E","#5C5B59","#DEDCD9","#6C6A67","#EAE8E5","#A9A6A2","#EDEDEC","#C2C0BC","#6C6B6B","#7A7468","#494847"],
  "src/lib/pdf/MueblesPDF.html.ts": ["#9A9183","#34332E","#5F5B52","#E7E1D7","#E2DCD0","#B0A596","#6F6A60","#F1ECE3","#EEE8DD","#EDEDEB","#C7BFB2","#AAA294"],
  "src/lib/pdf/ArtefactosPDF.html.ts": ["#34332E","#9A9183","#6F6A60","#E2DCD0","#F7F4EF","#EEE8DD","#EDEDEB","#B0A596","#E7E1D7","#C7BFB2","#5F5B52"],
  "scripts/build-manual-marca.mjs": ["#94928E","#E3E1DF","#6C6B6B","#333332","#535352","#BEBAB8","#F5F4F3","#EDEDEC","#ECEBEB","#A6A4A1"],
  "src/app/globals.css": ["#F5F4F3","#EDEDEC","#E3E1DF","#BEBAB8","#94928E","#6C6B6B","#535352","#333332","#F6F5F4","#EEEDEC","#EDEDEB","#E3E1DE","#CDCBC7","#A19F9B","#7F7D7A","#5D5B59","#454442","#343332","#34332F","#272625","#1A1918"],
};

for (const [file, greys] of Object.entries(FILES)) {
  let txt = fs.readFileSync(file, "utf8");
  let n = 0;
  const seen = new Set();
  for (const g of greys) {
    const nv = recolor(g);
    for (const form of [g, g.toLowerCase()]) {
      const before = txt;
      txt = txt.split(form).join(nv);
      if (before !== txt) n++;
    }
    if (!seen.has(g)) { console.log(`  ${g} -> ${nv}`); seen.add(g); }
  }
  fs.writeFileSync(file, txt);
  console.log(`${file}: ${greys.length} grises anclados`);
}
console.log("Listo.");
