import * as React from "react";
import { cn } from "@app/ui";
import { HintIcon } from "./tooltip";

/**
 * Rótulo de campo. Passe `hint` para exibir um "?" ao lado do texto — o usuário passa o mouse
 * (ou toca, no celular) e lê a explicação do campo. Use para que quem é leigo entenda cada input.
 */
export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: React.ReactNode }
>(({ className, hint, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium leading-none", hint && "inline-flex items-center gap-1", className)}
    {...props}
  >
    {children}
    {hint && <HintIcon text={hint} />}
  </label>
));
Label.displayName = "Label";
