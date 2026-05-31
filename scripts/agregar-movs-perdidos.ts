// Agrega los 7 movimientos que la app perdió (pares mismo-monto-mismo-día
// donde guardó solo 1). Por cada par: backfillea el saldo corrido del que ya
// está + agrega el faltante. Dry-run default.
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { prisma } from "../src/lib/prisma";
import { parseCartolaSantander } from "../src/lib/banco/santanderParser";
const APPLY=process.argv.includes("--apply");
const fmt=(n:number)=>Math.round(n).toLocaleString("es-CL");
const ymd=(d:Date)=>d.toISOString().slice(0,10);
const DIR="/Users/mjblanco/Downloads/2025_Cartolas";
const PARES:[string,number][]=[["2025-03-24",-600000],["2025-04-02",-1000000],["2025-05-02",-1000000],["2025-06-09",1],["2025-07-01",-2000000],["2025-09-01",-2000000],["2025-10-06",-2000000]];

async function main(){
  console.log("Modo:",APPLY?"APPLY":"DRY-RUN");
  const cartMovs:any[]=[]; const seen=new Set<string>();
  for(const f of readdirSync(DIR).filter(x=>x.includes("000089134595"))){
    const p=parseCartolaSantander(readFileSync(DIR+"/"+f));
    for(const m of p.movements){ const k=ymd(m.date)+"|"+m.amount+"|"+m.balanceAfter+"|"+(m.description||""); if(seen.has(k))continue; seen.add(k); cartMovs.push(m); }
  }
  const op=await prisma.bankAccount.findFirst({where:{accountNumber:{contains:"8913459"}}});
  let added=0,backfilled=0;
  for(const [fecha,monto] of PARES){
    const cart=cartMovs.filter(m=>ymd(m.date)===fecha && m.amount===monto).sort((a,b)=>b.balanceAfter-a.balanceAfter);
    const app=await prisma.bankMovement.findMany({where:{bankAccountId:op!.id,date:{gte:new Date(fecha+"T00:00:00Z"),lte:new Date(fecha+"T23:59:59Z")},amount:monto}});
    if(cart.length<=app.length){console.log("  "+fecha+" "+fmt(monto)+": ya completo, skip");continue;}
    // asignar saldos corridos del cartola a las filas (las existentes + las nuevas)
    // backfill: a cada app existente sin balanceAfter, darle un saldo del cartola (por descripción si calza, sino el primero libre)
    const cartLeft=[...cart];
    for(const a of app){ if(a.balanceAfter==null){ // emparejar por descripción
        let i=cartLeft.findIndex(c=>(c.description||"")===(a.description||"")); if(i<0)i=0;
        const c=cartLeft.splice(i,1)[0];
        console.log("  BACKFILL "+fecha+" "+fmt(monto)+" ["+(a.description||"").slice(0,28)+"] saldo→"+fmt(c.balanceAfter));
        if(APPLY) await prisma.bankMovement.update({where:{id:a.id},data:{balanceAfter:c.balanceAfter}});
        backfilled++;
    } else { const i=cartLeft.findIndex(c=>c.balanceAfter===a.balanceAfter); if(i>=0)cartLeft.splice(i,1); } }
    // los que quedan en cartLeft son los que faltan → agregar
    for(const c of cartLeft){
      console.log("  AGREGAR  "+fecha+" "+fmt(monto)+" ["+(c.description||"").slice(0,30)+"] saldo:"+fmt(c.balanceAfter)+" rut:"+(c.counterpartyRut||"-"));
      if(APPLY) await prisma.bankMovement.create({data:{bankAccountId:op!.id,date:c.date,amount:c.amount,description:c.description,type:c.amount>=0?"in":"out",balanceAfter:c.balanceAfter,externalRef:c.externalRef,counterpartyName:c.counterpartyName??null,counterpartyRut:c.counterpartyRut??null,status:"sin_asignar"}});
      added++;
    }
  }
  console.log("\nAgregados:",added,"| backfilleados:",backfilled);
  if(!APPLY)console.log("(DRY-RUN)");
  await prisma.$disconnect();
}
main().catch(async(e)=>{console.error(e.message);await prisma.$disconnect();process.exit(1);});
