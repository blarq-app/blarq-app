import { HTMLAttributes } from "react";

type Variant = "default" | "muted" | "subtle";

const variantClasses: Record<Variant, string> = {
  default: "bg-white border border-gray-200 rounded-xl",
  muted: "bg-gray-50 border border-gray-200 rounded",
  subtle: "bg-white rounded",
};

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingClasses = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  variant = "default",
  padding = "md",
  className = "",
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={`${variantClasses[variant]} ${paddingClasses[padding]} ${className}`}
    />
  );
}
