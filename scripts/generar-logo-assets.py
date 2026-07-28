#!/usr/bin/env python3
"""
Genera los archivos derivados del logo BLARQ que usa la app.

Por qué existe: el logo original (`blarq-logo-horizontal-ink.png`) es tinta oscura
sobre fondo transparente. La barra lateral tiene fondo negro, así que ahí el logo
es invisible. En vez de dejar el color a merced de un filtro CSS, se hornean acá
las dos piezas que la barra necesita, y este script queda como constancia de cómo
se sacaron (para poder rehacerlas si cambia el logo maestro).

Piezas que produce, a partir de los originales que ya estaban en public/assets:
  - blarq-isotipo-blanco.png   ← la "A" del isotipo, en blanco
  - blarq-wordmark-blanco.png  ← solo el bloque "BLARQ" (sin la bajada), en blanco

Y el favicon de la pestaña del navegador (src/app/favicon.ico): la "A" en blanco
sobre un cuadrado casi negro, del mismo tono que la barra lateral. Va con fondo
sólido a propósito — la "A" sola, al ser un trazo fino, se pierde en las pestañas
de 16px y desaparece del todo si el navegador está en tema oscuro.

Correr con:  python3 scripts/generar-logo-assets.py
Necesita Pillow (pip install Pillow). No se corre en el build; es a mano.
"""

import os
from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(RAIZ, "public", "assets")
APP = os.path.join(RAIZ, "src", "app")

# Fondo de la barra lateral (Tailwind gray-900). El favicon usa el mismo tono
# para que la pestaña y la barra se lean como la misma pieza.
GRIS_900 = (17, 24, 39)

# Filas del logo horizontal donde vive cada bloque, medidas sobre el alfa del
# archivo original (2477x765): arriba el "BLARQ", abajo la bajada
# "BLANCO LARRAÍN ARQUITECTOS", separadas por una banda vacía.
WORDMARK_TOP, WORDMARK_BOTTOM = 39, 490


def a_blanco(im: Image.Image) -> Image.Image:
    """Deja la figura en blanco puro conservando el canal alfa.

    No sirve invertir los colores: eso también toca los píxeles semitransparentes
    del antialiasing y deja un halo. Se descarta el RGB entero y se reconstruye
    la imagen como blanco + el alfa original, que es lo único que define la forma.
    """
    alfa = im.convert("RGBA").split()[3]
    blanco = Image.new("RGBA", im.size, (255, 255, 255, 0))
    blanco.putalpha(alfa)
    return blanco


def escalar_a_ancho(im: Image.Image, ancho: int) -> Image.Image:
    alto = round(im.height * ancho / im.width)
    return im.resize((ancho, alto), Image.LANCZOS)


def generar_isotipo_blanco() -> Image.Image:
    iso = Image.open(os.path.join(ASSETS, "blarq-isotipo-piedra.png")).convert("RGBA")
    iso = iso.crop(iso.getbbox())  # sacar el aire de alrededor
    salida = escalar_a_ancho(a_blanco(iso), 256)
    salida.save(os.path.join(ASSETS, "blarq-isotipo-blanco.png"), "PNG", optimize=True)
    return iso


def generar_wordmark_blanco() -> None:
    full = Image.open(os.path.join(ASSETS, "blarq-logo-horizontal-ink.png")).convert("RGBA")
    izq, _, der, _ = full.getbbox()
    word = full.crop((izq, WORDMARK_TOP, der, WORDMARK_BOTTOM))
    salida = escalar_a_ancho(a_blanco(word), 720)
    salida.save(os.path.join(ASSETS, "blarq-wordmark-blanco.png"), "PNG", optimize=True)


def _icono(iso_recortado: Image.Image, lado: int, margen_pct: float, engrosar: bool) -> Image.Image:
    """Dibuja el favicon a un tamaño concreto.

    Se dibuja cada tamaño por separado en vez de achicar uno grande: el isotipo
    es de trazo muy fino y al reducirlo a 16px el antialiasing lo deja casi
    transparente. Para los tamaños chicos se le da menos margen y se le engorda
    el trazo un pelo antes de escalar, para que la "A" siga leyéndose.
    """
    fondo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    radio = max(2, round(lado * 0.22))
    ImageDraw.Draw(fondo).rounded_rectangle([0, 0, lado - 1, lado - 1], radius=radio, fill=GRIS_900)

    iso = a_blanco(iso_recortado)
    if engrosar:
        # MaxFilter sobre el alfa = dilatar la figura; el 3 es un píxel de más
        # por lado sobre el original de ~440px, o sea un engorde muy leve.
        alfa = iso.split()[3].filter(ImageFilter.MaxFilter(3))
        iso.putalpha(alfa)

    caja = lado - round(lado * margen_pct) * 2
    escala = min(caja / iso.width, caja / iso.height)
    iso = iso.resize((max(1, round(iso.width * escala)), max(1, round(iso.height * escala))), Image.LANCZOS)
    fondo.alpha_composite(iso, ((lado - iso.width) // 2, (lado - iso.height) // 2))
    return fondo


def generar_favicon(iso_recortado: Image.Image) -> None:
    # (lado, margen, ¿engrosar el trazo?) — los chicos van más apretados.
    recetas = [(16, 0.06, True), (32, 0.09, True), (48, 0.12, True),
               (64, 0.14, False), (128, 0.16, False), (256, 0.18, False)]
    capas = [_icono(iso_recortado, lado, margen, engrosar) for lado, margen, engrosar in recetas]
    capas[-1].save(
        os.path.join(APP, "favicon.ico"),
        format="ICO",
        sizes=[(c.width, c.height) for c in capas],
        append_images=capas[:-1],
    )


if __name__ == "__main__":
    iso = generar_isotipo_blanco()
    generar_wordmark_blanco()
    generar_favicon(iso)
    print("Listo: blarq-isotipo-blanco.png, blarq-wordmark-blanco.png, favicon.ico")
