import * as React from "react";
import { cn } from "@app/ui";
import { HintIcon } from "./tooltip";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card shadow-sm", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-2 border-b px-4 py-3", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  hint,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  /** "?" de ajuda ao lado do título — mesmo padrão do `hint` de `<Label>`. */
  hint?: React.ReactNode;
}) {
  return (
    <h2 className={cn("flex items-center gap-2 text-sm font-semibold", className)} {...props}>
      {children}
      {hint && <HintIcon text={hint} />}
    </h2>
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
