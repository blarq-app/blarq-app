import type { Metadata } from "next";
import { Hanken_Grotesk, Spectral, Nunito_Sans } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

// Sistema tipográfico del Manual de Marca BLARQ v2 (Claro) — tres roles:
//  · Nunito Sans  → cuerpo, datos y cotas (cifras tabulares; "la de AutoCAD"). Es la base.
//  · Hanken Grotesk Extra Light → títulos en altas espaciadas (display).
//  · Spectral itálica → bajadas y citas (serif contemporáneo).
const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "BLARQ - Gestión de Obras",
  description: "Sistema de control de costos y presupuestos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${nunitoSans.variable} ${hankenGrotesk.variable} ${spectral.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
