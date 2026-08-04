/**
 * Set de íconos monocromáticos (SVG inline) para navegación y Configuración.
 *
 * Por qué inline y no una librería: el repo NO tiene `lucide-react` instalado
 * (se comprobó: no está en package.json), y el patrón que ya existía en
 * `MovementResolveMenu.tsx` es exactamente este — un switch de paths dibujados
 * a mano con el mismo grosor de trazo. Se centraliza acá para que el sidebar y
 * el hub de Configuración compartan el mismo set en vez de duplicarlo.
 *
 * Los trazos son de 1.5-1.7 y heredan `currentColor`: el color lo pone quien
 * lo usa, nunca el ícono. Ningún glifo lleva relleno — la guía de marca pide
 * iconografía monocromática, y los emojis que había en el sidebar
 * (📊 🏗️ 💵 …) están prohibidos por docs/principles.md.
 */

type Props = {
  name: string;
  className?: string;
  /** Tamaño en px. 18 anda bien para el sidebar, 20 para el hub. */
  size?: number;
};

export function Glyph({ name, className = "", size = 18 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `shrink-0 ${className}`,
    "aria-hidden": true,
  };

  switch (name) {
    // ── Navegación principal ────────────────────────────────────────────
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case "cotizaciones":
      return (
        <svg {...common}>
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case "proyectos":
      return (
        <svg {...common}>
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M10 21v-6h4v6" />
          <path d="M9 11h.01M15 11h.01" />
        </svg>
      );
    case "facturas":
      return (
        <svg {...common}>
          <path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" />
          <path d="M9 9h6M9 13h6" />
        </svg>
      );
    case "banco":
      return (
        <svg {...common}>
          <path d="M3 10h18L12 4 3 10z" />
          <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
          <path d="M3 20h18" />
        </svg>
      );
    case "contabilidad":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 7h6" />
          <path d="M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01" />
        </svg>
      );

    // ── Catálogo ────────────────────────────────────────────────────────
    case "partidas":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
        </svg>
      );
    case "materiales":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <rect x="3" y="9" width="18" height="5" rx="1" />
          <rect x="3" y="14" width="18" height="5" rx="1" />
          <path d="M9 4v5M15 9v5M9 14v5" />
        </svg>
      );
    // Tina con grifería: se lee como "artefactos de baño" a 18px. El dibujo
    // anterior (línea + gancho) a ese tamaño parecía un signo raro.
    case "artefactos":
      return (
        <svg {...common}>
          <path d="M3 13h18v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-2z" />
          <path d="M7 13V6a2 2 0 0 1 4 0v1" />
          <path d="M6 19l-1 2M18 19l1 2" />
        </svg>
      );
    // Tuerca hexagonal. Se probaron antes un círculo con rayos (a 18px se leía
    // como un SOL) y un perno de cabeza hexagonal con vástago (se leía como una
    // ampolleta). El hexágono con el agujero al centro es inconfundible.
    case "herrajes":
      return (
        <svg {...common}>
          <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>
      );

    // ── Configuración ───────────────────────────────────────────────────
    case "configuracion":
      return (
        <svg {...common}>
          <path d="M4 6h10M18 6h2" />
          <path d="M4 12h4M12 12h8" />
          <path d="M4 18h10M18 18h2" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="16" cy="18" r="2" />
        </svg>
      );
    case "cuenta":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 12 0v1" />
        </svg>
      );
    case "reembolsadores":
      return (
        <svg {...common}>
          <path d="M4 9h13l-3-3" />
          <path d="M20 15H7l3 3" />
        </svg>
      );
    case "auditoria":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
          <path d="M11 8.5v5M9.5 10h3M9.5 12.5h3" />
        </svg>
      );
    case "reglas":
      return (
        <svg {...common}>
          <path d="M20.6 12.4 12.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.6-1.4V4.4a1.4 1.4 0 0 1 1.4-1.4h8.6a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.4z" />
          <path d="M7.5 7.5h.01" />
        </svg>
      );

    // ── Utilitarios ─────────────────────────────────────────────────────
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...common}>
          <path d="m15 6-6 6 6 6" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 18 18 6M6 6l12 12" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

export default Glyph;
