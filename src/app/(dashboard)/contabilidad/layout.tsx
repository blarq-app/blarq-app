import ContabilidadTabs from "./ContabilidadTabs";

// Layout del módulo de contabilidad: una barra de pestañas para moverse entre
// el F29 y Remuneraciones (y lo que venga). El sidebar muestra un solo ítem
// "Contabilidad"; la navegación fina vive acá.
export default function ContabilidadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <ContabilidadTabs />
      {children}
    </div>
  );
}
