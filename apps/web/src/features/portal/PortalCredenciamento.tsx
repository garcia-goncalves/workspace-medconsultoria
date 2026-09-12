import { Check, Circle, Stethoscope, Trash2 } from "lucide-react";
import { LADO_ARQUIVO_LABEL } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { UploadArquivo, ArquivoLink } from "../../components/ui/upload-arquivo";
import { recarregarAposEnvio } from "../../lib/recarregar-apos-envio";
import { usePodeNoPortal } from "./permissoes";

type Vaga = {
  lado: "FRENTE" | "VERSO" | null;
  profissionalId: string | null;
  arquivo: { id: string; nome: string } | null;
};
type Requisito = {
  id: string;
  titulo: string;
  descricao: string | null;
  obrigatorio: boolean;
  frenteVerso: boolean;
  vagas: Vaga[];
};

/**
 * "Documentos do credenciamento" no Portal do Cliente.
 *
 * A diferença que justifica uma tela própria: a papelada do credenciamento **repete por
 * médico**. Numa lista corrida, uma clínica com dois profissionais entrega o diploma de um
 * e a lista parece completa. Aqui cada médico tem o próprio bloco, e documento de "frente e
 * verso" tem duas vagas separadas — o que falta fica visível item a item.
 *
 * O cliente vê só o que ele resolve entregando alguma coisa. Recusa comercial não chega
 * aqui: a triagem é ferramenta da equipe, e mora na ficha.
 */
export function PortalCredenciamento() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  // Achado da auditoria de 04/09/2026: os botões de Enviar/Remover eram os únicos do Portal que
  // nunca consultavam a trava de papel — em sessão de suporte (ADR-128), o servidor recusa (403,
  // já provado antes desta correção), mas a pessoa só descobria DEPOIS de escolher o arquivo e
  // esperar o upload. Reaproveita "removerArquivo" (já liberada para EQUIPE) para as duas ações:
  // enviar e remover documento do credenciamento são a mesma capacidade de gestão de arquivo.
  const podeAgir = usePodeNoPortal()("removerArquivo");
  const q = trpc.portal.credenciamento.useQuery();
  const invalidate = () => {
    // `q` é a papelada do credenciamento que ESTA tela desenha: recarregamento duplo, não
    // `invalidate`. Ver `recarregarAposEnvio`.
    recarregarAposEnvio(q);
    utils.portal.meusServicos.invalidate();
    utils.portal.arquivos.invalidate();
  };
  const removerArquivo = trpc.portal.removerArquivo.useMutation({ onSuccess: invalidate });

  // O servidor devolve `null` para quem não tem credenciamento em curso — nesse caso a
  // seção nem existe no Portal.
  const dados = q.data;
  if (!dados) return null;

  const onRemover = async (id: string, nome: string) => {
    const ok = await confirm({
      title: "Remover documento?",
      description: `"${nome}" será removido.`,
      confirmText: "Remover",
      variant: "destructive",
    });
    if (ok) removerArquivo.mutate({ id });
  };

  const linhaDaVaga = (r: Requisito, v: Vaga, i: number) => (
    // `flex-wrap` a 360px: sem ele, a etiqueta do lado mais o nome do arquivo mais o botão
    // estouram a largura e a linha rola para fora da tela.
    <div key={`${r.id}-${v.profissionalId ?? ""}-${v.lado ?? i}`} className="flex flex-wrap items-center gap-2 py-1">
      {v.arquivo ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      )}
      {/* Frente e verso são DUAS vagas separadas, cada uma com o próprio botão — a etiqueta
          precisa ficar colada na vaga a que pertence, senão o cliente manda o mesmo lado duas
          vezes e a barra de progresso não anda. */}
      {v.lado && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {LADO_ARQUIVO_LABEL[v.lado]}
        </span>
      )}
      {v.arquivo ? (
        <>
          <ArquivoLink id={v.arquivo.id} nome={v.arquivo.nome} className="flex min-h-11 max-w-[200px] items-center" />
          {podeAgir.pode ? (
            <button
              onClick={() => v.arquivo && onRemover(v.arquivo.id, v.arquivo.nome)}
              aria-label={`Remover ${v.arquivo.nome}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{podeAgir.frase}</span>
          )}
        </>
      ) : podeAgir.pode ? (
        <div className="[&_button]:min-h-11">
          <UploadArquivo
            size="xs"
            label="Enviar"
            campos={{
              requisitoId: r.id,
              ...(v.profissionalId ? { profissionalId: v.profissionalId } : {}),
              ...(v.lado ? { lado: v.lado } : {}),
            }}
            onDone={invalidate}
          />
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{podeAgir.frase}</span>
      )}
    </div>
  );

  const blocoRequisito = (r: Requisito) => (
    <div key={`${r.id}-${r.vagas[0]?.profissionalId ?? ""}`} className="rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{r.titulo}</span>
        {!r.obrigatorio && (
          <span className="rounded bg-muted px-1 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
            Se houver
          </span>
        )}
      </div>
      {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
      <div className="mt-1">{r.vagas.map((v, i) => linhaDaVaga(r, v, i))}</div>
    </div>
  );

  const { atendidas, total, faltam, percentual } = dados.progresso;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Stethoscope className="h-4 w-4 text-muted-foreground" /> Documentos do credenciamento
        </CardTitle>
      </CardHeader>
      <div className="space-y-3 p-5 pt-0">
        {/* A barra conta PARES (documento × médico): dois médicos com metade da papelada
            mostram 50%, e não 100%. */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {faltam === 0 ? "Tudo enviado" : `Faltam ${faltam} de ${total}`}
            </span>
            <span className="text-muted-foreground">
              {atendidas}/{total}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${faltam === 0 ? "bg-success" : "bg-primary"}`}
              style={{ width: `${percentual}%` }}
            />
          </div>
        </div>

        {dados.pendencias.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">Precisamos disto para seguir</p>
            <ul className="mt-1 space-y-0.5">
              {dados.pendencias.map((p) => (
                <li key={p.regra} className="text-sm text-foreground">
                  {p.pedido}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dados.grupos.map((g) => (
          <div key={g.escopo}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.titulo}</p>
            <div className="mt-1.5 space-y-2">{g.requisitos.map(blocoRequisito)}</div>
          </div>
        ))}

        {dados.porProfissional.map(({ profissional, requisitos }) => (
          <div key={profissional.id} className="rounded-lg border p-3">
            <p className="text-sm font-semibold text-foreground">
              {profissional.nome}
              {profissional.especialidade && (
                <span className="font-normal text-muted-foreground"> · {profissional.especialidade}</span>
              )}
            </p>
            <div className="mt-2 space-y-2">{requisitos.map(blocoRequisito)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
