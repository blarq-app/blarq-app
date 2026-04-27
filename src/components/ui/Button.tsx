import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "warning";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-gray-900 text-white hover:bg-gray-700 disabled:bg-gray-400",
  secondary:
    "border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50",
  danger:
    "border border-red-300 text-red-700 bg-white hover:bg-red-50 hover:border-red-500 disabled:opacity-50",
  ghost: "text-gray-500 hover:text-gray-900",
  warning:
    "border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 disabled:opacity-50",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-5 py-2.5",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "sm", className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={`rounded transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    />
  );
});
