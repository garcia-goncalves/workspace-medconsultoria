import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "../../components/ui/button";

/** Peças usadas pelas duas produções da Conciliação — consultas e cirurgias. */

export function Paginacao({
  pagina,
  porPagina,
  total,
  onPagina,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  onPagina: (p: number) => void;
}) {
  const paginas = Math.ceil(total / porPagina);
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t p-3 text-sm">
      <span className="text-muted-foreground">
        {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}>
          Anterior
        </Button>
        <Button variant="ghost" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

export function ListaResumo({ titulo, itens }: { titulo: string; itens: { rotulo: string; atendimentos: number; pendente: boolean }[] }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{titulo}</p>
      <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-sm">
        {itens.map((i) => (
          <li key={i.rotulo} className="flex justify-between gap-2">
            <span className={i.pendente ? "text-warning" : ""}>
              {i.rotulo}
              {i.pendente && <span className="text-xs"> (a ligar)</span>}
            </span>
            <strong>{i.atendimentos}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Aviso({ tom, children }: { tom: "atencao" | "erro"; children: ReactNode }) {
  const cor = tom === "erro" ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5";
  // Aviso de atenção NÃO leva ✓: um check se lê como "tudo certo" justamente onde há algo a olhar.
  const Icone = tom === "erro" ? AlertTriangle : Info;
  const corIcone = tom === "erro" ? "text-destructive" : "text-warning";
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cor}`}>
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${corIcone}`} />
      <div>{children}</div>
    </div>
  );
}
