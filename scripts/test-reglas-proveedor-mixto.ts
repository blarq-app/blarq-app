// Regresión del pendiente 184: la regla de categoría de un proveedor NO se
// pisa sola cuando sus facturas ya están en 2+ categorías.
//
// No toca ninguna base: reemplaza los métodos de prisma que usa
// upsertInvoiceRule por una "base" en memoria. Uso:
//   npx tsx scripts/test-reglas-proveedor-mixto.ts
import { prisma } from "../src/lib/prisma";
import { upsertInvoiceRule } from "../src/lib/facturas/categorizationRules";

type Inv = { rutIssuer: string | null; businessName: string | null; categoryId: string | null; projectId: string | null };
type Rule = { id: string; rutIssuer: string | null; providerName: string | null; categoryId: string | null; projectId: string | null; hits: number };

let invoices: Inv[] = [];
let rules: Rule[] = [];

const matches = (i: Inv, w: Record<string, unknown>) =>
  Object.entries(w).every(([k, v]) => {
    const val = (i as Record<string, unknown>)[k];
    if (v && typeof v === "object" && "not" in v) return val !== (v as { not: unknown }).not;
    return val === v;
  });

/* eslint-disable @typescript-eslint/no-explicit-any */
const p = prisma as any;
p.invoice = {
  groupBy: async ({ where }: any) =>
    [...new Set(invoices.filter((i) => matches(i, where)).map((i) => i.categoryId))].map((categoryId) => ({ categoryId })),
  updateMany: async ({ where, data }: any) => {
    const hit = invoices.filter((i) => matches(i, where));
    hit.forEach((i) => Object.assign(i, data));
    return { count: hit.length };
  },
};
p.invoiceCategorizationRule = {
  findUnique: async ({ where }: any) => rules.find((r) => matches(r as any, where)) ?? null,
  create: async ({ data }: any) => {
    const r = { id: `r${rules.length + 1}`, rutIssuer: null, providerName: null, categoryId: null, projectId: null, ...data, hits: 1 };
    rules.push(r);
    return r;
  },
  update: async ({ where, data }: any) => {
    const r = rules.find((x) => x.id === where.id)!;
    const { hits, ...rest } = data;
    Object.assign(r, rest);
    r.hits = typeof hits === "number" ? hits : r.hits + 1;
    return r;
  },
};

const SODIMAC = "96792430-K";
const facturas = (n: number, cat: string | null): Inv[] =>
  Array.from({ length: n }, () => ({ rutIssuer: SODIMAC, businessName: "SODIMAC", categoryId: cat, projectId: null }));

let fallas = 0;
function check(nombre: string, ok: boolean) {
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}`);
  if (!ok) fallas++;
}

async function main() {
  // 1. Caso Sodimac: regla Materiales, facturas mixtas. MJ pone una en
  //    Herramientas → la regla NO se mueve.
  invoices = [...facturas(9, "materiales"), ...facturas(1, "herramientas")];
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "materiales", projectId: null, hits: 5 }];
  let r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "herramientas" });
  check("proveedor mixto: la regla sigue en Materiales", rules[0].categoryId === "materiales");
  check("proveedor mixto: avisa categorySkipped con 2 categorías", r.categorySkipped?.categoryCount === 2 && !r.updated && !r.created);

  // 2. Proveedor de una sola categoría: se aprende como siempre.
  invoices = facturas(3, "herramientas");
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "materiales", projectId: null, hits: 5 }];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "herramientas" });
  check("una sola categoría: la regla se actualiza", rules[0].categoryId === "herramientas" && r.updated);
  check("una sola categoría: devuelve la categoría anterior para deshacer", r.previousCategoryId === "materiales");

  // 3. Mixto y sin regla: no se crea una regla nueva.
  invoices = [...facturas(2, "materiales"), ...facturas(2, "herramientas")];
  rules = [];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "materiales" });
  check("mixto sin regla: no crea regla", rules.length === 0 && !r.created);

  // 4. Las facturas sin categoría no cuentan como una categoría más.
  invoices = [...facturas(4, "materiales"), ...facturas(3, null)];
  rules = [];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "materiales" });
  check("sin categoría no cuenta: crea la regla", r.created && rules[0]?.categoryId === "materiales");
  check("y completa las 3 sin categoría (retroactivo de siempre)", r.appliedRetroactively === 3);

  // 5. Mixto + toggle de proyecto (bulk-assign): el proyecto se guarda igual,
  //    la categoría no.
  invoices = [...facturas(2, "materiales"), ...facturas(1, "herramientas")];
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "materiales", projectId: null, hits: 1 }];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "herramientas", projectId: "blarq" });
  check("mixto + proyecto: proyecto sí, categoría no", rules[0].projectId === "blarq" && rules[0].categoryId === "materiales" && !!r.categorySkipped);

  // 6. Internacional sin RUT (por nombre exacto): mismo criterio.
  invoices = [
    { rutIssuer: null, businessName: "Google", categoryId: "software", projectId: null },
    { rutIssuer: null, businessName: "Google", categoryId: "generales", projectId: null },
    { rutIssuer: null, businessName: "Otro", categoryId: "x", projectId: null },
  ];
  rules = [{ id: "r1", rutIssuer: null, providerName: "Google", categoryId: "software", projectId: null, hits: 1 }];
  r = await upsertInvoiceRule(null, "Google", { categoryId: "generales" });
  check("internacional mixto: la regla no se mueve", rules[0].categoryId === "software" && r.categorySkipped?.categoryCount === 2);

  console.log(fallas === 0 ? "\nTodo OK" : `\n${fallas} falla(s)`);
  process.exit(fallas === 0 ? 0 : 1);
}
main();
