// Cambia el email de un user existente. Útil cuando el seed dejó emails
// placeholder y queremos los reales.
//
// Uso: npx tsx scripts/update-user-email.ts <old-email> <new-email>

import { prisma } from "../src/lib/prisma";

async function main() {
  const [, , oldEmail, newEmail] = process.argv;

  if (!oldEmail || !newEmail) {
    console.error("Uso: npx tsx scripts/update-user-email.ts <old-email> <new-email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email: oldEmail } });
  if (!user) {
    console.error(`No existe user con email: ${oldEmail}`);
    process.exit(1);
  }

  // Verificar que el nuevo email no esté tomado por otro user
  const conflict = await prisma.user.findUnique({ where: { email: newEmail } });
  if (conflict && conflict.id !== user.id) {
    console.error(`Ya existe otro user con email: ${newEmail}`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { email: newEmail },
  });

  console.log(`✓ Email actualizado: ${oldEmail} → ${newEmail} (${user.name})`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
