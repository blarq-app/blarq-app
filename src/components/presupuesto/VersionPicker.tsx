"use client";

import { useRouter } from "next/navigation";

// 2 selectores para elegir qué pares de versiones comparar. Al cambiar
// cualquiera, navega a /proyectos/[id]/presupuesto/comparar?a=X&b=Y.

export default function VersionPicker({
  projectId,
  versions,
  aId,
  bId,
}: {
  projectId: string;
  versions: { id: string; version: string }[];
  aId: string;
  bId: string;
}) {
  const router = useRouter();

  function go(a: string, b: string) {
    const params = new URLSearchParams({ a, b });
    router.push(`/proyectos/${projectId}/presupuesto/comparar?${params}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">Comparar</span>
      <select
        value={aId}
        onChange={(e) => go(e.target.value, bId)}
        className="px-2 py-1 border border-gray-300 rounded bg-white"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>{v.version}</option>
        ))}
      </select>
      <span className="text-gray-400">vs</span>
      <select
        value={bId}
        onChange={(e) => go(aId, e.target.value)}
        className="px-2 py-1 border border-gray-300 rounded bg-white"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>{v.version}</option>
        ))}
      </select>
    </div>
  );
}
