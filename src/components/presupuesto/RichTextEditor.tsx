"use client";

// Editor de texto con formato para las descripciones del cotizador (cliente y
// maestro). Basado en Tiptap. Soporta: negrita, cursiva, viñetas, lista
// numerada y color (paleta acotada de tonos apagados, para no romper el tono
// editorial blanco/negro/gris de BLARQ).
//
// Guarda HTML (controlado: value/onChange). El HTML se limpia con
// sanitizeRichTextHtml() antes de mostrarse/imprimirse (ver lib/richText.ts).
// Los botones usan glifos de texto, igual que el resto del cotizador (sin
// dependencia de iconos).

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import { plainTextToHtml, isRichTextEmpty } from "@/lib/richText";

// Paleta de colores APAGADOS (desaturados), pedida por MJ. "Negro" = quitar
// color (vuelve al texto normal). Burdeo + variedad de tonos sobrios.
const COLORS: { name: string; value: string | null }[] = [
  { name: "Negro (normal)", value: null },
  { name: "Gris", value: "#6b7280" },
  { name: "Burdeo", value: "#7c2d2d" },
  { name: "Tierra", value: "#6b4f3a" },
  { name: "Oliva", value: "#4d5e3a" },
  { name: "Petróleo", value: "#3a5d5a" },
  { name: "Pizarra", value: "#3b4e63" },
  { name: "Ciruela", value: "#5d4660" },
  { name: "Mostaza", value: "#8a6d1f" },
];

function ToolbarButton({
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
      className={`min-w-7 h-7 px-1.5 rounded text-sm leading-none flex items-center justify-center border border-gray-200 transition-colors ${
        active ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-1.5 py-1 bg-gray-50/60 rounded-t">
      <ToolbarButton title="Negrita" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton title="Cursiva" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic font-serif">I</span>
      </ToolbarButton>
      <span className="mx-0.5 w-px h-5 bg-gray-200" />
      <ToolbarButton title="Viñetas" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •
      </ToolbarButton>
      <ToolbarButton title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <span className="text-[11px]">1.</span>
      </ToolbarButton>
      <span className="mx-0.5 w-px h-5 bg-gray-200" />
      <div className="flex items-center gap-1" title="Color del texto">
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
            className="w-5 h-5 rounded-full border border-gray-300"
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
    onUpdate: ({ editor }) => {
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
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
