// Traspasa la metadata de Maxxa 2025 a la app: proyecto + categoría (recibidas)
// y proyecto + conceptoCobro (emitidas). Crea proyectos y categorías que no
// existan (con el nombre de Maxxa). Solo toca facturas con el campo VACÍO
// (respeta lo asignado a mano). Match por (tipoDoc, folio, rut). Dry-run default.
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const normRut=(s:string)=>String(s||"").replace(/[.\s]/g,"").replace(/^0+/,"").toUpperCase();
const normFolio=(s:string)=>String(s??"").replace(/[^0-9]/g,"").replace(/^0+/,"");
const nc=(s:string)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
const DIR="/Users/mjblanco/Downloads/2025_Maxxa";

function loadMaxxa(p:string,type:"recibida"|"emitida"){const $=cheerio.load(readFileSync(p,"utf-8"));const rows=$("table tr");const H=rows.first().find("td").map((_,td)=>$(td).text().trim()).get();const gi=(n:string)=>H.indexOf(n);const out:any[]=[];rows.slice(1).each((_,tr)=>{const t=$(tr).find("td").map((_,td)=>$(td).text().trim()).get();if(t.length<10)return;out.push({type,tipoDoc:Number(t[gi("CodTipoDoc")]),folio:normFolio(t[gi("FolioDoc")]),rut:normRut(t[gi("RutDoc")]),cc:t[gi("CentroCosto")],cat:t[gi("DescCatego")],sub:t[gi("DescSubCatego")]});});return out;}

// sinónimos Maxxa(normalizado) → nombre exacto de categoría app
const SYN:Record<string,string>={ materiales:"Materiales", manodeobra:"Mano de obra", herramientas:"Herramientas", subcontrato:"Subcontrato", perdidas:"Pérdidas", muebles:"Muebles", artefactos:"Artefactos", gastosgenerales:"Gastos generales", gastosfinancieros:"Gastos financieros",
 autosautopistas:"Auto / Autopistas", autoscombustible:"Auto / Combustible", autosseguro:"Auto / Seguro",
 ventanas:"Subcontrato / Ventanas", puertas:"Subcontrato / Puertas", retiroescombrosflete:"Subcontrato / Flete / Retiro escombros",
 herrajes:"Muebles / Herrajes", cubiertas:"Muebles / Cubiertas",
 cocina:"Artefactos / Cocina", sanitarios:"Artefactos / Baño", bano:"Artefactos / Baño", iluminacion:"Artefactos / Iluminación" };
// conceptoCobro para emitidas (sub de INGRESOS POR VENTAS)
const CONCEPTO:Record<string,string>={ obra:"obra", muebles:"muebles", artefactos:"artefactos", cocina:"artefactos", sanitarios:"artefactos", iluminacion:"artefactos" };

