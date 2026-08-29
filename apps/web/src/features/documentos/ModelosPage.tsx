import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Plus,
  FileText,
  ArrowLeft,
  ChevronRight,
  FileSignature,
  HeartHandshake,
  ClipboardList,
  Pencil,
  Trash2,
} from "lucide-react";
import { TIPO_MODELO_LABEL, DOC_INTERACAO, type TipoModelo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { TableSkeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { ModeloFormDialog } from "./ModeloFormDialog";
import { CamposDialog, FormularioDialog, type FormRow } from "./FormulariosPanel";

/** Modelos agrupados por FINALIDADE. "O cliente envia" reúne os BRIEFINGS interativos + o checklist. */
const GRUPOS: { titulo: string; desc: string; tipos: TipoModelo[]; briefings?: boolean }[] = [
  { titulo: "Vender", desc: "O que você manda para conquistar o cliente.", tipos: ["PROPOSTA"] },
  { titulo: "Fechar", desc: "O que formaliza o acordo.", tipos: ["CONTRATO", "ESCOPO"] },
  {
    titulo: "O cliente envia",
    desc: "Os briefings que o cliente responde na tela e o que ele precisa nos mandar.",
    tipos: ["CHECKLIST"],
    briefings: true,
  },
  { titulo: "Reunião", desc: "Antes e depois das reuniões.", tipos: ["PAUTA_REUNIAO", "ATA"] },
  {
    titulo: "Entregar & relatar",
    desc: "O que você entrega e apresenta ao cliente.",
    tipos: ["RELATORIO", "PAUTA_POSTAGEM", "DIAGNOSTICO", "PLANO_ACAO"],
  },
  { titulo: "Operacional", desc: "Uso interno e comprovantes.", tipos: ["ONBOARDING", "RECIBO"] },
];

/** O que o modelo de documento faz na prática (a partir da matriz de interação). */
function papel(tipo: TipoModelo): { texto: string; icon: typeof FileSignature; cor: string } {
  const i = DOC_INTERACAO[tipo];
  if (i === "assinatura") return { texto: "Cliente assina", icon: FileSignature, cor: "text-brand-blueText" };
  if (i === "aceite") return { texto: "Cliente aceita", icon: HeartHandshake, cor: "text-primary" };
  return { texto: "Leitura / entrega", icon: FileText, cor: "text-muted-foreground" };
}

/**
 * Modelos de documento (configuração) — os moldes reutilizáveis, por finalidade. Os documentos
 * de texto abrem numa página de edição (com preview A4). Os **briefings** são formulários
 * INTERATIVOS que o cliente responde na tela (campos de texto, escolha, múltipla…) — editados
 * aqui mesmo. Os documentos de cada cliente são gerados na ficha dele.
 */
export function ModelosPage() {
  const [novoModelo, setNovoModelo] = useState(false);
  const [novoBriefing, setNovoBriefing] = useState(false);
  const [editBriefing, setEditBriefing] = useState<FormRow | null>(null);
  const [camposBriefing, setCamposBriefing] = useState<FormRow | null>(null);

  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const modelos = trpc.documentos.modelos.list.useQuery();
  const briefings = trpc.formularios.list.useQuery();
  const removerBriefing = trpc.formularios.remover.useMutation({
    onSuccess: () => utils.formularios.list.invalidate(),
  });

  const porGrupo = (tipos: TipoModelo[]) => (modelos.data ?? []).filter((m) => tipos.includes(m.tipo));

  return (
    <div className="flex h-full flex-col gap-4">
      <Link to="/ajustes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Ajustes
      </Link>
      <PageHeader
        title="Modelos de documento"
        subtitle="Os moldes reutilizáveis, por finalidade. Clique para ver e editar. Os briefings são preenchidos pelo cliente na tela; os documentos de cada cliente você gera na ficha dele."
      >
        <Button onClick={() => setNovoModelo(true)}>
          <Plus className="h-4 w-4" />
          Novo modelo
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
        {modelos.isError || briefings.isError ? (
          <QueryError onRetry={() => (modelos.isError ? modelos.refetch() : briefings.refetch())} />
        ) : modelos.isLoading ? (
          <TableSkeleton rows={6} cols={2} />
        ) : (
          GRUPOS.map((g) => {
            const itens = porGrupo(g.tipos);
            const listaBriefings = g.briefings ? briefings.data ?? [] : [];
            if (itens.length === 0 && listaBriefings.length === 0 && !g.briefings) return null;
            return (
              <section key={g.titulo}>
                <div className="mb-2.5 flex items-end justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.titulo}</h2>
                    <p className="text-xs text-muted-foreground">{g.desc}</p>
                  </div>
                  {g.briefings && (
                    <Button size="sm" variant="outline" onClick={() => setNovoBriefing(true)}>
                      <Plus className="h-4 w-4" />
                      Novo briefing
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Briefings INTERATIVOS (o cliente preenche na tela) */}
                  {listaBriefings.map((f) => (
                    <div
                      key={f.id}
                      className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                    >
                      <button
                        onClick={() => setCamposBriefing(f)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        title="Editar as perguntas"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-blueLight/10 text-brand-blueLight ring-1 ring-inset ring-brand-blueLight/20">
                          <ClipboardList className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{f.titulo}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                            <span>Briefing</span>
                            <span className="text-brand-blueLight">
                              · {f._count.campos} pergunta{f._count.campos === 1 ? "" : "s"} · cliente preenche
                            </span>
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          onClick={() => setEditBriefing(f)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Renomear / descrição"
                          title="Renomear / descrição"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Remover briefing",
                                description: `"${f.titulo}" será removido.`,
                                confirmText: "Remover",
                                variant: "destructive",
                              })
                            )
                              removerBriefing.mutate({ id: f.id });
                          }}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remover briefing"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Modelos de documento (texto → geram documento) */}
                  {itens.map((m) => {
                    const p = papel(m.tipo);
                    return (
                      <Link
                        key={m.id}
                        to="/modelos/$modeloId"
                        params={{ modeloId: m.id }}
                        className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
                          <FileText className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-semibold">
                            <span className="truncate">{m.nome}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{TIPO_MODELO_LABEL[m.tipo]}</span>
                            <span className={`inline-flex items-center gap-1 ${p.cor}`}>
                              · <p.icon className="h-3 w-3" /> {p.texto}
                            </span>
                            {m.editadoManualmente && <span>· editado</span>}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>

      <ModeloFormDialog open={novoModelo} onClose={() => setNovoModelo(false)} />
      <FormularioDialog open={novoBriefing} onClose={() => setNovoBriefing(false)} />
      <FormularioDialog open={!!editBriefing} onClose={() => setEditBriefing(null)} form={editBriefing ?? undefined} />
      <CamposDialog form={camposBriefing} onClose={() => setCamposBriefing(null)} />
    </div>
  );
}
