import { InputHTMLAttributes, forwardRef } from "react";

type Size = "sm" | "md";

const sizeClasses: Record<Size, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  inputSize?: Size;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { inputSize = "md", className = "", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={`border border-gray-300 rounded bg-white text-gray-900 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none disabled:bg-gray-50 disabled:text-gray-500 ${sizeClasses[inputSize]} ${className}`}
    />
  );
});
