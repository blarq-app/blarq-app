// Regresión del pendiente 184: la regla del proveedor se guarda SOLO cuando
// MJ prende el tilde en el bulk-assign. Nada más la crea ni la cambia. Y la
// categoría dicha por Telegram gana sobre la que puso la regla.
//
// No toca ninguna base: reemplaza los métodos de prisma que usa
// upsertInvoiceRule por una "base" en memoria. Uso:
//   npx tsx scripts/test-reglas-solo-con-tilde.ts
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { upsertInvoiceRule, applyInvoiceRule } from "../src/lib/facturas/categorizationRules";
import { applyTagToInvoice } from "../src/lib/facturas/pendingTags";

type Inv = { rutIssuer: string | null; businessName: string | null; categoryId: string | null; projectId: string | null };
type Rule = { id: string; rutIssuer: string | null; providerName: string | null; categoryId: string | null; projectId: string | null; hits: number };

let invoices: Inv[] = [];
let rules: Rule[] = [];

const matches = (i: Inv | Rule, w: Record<string, unknown>) =>
  Object.entries(w).every(([k, v]) => (i as Record<string, unknown>)[k] === v);

/* eslint-disable @typescript-eslint/no-explicit-any */
const p = prisma as any;
let ultimoUpdate: Record<string, unknown> | null = null;
let facturaUnica: Record<string, unknown> | null = null;
p.invoice = {
  findUnique: async () => facturaUnica,
  update: async ({ data }: any) => {
    ultimoUpdate = data;
    return {};
  },
  updateMany: async ({ where, data }: any) => {
    const hit = invoices.filter((i) => matches(i, where));
    hit.forEach((i) => Object.assign(i, data));
    return { count: hit.length };
  },
};
p.invoiceCategorizationRule = {
  // Copia, como Prisma: el objeto devuelto no cambia cuando se actualiza.
  findUnique: async ({ where }: any) => {
    const r = rules.find((x) => matches(x, where));
    return r ? { ...r } : null;
  },
  create: async ({ data }: any) => {
    const r = { id: `r${rules.length + 1}`, rutIssuer: null, providerName: null, categoryId: null, projectId: null, ...data, hits: 1 };
    rules.push(r);
    return { ...r };
  },
  update: async ({ where, data }: any) => {
    const r = rules.find((x) => x.id === where.id)!;
    const { hits, ...rest } = data;
    Object.assign(r, rest);
    r.hits = typeof hits === "number" ? hits : r.hits + 1;
    return { ...r };
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
  // 1. Con el tilde: la regla cambia y devuelve lo que tenía (para deshacer).
  invoices = facturas(3, "materiales");
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "herramientas", projectId: "blarq", hits: 5 }];
  let r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "materiales" });
  check("tilde prendido: la regla pasa a Materiales", rules[0].categoryId === "materiales" && r.updated);
  check("devuelve categoría y centro de costo anteriores", r.previousCategoryId === "herramientas" && r.previousProjectId === "blarq");
  check("no toca el centro de costo si no se pidió", rules[0].projectId === "blarq");

  // 2. Proveedor sin regla: se crea y completa las facturas sin categoría.
  invoices = [...facturas(4, "materiales"), ...facturas(3, null)];
  rules = [];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { categoryId: "materiales" });
  check("sin regla previa: la crea", r.created && rules[0]?.categoryId === "materiales");
  check("completa solo las 3 sin categoría", r.appliedRetroactively === 3);
  check("regla nueva: no hay nada anterior", r.previousCategoryId === null && r.previousProjectId === null);

  // 3. Solo el tilde de centro de costo: la categoría de la regla no se mueve.
  invoices = facturas(2, "materiales");
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "materiales", projectId: null, hits: 1 }];
  r = await upsertInvoiceRule(SODIMAC, "SODIMAC", { projectId: "blarq" });
  check("solo centro de costo: categoría intacta", rules[0].categoryId === "materiales" && rules[0].projectId === "blarq");

  // 4. Nadie más aprende: upsertInvoiceRule solo se llama desde el bulk-assign,
  //    y ahí solo si el tilde viene en true.
  const raiz = path.join(__dirname, "..", "src");
  const usos: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(full);
      else if (/\.tsx?$/.test(f.name) && fs.readFileSync(full, "utf8").includes("upsertInvoiceRule("))
        usos.push(path.relative(raiz, full));
    }
  };
  recorrer(raiz);
  check(
    "solo el bulk-assign guarda reglas",
    usos.sort().join(",") === ["app/api/facturas/bulk-assign/route.ts", "lib/facturas/categorizationRules.ts"].join(",")
  );
  const bulk = fs.readFileSync(path.join(raiz, "app/api/facturas/bulk-assign/route.ts"), "utf8");
  check("el bulk-assign exige el tilde en true", bulk.includes("body.learnCategoryRule === true") && bulk.includes("body.learnProjectRule === true"));
  const barra = fs.readFileSync(path.join(raiz, "components/facturas/BulkAssignBar.tsx"), "utf8");
  check("el tilde de categoría parte apagado", barra.includes("useState(false);\n  const [learnProjectRule") || /learnCategoryRule, setLearnCategoryRule\] = useState\(false\)/.test(barra));

  // 5. Telegram: "herramienta" gana sobre la categoría que puso la regla, y
  //    la regla del proveedor no se toca. La obra solo llena lo vacío.
  rules = [{ id: "r1", rutIssuer: SODIMAC, providerName: null, categoryId: "materiales", projectId: null, hits: 1 }];
  ultimoUpdate = null;
  let t = await applyTagToInvoice("f1", { projectId: "sena", categoryId: "materiales" }, "portofino", "herramientas");
  check("Telegram: la categoría pasa a Herramientas", t.setCategory && ultimoUpdate?.["categoryId"] === "herramientas");
  check("Telegram: la obra ya asignada no se mueve", !t.setProject && !("projectId" in (ultimoUpdate ?? {})));
  check("Telegram: la regla sigue en Materiales", rules[0].categoryId === "materiales");
  ultimoUpdate = null;
  t = await applyTagToInvoice("f1", { projectId: null, categoryId: "herramientas" }, "portofino", "herramientas");
  check("Telegram: misma categoría → no reescribe, llena la obra vacía", !t.setCategory && t.setProject);

  // 6. Emitidas: el emisor es BLARQ, nunca se les aplica ni aprende regla.
  const BLARQ = "77270733-9";
  rules = [{ id: "r1", rutIssuer: BLARQ, providerName: null, categoryId: "muebles", projectId: null, hits: 1 }];
  facturaUnica = { id: "e1", type: "emitida", categoryId: null, projectId: null, rutIssuer: BLARQ, businessName: "CLIENTE" };
  ultimoUpdate = null;
  let a = await applyInvoiceRule("e1");
  check("emitida: no toma la regla (un EP de obra no entra como Muebles)", !a.applied && ultimoUpdate === null);
  facturaUnica = { id: "f9", type: "recibida", categoryId: null, projectId: null, rutIssuer: BLARQ, businessName: "X" };
  a = await applyInvoiceRule("f9");
  check("recibida: sí toma la regla", a.applied && ultimoUpdate?.["categoryId"] === "muebles");
  check("el bulk-assign solo aprende de recibidas", bulk.includes('type: "recibida"'));

  console.log(fallas === 0 ? "\nTodo OK" : `\n${fallas} falla(s)`);
  process.exit(fallas === 0 ? 0 : 1);
}
main();
