import { computeFormaPagoFondo, type ProjectForFormaPago } from "../src/lib/banco/formaPagoFondo";

// Caso sintético tipo JNC: obra CD 24.829.899,82, GG 20%, util 5%, forma de
// pago 40/25/25/10. Sin cobros aún.
const jnc: ProjectForFormaPago = {
  invoices: [],
  budgetVersions: [
    {
      type: "obra", status: "aprobado", ggPercentage: 20, utilityPercentage: 5,
      createdAt: new Date("2026-01-01"),
      obraItems: [{ total: 24_829_899.82 }],
      muebleChapters: [], paymentTerms: [], artefactoItems: [],
    },
    // forma de pago en la versión enviada (como JNC real)
    {
      type: "obra", status: "enviado", ggPercentage: 20, utilityPercentage: 5,
      createdAt: new Date("2026-02-01"),
      obraItems: [{ total: 25_478_448 }],
      muebleChapters: [],
      paymentTerms: [
        { stage: "anticipo", percentage: 40, sortOrder: 0 },
        { stage: "avance1", percentage: 25, sortOrder: 1 },
        { stage: "avance2", percentage: 25, sortOrder: 2 },
        { stage: "saldo", percentage: 10, sortOrder: 3 },
      ],
      artefactoItems: [],
    },
  ],
};

const r = computeFormaPagoFondo(jnc);
const f = (n: number) => Math.round(n).toLocaleString("es-CL");
console.log("obraCD:", f(r.obraCD), "(esperado 24.829.900)");
console.log("obraGGTotal (utilidad a generar):", f(r.obraGGTotal), "(esperado 4.965.980)");
console.log("obraTotalAcordado:", f(r.obraTotalAcordado), "(esperado 37.229.952)");
console.log("tramosDesdeAprobada:", r.tramosDesdeAprobada, "(esperado false → fallback a enviada)");
console.log("hayFormaPago:", r.hayFormaPago);
console.log("\nTramos:");
let sumMonto = 0, sumUtil = 0;
for (const t of r.tramos) {
  console.log(`  ${t.label.padEnd(10)} ${t.percentage}%  monto ${f(t.montoACobrar).padStart(12)}  utilidad ${f(t.utilidadGenera).padStart(11)}  [${t.estado}]`);
  sumMonto += t.montoACobrar; sumUtil += t.utilidadGenera;
}
console.log(`  SUMA monto=${f(sumMonto)} (=total acordado) · utilidad=${f(sumUtil)} (=GG)`);
console.log("\nCheck: utilidad anticipo 40% =", f(r.tramos[0].utilidadGenera), "(esperado 1.986.392)");
