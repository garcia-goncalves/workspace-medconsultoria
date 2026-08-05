import { AlertCircle, AlertTriangle, CheckCircle2, EyeOff, Loader2, Mail, Paperclip, Send } from "lucide-react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { useAuth } from "../../../lib/auth-context";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { QueryError } from "../../../components/ui/query-error";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { dataHora } from "../../../lib/format-date";

/**
 * A conversa com o cliente (ou com o lead) dentro da ficha — ADR-97.
 *
 * Duas fontes, um card: o log dos e-mails automáticos (`EmailEnviado`) e o que a equipe trocou
 * pela própria caixa. **Nunca corpo** — metadado e trecho. O corpo continua só para o dono da
 * caixa, em `/email`, e é ele quem tem o botão de tirar a mensagem daqui.
 */

type Conversa = RouterOutputs["email"]["conversaDoCliente"];
type ItemDaConversa = Conversa["itens"][number];

/**
 * Nem `useQuery` nem `refetch` viajam para a lista: ela recebe só o que precisa desenhar. Assim a
 * mesma lista serve cliente e lead, que chamam procedures diferentes.
 */
interface EstadoDaConsulta {
  data: Conversa | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

function Selo({ children, title, tom }: { children: React.ReactNode; title?: string; tom: "sistema" | "caixa" }) {
  return (
    <span
      title={title}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
        (tom === "caixa" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
      }
    >
      {tom === "caixa" ? <Mail className="h-3 w-3" /> : <Send className="h-3 w-3" />}
      {children}
    </span>
  );
}

function Linha({
  item,
  onTirarDaFicha,
  tirando,
}: {
  item: ItemDaConversa;
  onTirarDaFicha: (item: ItemDaConversa) => void;
  tirando: boolean;
}) {
  const { user } = useAuth();

  if (item.origem === "automatico") {
    return (
      <div className="rounded-lg border p-2.5">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.assunto}</div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              <span>{item.templateLabel}</span>
              <span>·</span>
              <span className="tabular-nums">{dataHora(item.dataEm)}</span>
              <span>·</span>
              <span className="truncate">para {item.para}</span>
            </div>
          </div>
          <Selo tom="sistema">Enviado pelo sistema</Selo>
          {item.status === "FALHOU" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              <AlertCircle className="h-3 w-3" /> falhou
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
              <CheckCircle2 className="h-3 w-3" /> enviado
            </span>
          )}
        </div>
        {/* Motivo da falha sempre visível: e-mail que não chegou é o que a equipe precisa ver. */}
        {item.status === "FALHOU" && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] leading-snug text-destructive">
            <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">
              <span className="font-semibold">Por que falhou:</span>{" "}
              {item.erro || "Motivo não registrado (falha anterior ao registro do detalhe)."}
            </span>
          </div>
        )}
      </div>
    );
  }

  const souODono = item.caixa.donoId === user.id;

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.assunto || "(sem assunto)"}</span>
            {/* O clipe é o ÚNICO sinal de que veio anexo — sem o texto oculto, quem usa leitor de
                tela não fica sabendo. */}
            {item.temAnexo && (
              <>
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Tem anexo</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">de {item.deNome ? `${item.deNome} <${item.deEmail}>` : item.deEmail}</span>
            {item.para.length > 0 && (
              <>
                <span>·</span>
                <span className="truncate">para {item.para.join(", ")}</span>
              </>
            )}
            <span>·</span>
            <span className="tabular-nums">{dataHora(item.dataEm)}</span>
          </div>
        </div>
        <Selo tom="caixa" title={item.caixa.email}>
          Caixa de {item.caixa.donoNome}
        </Selo>
      </div>

      {/* Trecho, nunca corpo. Quem quiser ler inteiro precisa ser o dono e abrir a própria caixa. */}
      {item.trecho && <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{item.trecho}</p>}

      {souODono && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/*
           * Âncora comum, não `Link` do router: a navegação carrega `/email` já com a mensagem
           * escolhida (`?mensagem=`), e o card fica montável em teste sem contexto de rota.
           */}
          <a href={`/email?mensagem=${item.id}`} className="text-[11px] font-medium text-primary hover:underline">
            Abrir na minha caixa
          </a>
          <button
            type="button"
            onClick={() => onTirarDaFicha(item)}
            disabled={tirando}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
            title="Some da ficha para toda a equipe. Só você, dono da caixa, vê este botão — e só de dentro da sua caixa dá para devolver."
          >
            <EyeOff className="h-3 w-3" /> Tirar da ficha
          </button>
        </div>
      )}
    </div>
  );
}

