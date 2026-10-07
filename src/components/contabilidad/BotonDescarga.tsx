// Botón de descarga de los documentos para el contador (Cartola, Rendiciones).
// Es un link común: el endpoint responde con el archivo como adjunto.
export default function BotonDescarga({
  href,
  texto,
  deshabilitado,
}: {
  href: string;
  texto: string;
  deshabilitado: boolean;
}) {
  if (deshabilitado) {
    return (
      <span className="px-3 py-2 text-sm border border-gray-200 rounded text-gray-300 whitespace-nowrap">
        {texto}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 whitespace-nowrap"
    >
      {texto}
    </a>
  );
}
