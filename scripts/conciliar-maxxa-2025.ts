// Concilia facturas 2025 (pendiente/parcial) contra los movimientos del banco
// usando la conciliación de Maxxa (cartolas .xlsx, columna Asignacion).
// Movimiento app se matchea por (fecha, |monto|, glosa). Solo facturas
// pendiente/parcial (no degrada pagadas). Capacity-guarded. Dry-run default.
import "dotenv/config";
import { readFileSync } from "fs";
import XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY=process.argv.includes("--apply");
const DIR="/Users/mjblanco/Downloads/2025_Maxxa";
const normRut=(s:string)=>String(s||"").replace(/[.\s]/g,"").replace(/^0+/,"").toUpperCase();
const normFolio=(s:string)=>String(s??"").replace(/[^0-9]/g,"").replace(/^0+/,"");
const num=(s:any)=>{const n=Number(String(s??"").replace(/[^\d.-]/g,""));return isNaN(n)?0:Math.round(n);};
const ymd=(d:any)=>d instanceof Date?d.toISOString().slice(0,10):String(d??"").slice(0,10);
const gl=(s:string)=>String(s||"").toLowerCase().replace(/\s+/g," ").trim();
const fmt=(n:number)=>Math.round(n).toLocaleString("es-CL");

function loadCart(f:string){const wb=XLSX.read(readFileSync(DIR+"/"+f));const rows:any[]=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false});const H=rows[0];const ci=(n:string)=>H.indexOf(n);return rows.slice(1).filter(r=>r.length>3).map(r=>{let asign:any[]=[];const raw=r[ci("Asignacion")];if(raw&&raw!==""){try{const j=JSON.parse(String(raw).split("];")[0]+"]");asign=j.map((a:any)=>({folio:normFolio(a.Folio),rut:normRut(a.Rut),tipoDoc:Number(a.TipoDoc),abono:num(a.Abono),tipoMov:a.TipoMov}));}catch{}}return{desc:r[ci("descripcion")],monto:num(r[ci("monto")]),fecha:ymd(r[ci("fecha_transaccion")]),asign};});}