function Conversa({ q, vazio }: { q: EstadoDaConsulta; vazio: string }) {
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const marcar = trpc.email.marcarParticular.useMutation({
    onSuccess: () => {
      utils.email.conversaDoCliente.invalidate();
      utils.email.conversaDoLead.invalidate();
      // A mesma mensagem aberta em `/email` mostra o botão inverso ("Devolver à ficha").
      utils.email.abrir.invalidate();
    },
  });

  const tirarDaFicha = async (item: ItemDaConversa) => {
    if (item.origem !== "caixa") return;
    const ok = await confirm({
      title: "Tirar este e-mail da ficha?",
      description:
        `"${item.assunto || "(sem assunto)"}" deixa de aparecer aqui para toda a equipe, na hora. ` +
        "Ele continua na sua caixa, e é de lá que dá para devolvê-lo à ficha.",
      confirmText: "Tirar da ficha",
      icon: EyeOff,
    });
    if (ok) marcar.mutate({ mensagemId: item.id, particular: true });
  };

  // Erro tem de ser VISÍVEL: este card depende de rede IMAP indireta, e um card silenciosamente
  // vazio faz a equipe concluir que não houve conversa nenhuma com o cliente.
  if (q.isError) {
    return <QueryError onRetry={() => q.refetch()} message="Não foi possível carregar os e-mails deste cadastro." />;
  }
  if (q.isLoading) {
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando os e-mails…
      </p>
    );
  }

  const itens = q.data?.itens ?? [];

  return (
    <div className="space-y-1.5">
      {/* A caixa pode falhar sem derrubar o log automático — mas então a lista está incompleta. */}
      {q.data?.caixaIndisponivel && (
        <div className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-warning">
          <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
          <span>Não deu para ler as caixas de e-mail agora — a lista mostra só os envios automáticos.</span>
        </div>
      )}
      {itens.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        itens.map((item) => (
          <Linha
            key={`${item.origem}:${item.id}`}
            item={item}
            onTirarDaFicha={tirarDaFicha}
            tirando={marcar.isPending}
          />
        ))
      )}
    </div>
  );
}

/** O card da ficha do cliente. */
export function EmailsDoClienteCard({ clienteId }: { clienteId: string }) {
  const q = trpc.email.conversaDoCliente.useQuery({ clienteId }, { enabled: !!clienteId });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" /> E-mails
        </CardTitle>
        <span className="text-xs text-muted-foreground">Automáticos e das caixas da equipe</span>
      </CardHeader>
      <CardContent className="space-y-2">
        <Conversa q={q} vazio="Nenhum e-mail trocado com este cliente ainda." />
      </CardContent>
    </Card>
  );
}

/**
 * A mesma lista no painel do lead, que já tem moldura de seção própria (por isso sem `Card`).
 * Mora aqui, e não numa pasta de leads, porque é o mesmo card com outra fonte.
 */
export function EmailsDoLeadLista({ leadId }: { leadId: string }) {
  const q = trpc.email.conversaDoLead.useQuery({ leadId }, { enabled: !!leadId });
  return <Conversa q={q} vazio="Nenhum e-mail trocado com este lead ainda." />;
}
