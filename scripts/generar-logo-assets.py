#!/usr/bin/env python3
"""
Genera los archivos derivados del logo BLARQ que usa la app.

Por qué existe: el logo original (`blarq-logo-horizontal-ink.png`) es tinta oscura
sobre fondo transparente. La barra lateral tiene fondo casi negro, así que ahí el
logo es invisible. En vez de dejar el color a merced de un filtro CSS, se hornean
acá las piezas que la barra necesita, y este script queda como constancia de cómo
se sacaron (para poder rehacerlas si cambia el logo maestro o el tono).

Piezas que produce, a partir de los originales que ya estaban en public/assets:
  - blarq-wordmark-claro.png  ← solo el bloque "BLARQ" (sin la bajada)
  - blarq-bajada-claro.png    ← solo "BLANCO LARRAÍN ARQUITECTOS"

Van en dos archivos separados porque en la barra llevan jerarquía distinta: BLARQ
manda y la bajada acompaña, más chica y atenuada.

**No van en blanco puro**: el blanco sobre el fondo oscuro quedaba duro y fuera de
la paleta (decisión de MJ al ver las dos opciones). Usan LINO, uno de los neutros
claros del Manual de Marca v2 — el mismo token `--color-lino` de globals.css.

Y el favicon de la pestaña (src/app/favicon.ico): la "A" del isotipo en blanco
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

# Tonos del Manual de Marca v2 (los mismos hex que globals.css). Si algún día
# cambian ahí, cambiarlos acá y volver a correr el script.
LINO = (0xE3, 0xE1, 0xDF)       # --color-lino: neutro claro, el del logo en la barra
GRIS_900 = (0x2A, 0x27, 0x22)   # gray-900 re-temperado: el fondo real de la barra
BLANCO = (0xFF, 0xFF, 0xFF)

# Filas del logo horizontal donde vive cada bloque, medidas sobre el alfa del
# archivo original (2477x765): arriba el "BLARQ", abajo la bajada
# "BLANCO LARRAÍN ARQUITECTOS", separadas por una banda vacía.
WORDMARK_TOP, WORDMARK_BOTTOM = 39, 490
BAJADA_TOP, BAJADA_BOTTOM = 580, 700


def a_color(im: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Repinta la figura de un color plano conservando el canal alfa.

    No sirve invertir ni teñir los colores: eso también toca los píxeles
    semitransparentes del antialiasing y deja un halo. Se descarta el RGB entero
    y se reconstruye la imagen como color plano + el alfa original, que es lo
    único que define la forma.
    """
    alfa = im.convert("RGBA").split()[3]
    plano = Image.new("RGBA", im.size, rgb + (0,))
    plano.putalpha(alfa)
    return plano


def escalar_a_ancho(im: Image.Image, ancho: int) -> Image.Image:
    alto = round(im.height * ancho / im.width)
    return im.resize((ancho, alto), Image.LANCZOS)


def generar_piezas_del_logo() -> None:
    full = Image.open(os.path.join(ASSETS, "blarq-logo-horizontal-ink.png")).convert("RGBA")
    izq, _, der, _ = full.getbbox()

    word = full.crop((izq, WORDMARK_TOP, der, WORDMARK_BOTTOM))
    escalar_a_ancho(a_color(word, LINO), 720).save(
        os.path.join(ASSETS, "blarq-wordmark-claro.png"), "PNG", optimize=True
    )

    bajada = full.crop((izq, BAJADA_TOP, der, BAJADA_BOTTOM))
    escalar_a_ancho(a_color(bajada, LINO), 720).save(
        os.path.join(ASSETS, "blarq-bajada-claro.png"), "PNG", optimize=True
    )


def _icono(iso: Image.Image, lado: int, margen_pct: float, engrosar: bool) -> Image.Image:
    """Dibuja el favicon a un tamaño concreto.

    Se dibuja cada tamaño por separado en vez de achicar uno grande: el isotipo
    es de trazo muy fino y al reducirlo a 16px el antialiasing lo deja casi
    transparente. Para los tamaños chicos se le da menos margen y se le engorda
    el trazo un pelo antes de escalar, para que la "A" siga leyéndose.
    """
    fondo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    radio = max(2, round(lado * 0.22))
    ImageDraw.Draw(fondo).rounded_rectangle([0, 0, lado - 1, lado - 1], radius=radio, fill=GRIS_900)

    # Acá sí va blanco puro: es una figura chica sobre un cuadrado oscuro, y el
    # contraste máximo es lo único que la salva a 16px.
    figura = a_color(iso, BLANCO)
    if engrosar:
        # MaxFilter sobre el alfa = dilatar la figura; el 3 es un píxel de más
        # por lado sobre el original de ~440px, o sea un engorde muy leve.
        figura.putalpha(figura.split()[3].filter(ImageFilter.MaxFilter(3)))

    caja = lado - round(lado * margen_pct) * 2
    escala = min(caja / figura.width, caja / figura.height)
    figura = figura.resize(
        (max(1, round(figura.width * escala)), max(1, round(figura.height * escala))),
        Image.LANCZOS,
    )
    fondo.alpha_composite(figura, ((lado - figura.width) // 2, (lado - figura.height) // 2))
    return fondo


def generar_favicon() -> None:
    iso = Image.open(os.path.join(ASSETS, "blarq-isotipo-piedra.png")).convert("RGBA")
    iso = iso.crop(iso.getbbox())  # sacar el aire de alrededor
    # (lado, margen, ¿engrosar el trazo?) — los chicos van más apretados.
    recetas = [(16, 0.06, True), (32, 0.09, True), (48, 0.12, True),
               (64, 0.14, False), (128, 0.16, False), (256, 0.18, False)]
    capas = [_icono(iso, lado, margen, engrosar) for lado, margen, engrosar in recetas]
    capas[-1].save(
        os.path.join(APP, "favicon.ico"),
        format="ICO",
        sizes=[(c.width, c.height) for c in capas],
        append_images=capas[:-1],
    )


if __name__ == "__main__":
    generar_piezas_del_logo()
    generar_favicon()
    print("Listo: blarq-wordmark-claro.png, blarq-bajada-claro.png, favicon.ico")
