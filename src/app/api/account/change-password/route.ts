import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { compareSync, hashSync } from "bcryptjs";
import { NextResponse } from "next/server";

// POST /api/account/change-password
//
// Permite al user logueado cambiar su propia password. Valida la pass
// actual antes de aceptar la nueva — evita que alguien con sesión robada
// cambie la pass sin saber la actual.
//
// Body: { currentPassword: string, newPassword: string }
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await request.json();

  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "La nueva contraseña debe tener al menos 8 caracteres" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  if (!compareSync(currentPassword, user.password)) {
    return NextResponse.json(
      { error: "La contraseña actual es incorrecta" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashSync(newPassword, 10) },
  });

  return NextResponse.json({ ok: true });
}