async function main(){
  console.log("Modo:",APPLY?"APPLY":"DRY-RUN");
  const projects=await prisma.project.findMany();
  const cats=await prisma.costCategory.findMany();
  const projByNum=new Map(projects.filter(p=>p.numeroProyecto!=null).map(p=>[String(p.numeroProyecto),p]));
  const catByNorm=new Map<string,any>(); for(const c of cats){const parent=c.parentId?cats.find(x=>x.id===c.parentId):null; const full=(parent?parent.name+" / ":"")+c.name; catByNorm.set(nc(full),c); catByNorm.set(nc(c.name),c);}
  const blarq=projects.find(p=>p.isInternal);

  const rec=loadMaxxa(DIR+"/exportar (2).xls","recibida");
  const emi=loadMaxxa(DIR+"/exportar (3).xls","emitida");
  const all=[...rec,...emi];

  // ── resolver PROYECTO (crear faltantes) ──
  const projToCreate=new Map<string,{num:number,name:string,client:string}>();
  function resolveProject(cc:string):{kind:"id"|"null"|"blarq"|"create",val?:any}{
    if(cc==="SIN CENTRO DE COSTO"||!cc) return {kind:"null"};
    if(/^00_/.test(cc)) return {kind:"blarq"};
    const num=cc.match(/^(\d+)_/)?.[1]; if(!num) return {kind:"null"};
    if(projByNum.has(num)) return {kind:"id",val:projByNum.get(num).id};
    // crear
    const rest=cc.replace(/^\d+_/,""); const name=rest.replace(/\s*\(.*\)/,"").trim(); const client=(rest.match(/\(([^)]+)\)/)?.[1]||name).trim();
    projToCreate.set(num,{num:Number(num),name,client});
    return {kind:"create",val:num};
  }
  // ── resolver CATEGORÍA (crear faltantes) ──
  const catToCreate=new Map<string,{name:string,parent:string|null}>();
  const doubts:string[]=[];
  function resolveCategory(cat:string,sub:string):{kind:"id"|"null"|"create",val?:any}{
    const cands=[]; if(sub&&!["null","undefined",""].includes(String(sub).toLowerCase().trim())) cands.push(sub); cands.push(cat);
    for(const c of cands){ const k=nc(c); if(SYN[k]&&catByNorm.has(nc(SYN[k]))) return {kind:"id",val:catByNorm.get(nc(SYN[k])).id}; if(catByNorm.has(k)) return {kind:"id",val:catByNorm.get(k).id}; }
    // PROVEEDORES sin sub / ingresos / traspasos → null (no es categoría de costo real)
    if(/proveedor|ingresos por ventas|traspaso/i.test(cat)) return {kind:"null"};
    // crear: leaf = sub||cat, bajo parent si el cat mapea a una top-level
    const leaf=(cands[0]||cat).trim(); const key=nc(leaf);
    if(!catToCreate.has(key)) catToCreate.set(key,{name:leaf.charAt(0)+leaf.slice(1).toLowerCase(),parent:null});
    return {kind:"create",val:key};
  }

  // ── planificar ──
  let updProj=0,updCat=0,updConcepto=0,noMatch=0;
  const plan:any[]=[];
  // index facturas app
  const inv=await prisma.invoice.findMany({where:{issueDate:{gte:new Date("2024-12-01"),lte:new Date("2025-12-31T23:59:59")}},select:{id:true,type:true,tipoDoc:true,folioNumber:true,rutIssuer:true,projectId:true,categoryId:true,conceptoCobro:true}});
  const idxRec=new Map(inv.filter(i=>i.type==="recibida").map(i=>[i.tipoDoc+"|"+normFolio(i.folioNumber)+"|"+normRut(i.rutIssuer),i]));
  const idxEmi=new Map(inv.filter(i=>i.type==="emitida").map(i=>[i.tipoDoc+"|"+normFolio(i.folioNumber),i]));
  for(const m of all){
    const a = m.type==="recibida" ? idxRec.get(m.tipoDoc+"|"+m.folio+"|"+m.rut) : idxEmi.get(m.tipoDoc+"|"+m.folio);
    if(!a){noMatch++;continue;}
    const pr=resolveProject(m.cc);
    const upd:any={};
    if(!a.projectId){ if(pr.kind==="id")upd.projectId=pr.val; else if(pr.kind==="blarq"&&blarq)upd.projectId=blarq.id; else if(pr.kind==="create")upd._projNum=pr.val; }
    if(m.type==="recibida"){ if(!a.categoryId){ const cr=resolveCategory(m.cat,m.sub); if(cr.kind==="id")upd.categoryId=cr.val; else if(cr.kind==="create")upd._catKey=cr.val; } }
    else { if(!a.conceptoCobro){ const subk=nc(m.sub); if(CONCEPTO[subk])upd.conceptoCobro=CONCEPTO[subk]; } }
    if(Object.keys(upd).length){ plan.push({id:a.id,upd}); if(upd.projectId||upd._projNum)updProj++; if(upd.categoryId||upd._catKey)updCat++; if(upd.conceptoCobro)updConcepto++; }
  }

  console.log("\n=== PROYECTOS a crear:",projToCreate.size,"===");
  [...projToCreate.values()].sort((a,b)=>a.num-b.num).forEach(p=>console.log("  n°"+p.num+" "+p.name+" (cliente: "+p.client+")"));
  console.log("\n=== CATEGORÍAS a crear:",catToCreate.size,"===");
  [...catToCreate.values()].forEach(c=>console.log("  "+c.name));
  console.log("\n=== Facturas a actualizar ===");
  console.log("  con proyecto:",updProj,"| con categoría:",updCat,"| con conceptoCobro:",updConcepto,"| Maxxa sin match en app:",noMatch);

  if(!APPLY){ console.log("\n(DRY-RUN — nada escrito)"); await prisma.$disconnect(); return; }

  console.log("\nAPLICANDO...");
  // crear proyectos
  const newProjIds=new Map<string,string>();
  for(const p of projToCreate.values()){ const created=await prisma.project.create({data:{name:p.name,clientName:p.client,status:"terminado",numeroProyecto:p.num,isInternal:false}}); newProjIds.set(String(p.num),created.id); }
  // crear categorías
  const newCatIds=new Map<string,string>();
  for(const [key,c] of catToCreate){ const created=await prisma.costCategory.create({data:{name:c.name,type:"directo",appliesTo:"recibida"}}); newCatIds.set(key,created.id); }
  // updates
  let done=0;
  for(const p of plan){ const d:any={...p.upd}; if(d._projNum){d.projectId=newProjIds.get(String(d._projNum));delete d._projNum;} if(d._catKey){d.categoryId=newCatIds.get(d._catKey);delete d._catKey;} if(Object.keys(d).length){ await prisma.invoice.update({where:{id:p.id},data:d}); done++; } }
  console.log("Listo: "+projToCreate.size+" proyectos, "+catToCreate.size+" categorías, "+done+" facturas actualizadas.");
  await prisma.$disconnect();
}
main().catch(async(e)=>{console.error("FATAL:",e);await prisma.$disconnect();process.exit(1);});
