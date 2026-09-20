import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "../../components/ui/button";

/** Peças usadas pelas duas produções da Conciliação — consultas e cirurgias. */

/**
 * Os status da conciliação de uma cirurgia (calculados no servidor — `conciliacao-cirurgica.ts`).
 * A ordem é a do filtro: primeiro o que pede ação.
 */
export const STATUS_CONCILIACAO = {
  GLOSA_PARCIAL: { rotulo: "Glosa parcial", cor: "text-destructive" },
  GLOSA_TOTAL: { rotulo: "Glosa total", cor: "text-destructive" },
  A_RECEBER: { rotulo: "A receber", cor: "text-warning" },
  SEM_VALOR: { rotulo: "Sem valor de referência", cor: "text-warning" },
  SEM_ATENDIMENTO: { rotulo: "Sem atendimento", cor: "text-warning" },
  RECEBIDO_SEM_VALOR: { rotulo: "Recebido sem referência", cor: "text-warning" },
  PAGO_A_MAIS: { rotulo: "Pago a mais", cor: "text-primary" },
  PAGO: { rotulo: "Pago", cor: "text-success" },
  NAO_COBRAR: { rotulo: "Não cobrar", cor: "text-muted-foreground" },
  NAO_REALIZADA: { rotulo: "Não realizada", cor: "text-muted-foreground" },
} as const;
export type StatusConciliacao = keyof typeof STATUS_CONCILIACAO;

/** Baixa um texto como arquivo. O CSV já vem com BOM do servidor, para o Excel ler acento. */
export function baixarTexto(conteudo: string, nome: string, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
        {/* ⚠️ A chave NÃO pode ser só o rótulo. O servidor agrupa por id da operadora/profissional
            OU pelo texto bruto normalizado de quem ainda não foi ligado, então dois grupos
            distintos podem exibir o mesmo rótulo — "João Silva" já ligado ao lado do texto cru
            "JOAO SILVA" a ligar. Com chave repetida o React reaproveita a linha errada e a marca
            "(a ligar)" troca de lugar, além de sujar o console (e "zero erro de console" é o
            padrão de prova desta casa). */}
        {itens.map((i, ordem) => (
          <li key={`${ordem}:${i.rotulo}`} className="flex justify-between gap-2">
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
