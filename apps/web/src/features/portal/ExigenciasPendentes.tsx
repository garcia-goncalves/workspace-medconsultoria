import { Hourglass, ArrowRight, CheckCircle2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { usePortalNavegar } from "./navegar";

/**
 * "O QUE AINDA FALTA ENVIAR" — a fila plana, no meio da seção Documentos.
 *
 * A mesma informação existe dentro do card de cada serviço, em *Meus serviços*, e as duas
 * apresentações são de propósito: lá é o **checklist daquele serviço** (contexto: por que
 * pedimos, com o botão de envio ao lado); aqui é a **fila** — tudo o que a MedConsultoria está
 * esperando, num lugar só, sem o cliente precisar abrir serviço por serviço para descobrir.
 *
 * ⚠️ **Não reimplementa régua nenhuma:** lê a mesma `portal.meusServicos` e o mesmo campo
 * `atendido`. É outra vista do mesmo dado, não outra conta — duas contas divergiriam, e o
 * cliente veria "faltam 3" numa tela e "faltam 2" na outra.
 *
 * ⚠️ **Fica no MEIO da seção, entre os dois acervos, e isso não é estética.** É o único bloco
 * ACIONÁVEL dos três: enterrá-lo no fim é o que faz o cliente rolar a lista do que já enviou,
 * ver tudo em ordem e concluir que entregou tudo.
 */
export function ExigenciasPendentes() {
  const q = trpc.portal.meusServicos.useQuery();
  const navegar = usePortalNavegar();

  if (q.isLoading) {
    return (
      <Card>
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-full" />
        </div>
      </Card>
    );
  }

  /*
   * Só o que é OBRIGATÓRIO, e isso importa: é exatamente o que o campo `pendentes` do
   * servidor conta, e é o número que a pílula da barra mostra. Listar aqui também o
   * "se houver" faria a barra dizer 2 e a fila mostrar 3 — e quem lê os dois conclui, com
   * razão, que um dos dois está errado. O opcional continua visível no card do serviço.
   */
  const pendentes = (q.data ?? []).flatMap((s) =>
    s.requisitos
      .filter((r) => !r.atendido && r.obrigatorio)
      .map((r) => ({ chave: `${s.servico.id}-${r.id}`, titulo: r.titulo, servico: s.servico.nome })),
  );

  // Sem nada pendente, o bloco vira uma linha de boa notícia em vez de sumir: aqui, ao
  // contrário do Início, o silêncio seria ambíguo — o cliente não saberia se não falta nada
  // ou se a tela não carregou.
  if (pendentes.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <span className="text-muted-foreground">
            Você já enviou tudo o que pedimos. <span className="font-medium text-foreground">Nada pendente.</span>
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            <Hourglass className="h-4 w-4 text-warning" /> O que ainda falta enviar
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {pendentes.length === 1 ? "1 documento pendente" : `${pendentes.length} documentos pendentes`}
          </span>
        </div>
      </CardHeader>
      <div className="divide-y">
        {pendentes.map((p) => (
          <div key={p.chave} className="flex items-start gap-3 px-4 py-3 text-sm sm:px-5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
              <Hourglass className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.titulo}</div>
              <div className="truncate text-xs text-muted-foreground">{p.servico}</div>
            </div>
          </div>
        ))}
      </div>
      {/* O envio acontece no card do serviço, com o contexto do pedido junto. Duplicar o botão
          aqui significaria duplicar o formulário e a régua de qual vaga recebe o arquivo. */}
      <div className="px-4 pb-4 pt-1 sm:px-5">
        <button
          type="button"
          onClick={() => navegar("/portal/servicos")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Enviar em Meus serviços <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  );
}
