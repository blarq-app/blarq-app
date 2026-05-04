// Reset de password para un user existente. Útil para:
//   - Onboarding inicial de JT en producción.
//   - Recuperar acceso si alguien olvida su pass.
//   - Cualquier ajuste de credenciales antes de tener UI "Mi cuenta".
//
// Uso (local contra dev DB):
//   npx tsx scripts/set-password.ts <email> <new-password>
//
// Uso (contra producción, apuntando al DATABASE_URL de Neon):
//   DATABASE_URL=<neon-url> npx tsx scripts/set-password.ts <email> <new-password>
//
// El script NO crea users — solo actualiza la contraseña de uno existente.
// Si el email no existe, falla con código 1.

import { hashSync } from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error("Uso: npx tsx scripts/set-password.ts <email> <new-password>");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No existe user con email: ${email}`);
    process.exit(1);
  }

  const hash = hashSync(password, 10);
  await prisma.user.update({
    where: { email },
    data: { password: hash },
  });

  console.log(`✓ Password actualizada para ${email} (${user.name})`);
  console.log(`  Pasale la contraseña por canal seguro (no email).`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
