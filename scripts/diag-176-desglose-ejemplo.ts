// SOLO LECTURA: imprime el desglose completo de dos partidas de Casa Los
// Algarrobos para armar el mockup del aviso (pendiente 176): una con la placa
// OSB en cero (material que BLARQ pone y no cobra → hay que avisar) y una con
// PROVISION GRIFERIA en cero (BLARQ solo instala → NO hay que avisar).
// Uso: npx tsx scripts/diag-176-desglose-ejemplo.ts <ruta-env-prod>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const proj = await prisma.project.findFirst({
    where: { name: { contains: "Algarrobos" } },
    select: { id: true, name: true },
  });
  const vers = await prisma.budgetVersion.findMany({
    where: { projectId: proj!.id, type: "obra" },
    select: { id: true, version: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("Proyecto:", proj!.name);
  console.log("Versiones:", vers.map((v) => `${v.version}/${v.status}`).join(" · "), "\n");
  const vigente =
    vers.find((v) => v.status === "enviado" || v.status === "aprobado") ?? vers[0];
  console.log("VIGENTE:", vigente.version, vigente.status, "\n");

  const items = await prisma.obraItem.findMany({
    where: {
      budgetVersionId: vigente.id,
      OR: [
        { name: { contains: "TABIQUE" } },
        { name: { contains: "GRIFERIA" } },
      ],
    },
    include: {
      components: {
        orderBy: { sortOrder: "asc" },
        include: { material: { select: { isProvision: true } } },
      },
    },
  });

  for (const it of items) {
    console.log(
      `\n### ${it.itemNumber} ${it.name} — ${it.unit} · cant ${it.quantity} · P.U $${Math.round(it.unitPrice).toLocaleString("es-CL")} · TOTAL $${Math.round(it.total).toLocaleString("es-CL")}`
    );
    for (const c of it.components) {
      console.log(
        [
          c.type.padEnd(12),
          c.description.slice(0, 46).padEnd(48),
          c.unit.padEnd(4),
          `cant ${c.quantity}`.padStart(11),
          `$${Math.round(c.unitCost).toLocaleString("es-CL")}`.padStart(11),
          `= $${Math.round(c.totalCost).toLocaleString("es-CL")}`.padStart(12),
          c.material?.isProvision ? " [provisión]" : "",
        ].join(" ")
      );
    }
  }
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
