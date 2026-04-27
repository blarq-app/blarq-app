import { HTMLAttributes } from "react";

type Tone = "neutral" | "success" | "warning" | "error" | "info" | "dark";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  dark: "bg-gray-900 text-white",
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

export function Badge({ tone = "neutral", className = "", ...rest }: Props) {
  return (
    <span
      {...rest}
      className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${toneClasses[tone]} ${className}`}
    />
  );
}