async function main(){
  console.log("Modo:",APPLY?"APPLY":"DRY-RUN");
  // Los 4 exports de Maxxa cubren todo 2025: 1721/1722 = ene-mar (faltaban),
  // 2356 = mar-jul, 2355 = jul-dic. Se deduplican abajo por fecha|monto|desc.
  const cartola=[
    ...loadCart("MovimientosCartola_20260601_1721.xlsx"),
    ...loadCart("MovimientosCartola_20260601_1722.xlsx"),
    ...loadCart("MovimientosCartola_20260530_2356.xlsx"),
    ...loadCart("MovimientosCartola_20260530_2355.xlsx"),
  ];
  // dedupe por fecha|monto|desc
  const seen=new Set<string>(); const cart=cartola.filter(m=>{const k=m.fecha+"|"+m.monto+"|"+(m.desc||"");if(seen.has(k))return false;seen.add(k);return true;});
  console.log("Movimientos cartola Maxxa 2025:",cart.length);

  const inv=await prisma.invoice.findMany({where:{issueDate:{gte:new Date("2024-12-01"),lte:new Date("2025-12-31T23:59:59")}},select:{id:true,type:true,tipoDoc:true,folioNumber:true,rutIssuer:true,totalAmount:true,status:true}});
  const idxRec=new Map(inv.filter(i=>i.type==="recibida").map(i=>[i.tipoDoc+"|"+normFolio(i.folioNumber)+"|"+normRut(i.rutIssuer),i]));
  const idxEmi=new Map(inv.filter(i=>i.type==="emitida").map(i=>[i.tipoDoc+"|"+normFolio(i.folioNumber),i]));
  const movs=await prisma.bankMovement.findMany({where:{date:{gte:new Date("2025-01-01"),lte:new Date("2025-12-31T23:59:59")}},select:{id:true,date:true,amount:true,description:true,status:true}});
  const movIdx=new Map<string,any[]>(); for(const m of movs){const k=ymd(m.date)+"|"+Math.abs(Math.round(m.amount));if(!movIdx.has(k))movIdx.set(k,[]);movIdx.get(k)!.push(m);}
  const pays=await prisma.invoicePayment.findMany({select:{bankMovementId:true,invoiceId:true,amountApplied:true}});
  const appliedByMov=new Map<string,number>(); const appliedByInv=new Map<string,number>();
  for(const p of pays){appliedByMov.set(p.bankMovementId,(appliedByMov.get(p.bankMovementId)||0)+p.amountApplied);appliedByInv.set(p.invoiceId,(appliedByInv.get(p.invoiceId)||0)+p.amountApplied);}
  const matchMov=(cm:any)=>{const c=movIdx.get(cm.fecha+"|"+Math.abs(cm.monto))||[];if(c.length<=1)return c[0]||null;const g=gl(cm.desc).slice(0,14);return c.find((x:any)=>gl(x.description).slice(0,14)===g)||c[0];};

  const planMov=new Map<string,number>(),planInv=new Map<string,number>();
  const writes:any[]=[]; let noMov=0,noFact=0,yaConc=0,badSign=0;
  for(const cm of cart){ if(!cm.asign.length)continue;
    const mov=matchMov(cm); if(!mov){noMov++;continue;}
    const movCap=()=>Math.abs(mov.amount)-(appliedByMov.get(mov.id)||0)-(planMov.get(mov.id)||0);
    for(const a of cm.asign){
      const f = a.tipoDoc===33||a.tipoDoc===34||a.tipoDoc===61||a.tipoDoc===39 ? (idxEmi.get(a.tipoDoc+"|"+a.folio) || idxRec.get(a.tipoDoc+"|"+a.folio+"|"+a.rut)) : idxRec.get(a.tipoDoc+"|"+a.folio+"|"+a.rut);
      if(!f){noFact++;continue;}
      // Coherencia de signo: una emitida (cobro) solo se concilia con ABONO
      // (+), una recibida (gasto) solo con CARGO (-). Evita matches por
      // colisión de folio (ej: una compra -$ pegada a la emitida F-92).
      if(!((f.type==="emitida"&&mov.amount>0)||(f.type==="recibida"&&mov.amount<0))){badSign++;continue;}
      if(f.status==="pagada"){yaConc++;continue;}
      const invRem=f.totalAmount-(appliedByInv.get(f.id)||0)-(planInv.get(f.id)||0);
      if(invRem<1){yaConc++;continue;}
      const apply=Math.min(a.abono||invRem,invRem,movCap());
      if(apply<1)continue;
      planMov.set(mov.id,(planMov.get(mov.id)||0)+apply); planInv.set(f.id,(planInv.get(f.id)||0)+apply);
      writes.push({movId:mov.id,invId:f.id,amount:Math.round(apply)});
    }
  }
  console.log("\nImputaciones a crear:",writes.length,"| Σ $"+fmt(writes.reduce((s,w)=>s+w.amount,0)));
  console.log("Facturas distintas a conciliar:",new Set(writes.map(w=>w.invId)).size,"| movimientos:",new Set(writes.map(w=>w.movId)).size);
  console.log("Cartola: mov sin match en app:",noMov,"| asignación sin factura en app:",noFact,"| ya pagada/sin saldo:",yaConc,"| signo incoherente (descartado):",badSign);
  // Detalle legible de cada imputación a crear (para revisar antes de aplicar).
  const movById=new Map(movs.map(m=>[m.id,m as any])); const invById=new Map(inv.map(i=>[i.id,i as any]));
  console.log("\nDetalle:");
  for(const w of writes){const m=movById.get(w.movId);const f=invById.get(w.invId);console.log(`  ${ymd(m.date)} ${String(m.amount).padStart(10)} ${(m.description||"").slice(0,30).padEnd(30)} -> F-${f.folioNumber} ${f.type} tipo${f.tipoDoc} $${fmt(w.amount)}`);}
  if(!APPLY){console.log("\n(DRY-RUN — nada escrito)");await prisma.$disconnect();return;}
  console.log("\nAPLICANDO...");
  // dedupe por (mov,factura) — las 2 cartolas se solapan y el constraint es unique(bankMovementId,invoiceId)
  const dedup=new Map<string,any>(); for(const w of writes){const k=w.movId+"|"+w.invId; if(!dedup.has(k))dedup.set(k,w);}
  const tInv=new Set<string>(),tMov=new Set<string>(); let created=0;
  for(const w of dedup.values()){
    const ex=await prisma.invoicePayment.findFirst({where:{bankMovementId:w.movId,invoiceId:w.invId},select:{id:true}});
    if(!ex){await prisma.invoicePayment.create({data:{bankMovementId:w.movId,invoiceId:w.invId,amountApplied:w.amount,autoMatched:false}});created++;}
    tInv.add(w.invId);tMov.add(w.movId);
  }
  for(const movId of tMov){const m=await prisma.bankMovement.findUnique({where:{id:movId},select:{amount:true}});const ap=(await prisma.invoicePayment.aggregate({where:{bankMovementId:movId},_sum:{amountApplied:true}}))._sum.amountApplied??0;await prisma.bankMovement.update({where:{id:movId},data:{status:ap>=Math.abs(m!.amount)-1?"conciliado":"parcial"}});}
  for(const invId of tInv)await recomputeInvoiceStatus(invId);
  console.log("Listo: creadas "+created+" (deduped "+dedup.size+"),",tInv.size,"facturas,",tMov.size,"movimientos.");
  await prisma.$disconnect();
}
main().catch(async(e)=>{console.error("FATAL:",e);await prisma.$disconnect();process.exit(1);});
