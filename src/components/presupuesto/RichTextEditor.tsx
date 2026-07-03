"use client";

// Editor de texto con formato para las descripciones del cotizador (cliente y
// maestro). Basado en Tiptap. Soporta: negrita, cursiva, subrayado, viñetas,
// lista numerada y color (paleta acotada de tonos apagados, para no romper el
// tono editorial blanco/negro/gris de BLARQ).
//
// La barra de formato NO es fija: aparece como un menú flotante chico (BubbleMenu)
// SOLO cuando hay texto seleccionado — así no ocupa espacio al desplegar la
// partida (pedido de MJ). Estilo proporcional y discreto.
//
// Guarda HTML (controlado: value/onChange). El HTML se limpia con
// sanitizeRichTextHtml() antes de mostrarse/imprimirse (ver lib/richText.ts).
// Los botones usan glifos de texto, igual que el resto del cotizador (sin
// dependencia de iconos).

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import { plainTextToHtml, isRichTextEmpty } from "@/lib/richText";

// Paleta de colores: tonos sobrios pero un poco PRENDIDOS (no neón), a pedido
// de MJ — los apagados se notaban poco. "Negro" = quitar color (texto normal).
const COLORS: { name: string; value: string | null }[] = [
  { name: "Negro (normal)", value: null },
  { name: "Gris", value: "#6b7280" },
  { name: "Teja", value: "#9C4A3C" },
  { name: "Tierra", value: "#c2703a" },
  { name: "Oliva", value: "#6f8c2f" },
  { name: "Petróleo", value: "#2f8f86" },
  { name: "Pizarra", value: "#3a6ea5" },
  { name: "Ciruela", value: "#8a4a96" },
  { name: "Mostaza", value: "#c79a1e" },
];

// Botón chico del menú flotante. Compacto (24px) y sin borde pesado, para que
// el menú se sienta liviano.
function MenuButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // no perder el foco/selección del editor
      onClick={onClick}
      className={`min-w-6 h-6 px-1 rounded text-xs leading-none flex items-center justify-center transition-colors ${
        active
          ? "bg-gray-800 text-white"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

// Contenido del menú flotante: formato + colores, en una sola fila compacta.
function FloatingMenu({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white shadow-sm px-1 py-0.5">
      <MenuButton title="Negrita" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-bold">B</span>
      </MenuButton>
      <MenuButton title="Cursiva" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic font-serif">I</span>
      </MenuButton>
      <MenuButton title="Subrayado" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </MenuButton>
      <span className="mx-0.5 w-px h-4 bg-gray-200" />
      <MenuButton title="Viñetas" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •
      </MenuButton>
      <MenuButton title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <span className="text-[10px]">1.</span>
      </MenuButton>
      <span className="mx-0.5 w-px h-4 bg-gray-200" />
      <div className="flex items-center gap-0.5" title="Color del texto">
        {COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              c.value
                ? editor.chain().focus().setColor(c.value).run()
                : editor.chain().focus().unsetColor().run()
            }
            className="w-4 h-4 rounded-full border border-gray-300 hover:scale-110 transition-transform"
            style={{ backgroundColor: c.value ?? "#111827" }}
          />
        ))}
      </div>
    </div>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    // Evita el render en SSR (Next 16) — previene mismatch de hidratación.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: plainTextToHtml(value),
    editorProps: {
      attributes: {
        // Estilos de la zona editable: lista con viñetas/números visibles
        // (Tailwind preflight las resetea, así que las forzamos acá) y el
        // placeholder gris cuando está vacío.
        class:
          "outline-none min-h-[64px] px-3 py-2 text-sm text-gray-800 leading-snug " +
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-0.5 " +
          "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] " +
          "[&_p.is-editor-empty:first-child]:before:text-gray-400 " +
          "[&_p.is-editor-empty:first-child]:before:float-left " +
          "[&_p.is-editor-empty:first-child]:before:h-0 " +
          "[&_p.is-editor-empty:first-child]:before:pointer-events-none",
      },
    },
    // Guarda AL TERMINAR (al salir del campo / blur), NO en cada tecla. Mismo
    // criterio que MoneyInput (PR #102): mientras MJ escribe, el texto vive
    // dentro del editor (Tiptap maneja su estado interno) y NO se dispara
    // `onChange`. Antes cada pulsación llamaba onChange → el padre (ObraEditor)
    // hacía setItems y re-renderizaba TODA la tabla de partidas en cada tecla,
    // por eso escribir una descripción larga se sentía lento y "letra por
    // letra". Al soltar el campo se confirma el HTML final, idéntico al que se
    // escribió: esto cambia CUÁNDO se guarda, no QUÉ se guarda. Los botones del
    // menú flotante usan preventDefault en mousedown → NO cuentan como blur, así
    // que dar negrita/color a una selección no corta la edición ni guarda antes.
    onBlur: ({ editor }) => {
      const html = editor.getHTML();
      onChange(isRichTextEmpty(html) ? "" : html);
    },
  });

  // Sincronizar cuando el valor cambia desde afuera (ej. al cambiar de partida).
  // No tocamos mientras el usuario escribe (editor enfocado) para no mover el cursor.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = plainTextToHtml(value);
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div className="rounded border border-gray-300 focus-within:border-gray-400 bg-white">
      {/* Menú flotante: aparece solo cuando hay texto seleccionado.
          - placement "top-start": se alinea al INICIO de la selección y crece
            hacia la derecha (antes quedaba centrado y, en la columna izquierda,
            su lado izquierdo —donde está la B— se metía DEBAJO del sidebar y
            no se veía: "se perdía la negrita").
          - shift padding.left 256 ≈ ancho del sidebar: red de seguridad para
            que nunca se posicione tapado por la barra lateral. */}
      {editor && (
        <BubbleMenu
          editor={editor}
          options={{
            placement: "top-start",
            offset: 6,
            shift: { padding: { left: 256, right: 8, top: 8, bottom: 8 } },
          }}
        >
          <FloatingMenu editor={editor} />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
