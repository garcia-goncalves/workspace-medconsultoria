import { useEffect, useMemo, useState } from "react";
import { Mail, Plus, Search, X, AlertTriangle, Paperclip } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { POLL } from "../../lib/socket";
import { data, hora } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { AdicionarCaixaDialog } from "./AdicionarCaixaDialog";
import { CorpoEmail } from "./CorpoEmail";

export function EmailPage() {
  const utils = trpc.useUtils();
  const [adicionando, setAdicionando] = useState(false);
  const [caixaId, setCaixaId] = useState<string | null>(null);
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [msgId, setMsgId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  // Divisor arrastável, no mesmo padrão das Mensagens (ADR-83).
  const [larguraLista, setLarguraLista] = useState(() => {
    const v = Number(localStorage.getItem("email:larguraLista"));
    return v >= 280 && v <= 620 ? v : 380;
  });
  useEffect(() => {
    localStorage.setItem("email:larguraLista", String(larguraLista));
  }, [larguraLista]);
  const iniciarRedimensionar = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = larguraLista;
    const mover = (ev: PointerEvent) => setLarguraLista(Math.min(620, Math.max(280, w0 + (ev.clientX - x0))));
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  const caixas = trpc.email.caixas.useQuery();
  const caixaAtual = useMemo(
    () => caixas.data?.find((c) => c.id === caixaId) ?? caixas.data?.[0] ?? null,
    [caixas.data, caixaId],
  );

  const pastas = trpc.email.pastas.useQuery(
    { caixaId: caixaAtual?.id ?? "" },
    { enabled: !!caixaAtual, refetchInterval: POLL.emailPastas },
  );
  const pastaAtual = useMemo(
    () => pastas.data?.find((p) => p.id === pastaId) ?? pastas.data?.find((p) => p.papel === "INBOX") ?? null,
    [pastas.data, pastaId],
  );

  const sincronizar = trpc.email.sincronizar.useMutation({
    onSuccess: () => {
      utils.email.mensagens.invalidate();
      utils.email.pastas.invalidate();
    },
  });

  /**
   * Sincroniza ao abrir a pasta E a cada intervalo do polling.
   *
   * O intervalo é a parte que faltava: quem busca e-mail NOVO no servidor é esta mutation — as
   * queries de `mensagens`/`pastas` só releem o cache do banco. Com só o disparo de abertura, a
   * tela ficava parada: chegava e-mail, o polling rodava a cada 30s relendo o mesmo cache, e o
   * e-mail só aparecia se a pessoa trocasse de pasta ou recarregasse a página.
   *
   * `document.hidden` evita bater no IMAP com a aba em segundo plano — o servidor de e-mail é
   * de terceiro e conexão custa; volta a sincronizar quando a aba volta ao primeiro plano.
   */
  useEffect(() => {
    if (!caixaAtual || !pastaAtual) return;
    const alvo = { caixaId: caixaAtual.id, pastaId: pastaAtual.id };
    const puxar = () => {
      if (!document.hidden) sincronizar.mutate(alvo);
    };
    puxar();
    const t = setInterval(puxar, POLL.emailLista);
    document.addEventListener("visibilitychange", puxar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", puxar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caixaAtual?.id, pastaAtual?.id]);

  const mensagens = trpc.email.mensagens.useQuery(
    { pastaId: pastaAtual?.id ?? "", busca: buscaAtiva || undefined },
    {
      enabled: !!pastaAtual,
      // Busca ativa NÃO entra no polling: cada refetch com termo vira varredura de corpo
      // (ESEARCH) na caixa inteira, a cada 30 segundos, por aba aberta.
      refetchInterval: buscaAtiva ? false : POLL.emailLista,
    },
  );

  const aberta = trpc.email.abrir.useQuery({ mensagemId: msgId ?? "" }, { enabled: !!msgId });

  // Abrir marca a mensagem como lida no servidor. Sem avisar a lista e o contador de não lidos,
  // o e-mail continuaria em negrito até o próximo polling.
  useEffect(() => {
    if (!aberta.data) return;
    utils.email.mensagens.invalidate();
    utils.email.pastas.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta.data?.id]);

  if (caixas.isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  // Nenhuma caixa plugada: a página inteira é o convite para plugar a primeira.
  if (!caixas.data?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Mail className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-primary">Seu e-mail, aqui dentro</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Conecte a sua caixa <strong>@medconsultoria.com.br</strong> para ler e responder sem sair
          do Workspace. Só você enxerga a sua caixa.
        </p>
        <Button onClick={() => setAdicionando(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar caixa
        </Button>
        <AdicionarCaixaDialog open={adicionando} onClose={() => setAdicionando(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* ── coluna 1: caixas e pastas ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h1 className="text-sm font-semibold text-primary">E-mail</h1>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdicionando(true)}
            aria-label="Adicionar caixa"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {caixas.data.map((c) => (
            <div key={c.id} className="mb-3">
              <button
                type="button"
                onClick={() => {
                  setCaixaId(c.id);
                  setPastaId(null);
                  setMsgId(null);
                }}
                className={cn(
                  "w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold",
                  c.id === caixaAtual?.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
                title={c.email}
              >
                {c.rotulo || c.email}
              </button>

              {c.estado === "AUTENTICACAO_FALHOU" && (
                <p className="mt-1 flex items-start gap-1 px-2 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Precisa reconectar: a senha foi recusada.
                </p>
              )}

              {c.id === caixaAtual?.id &&
                pastas.data?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPastaId(p.id);
                      setMsgId(null);
                    }}
                    className={cn(
                      "mt-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                      p.id === pastaAtual?.id ? "bg-muted font-medium" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="truncate">{p.nome}</span>
                    {p.naoLidos > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                        {p.naoLidos}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </aside>

      {/* ── coluna 2: lista ── */}
      <div
        style={{ ["--lista-w" as string]: `${larguraLista}px` }}
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[var(--lista-w)]",
          msgId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setBuscaAtiva(busca)}
              placeholder="Buscar (remetente, assunto ou texto)"
              className="pl-8"
            />
          </div>
          {(busca || buscaAtiva) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBusca("");
                setBuscaAtiva("");
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mensagens.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {mensagens.data?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {buscaAtiva ? "Nenhum e-mail encontrado para esta busca." : "Nenhum e-mail nesta pasta."}
            </p>
          )}
          {mensagens.data?.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMsgId(m.id)}
              className={cn(
                "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted/50",
                m.id === msgId && "bg-muted",
              )}
            >
              <Avatar nome={m.deNome || m.deEmail} className="mt-0.5 h-8 w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", !m.lido && "font-semibold")}>{m.deNome || m.deEmail}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{data(m.dataEm)}</span>
                </div>
                <p className={cn("truncate text-sm", !m.lido ? "font-medium" : "text-muted-foreground")}>
                  {m.assunto || "(sem assunto)"}
                </p>
                {m.trecho && <p className="truncate text-xs text-muted-foreground">{m.trecho}</p>}
              </div>
              {m.temAnexo && <Paperclip className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>

      {/* divisor arrastável */}
      <div
        onPointerDown={iniciarRedimensionar}
        className="hidden w-1 cursor-col-resize bg-border transition-colors hover:bg-primary/40 md:block"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar largura da lista"
      />

      {/* ── coluna 3: mensagem aberta ── */}
      <section className={cn("min-w-0 flex-1 flex-col", msgId ? "flex" : "hidden md:flex")}>
        {!msgId && <p className="m-auto text-sm text-muted-foreground">Escolha um e-mail para ler.</p>}

        {msgId && aberta.isLoading && <p className="p-4 text-sm text-muted-foreground">Abrindo…</p>}

        {msgId && aberta.data && (
          <>
            <header className="shrink-0 border-b p-4">
              <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => setMsgId(null)}>
                Voltar
              </Button>
              <h2 className="text-base font-semibold">{aberta.data.assunto || "(sem assunto)"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{aberta.data.deNome || aberta.data.deEmail}</span>{" "}
                &lt;{aberta.data.deEmail}&gt; · {data(aberta.data.dataEm)} às {hora(aberta.data.dataEm)}
              </p>
              {aberta.data.anexos.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  {aberta.data.anexos.map((a) => (
                    <span key={a.id} className="rounded border px-1.5 py-0.5">
                      {a.nome}
                    </span>
                  ))}
                </p>
              )}
            </header>

            <CorpoEmail
              html={aberta.data.corpoHtml}
              texto={aberta.data.corpoTexto}
              imagensBloqueadas={aberta.data.imagensBloqueadas}
            />
          </>
        )}
      </section>

      <AdicionarCaixaDialog open={adicionando} onClose={() => setAdicionando(false)} />
    </div>
  );
}
