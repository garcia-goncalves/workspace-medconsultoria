import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  Plus,
  Search,
  X,
  AlertTriangle,
  Paperclip,
  Pencil,
  Reply,
  ReplyAll,
  Forward,
  Download,
  Eye,
  EyeOff,
  FolderPlus,
  Check,
  UserPlus,
  Building2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { POLL } from "../../lib/socket";
import { data, hora } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Modal } from "../../components/ui/modal";
import { Combobox } from "../../components/ui/combobox";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";
import { AdicionarCaixaDialog } from "./AdicionarCaixaDialog";
import { ReconectarCaixaDialog } from "./ReconectarCaixaDialog";
import { CorpoEmail } from "./CorpoEmail";
import { Escrever, type ModoEscrever } from "./Escrever";

export function EmailPage() {
  const utils = trpc.useUtils();
  const [adicionando, setAdicionando] = useState(false);
  const [caixaId, setCaixaId] = useState<string | null>(null);
  const [pastaId, setPastaId] = useState<string | null>(null);
  // `?mensagem=<id>` é como a ficha do cliente manda abrir um e-mail aqui ("Abrir na minha caixa",
  // ADR-97). Lido uma vez, na montagem: depois quem manda é o clique na lista. Se o id não for da
  // pessoa, `email.abrir` responde NOT_FOUND e a tela segue na caixa normal.
  const [msgId, setMsgId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("mensagem") || null,
  );
  const [reconectar, setReconectar] = useState<{ id: string; email: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [escrevendo, setEscrevendo] = useState<{ modo: ModoEscrever; mensagemId?: string } | null>(null);

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
    // A lista de pastas é redescoberta ao ABRIR a caixa, não a cada ciclo: LIST custa uma
    // conexão IMAP e a lista muda raramente. Sem isto, pasta criada ou desinscrita no webmail
    // nunca chegava aqui — a lista congelava no dia em que a caixa foi plugada.
    let primeira = true;
    const puxar = () => {
      if (document.hidden) return;
      sincronizar.mutate({ ...alvo, descobrirPastas: primeira });
      primeira = false;
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
  const marcarParticular = trpc.email.marcarParticular.useMutation({
    onSuccess: () => {
      utils.email.abrir.invalidate();
      utils.email.conversaDoCliente.invalidate();
      utils.email.conversaDoLead.invalidate();
    },
  });
  // Const local para o TS manter a narrowing de "não é null" dentro dos onClick abaixo
  // (acesso via `aberta.data` direto perde a narrowing dentro de closures).
  const msgAberta = aberta.data ?? null;

  // ── Fases 2D-2 e 2D-3: o que dá para FAZER a partir deste e-mail ────────────────────────────
  //
  // Consulta à parte da abertura de propósito: `abrir` é a operação cara (baixa e higieniza o
  // corpo) e este contexto é barato. Separado, ele reaparece sozinho depois de criar o lead.
  const contexto = trpc.email.contextoDaMensagem.useQuery({ mensagemId: msgId ?? "" }, { enabled: !!msgId });
  const clienteUnico = contexto.data?.clientes.length === 1 ? contexto.data.clientes[0]! : null;
  const podeVirarLead = !!contexto.data && !contexto.data.remetenteDaCasa && !contexto.data.lead && contexto.data.clientes.length === 0;

  /** Anexo aguardando a escolha do cliente (sem vínculo automático, ou com mais de um candidato). */
  const [escolhendoCliente, setEscolhendoCliente] = useState<{ anexoId: string; nome: string } | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  // Só carrega a lista de clientes quando a escolha é realmente necessária.
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: !!escolhendoCliente });

  const arquivarAnexo = trpc.email.arquivarAnexo.useMutation({
    onSuccess: (r) => {
      toast(
        r.jaExistia
          ? `"${r.nome}" já estava guardado na ficha do cliente.`
          : `"${r.nome}" foi guardado nos documentos do cliente.`,
        "success",
      );
      setEscolhendoCliente(null);
      setClienteEscolhido("");
      // O selo "na ficha" do anexo vem do `arquivoId`, que acabou de mudar.
      utils.email.abrir.invalidate();
      // A ficha do cliente mostra o documento novo sem esperar o próximo polling.
      utils.clientes.arquivos.invalidate();
    },
    onError: (e) => toast(e.message),
  });

  const criarLead = trpc.email.criarLeadDoRemetente.useMutation({
    onSuccess: (r) => {
      toast(
        r.jaExistia ? `${r.nome} já estava no funil.` : `${r.nome} entrou no funil como lead novo.`,
        "success",
      );
      utils.email.contextoDaMensagem.invalidate();
      utils.leads.invalidate();
    },
    onError: (e) => toast(e.message),
  });

  /** Um clique só quando já se sabe de quem é; caixa de escolha quando não se sabe. */
  const guardarAnexo = (anexoId: string, nome: string) => {
    if (!msgAberta) return;
    if (clienteUnico) {
      arquivarAnexo.mutate({ mensagemId: msgAberta.id, anexoId, clienteId: clienteUnico.id });
      return;
    }
    setClienteEscolhido("");
    setEscolhendoCliente({ anexoId, nome });
  };

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
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEscrevendo({ modo: "novo" })}
              disabled={!caixaAtual}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Escrever
            </Button>
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
                <div className="mt-1 px-2">
                  <p className="flex items-start gap-1 text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Parada: a senha guardada não funciona mais.
                  </p>
                  <button
                    type="button"
                    onClick={() => setReconectar({ id: c.id, email: c.email })}
                    className="mt-1 rounded-md px-1 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Reconectar
                  </button>
                </div>
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

        {msgId && msgAberta && (
          <>
            <header className="shrink-0 border-b p-4">
              <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => setMsgId(null)}>
                Voltar
              </Button>
              <h2 className="text-base font-semibold">{msgAberta.assunto || "(sem assunto)"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{msgAberta.deNome || msgAberta.deEmail}</span>{" "}
                &lt;{msgAberta.deEmail}&gt; · {data(msgAberta.dataEm)} às {hora(msgAberta.dataEm)}
              </p>
              {msgAberta.anexos.length > 0 && (
                /* Cada anexo é um LINK de verdade para `GET /email-anexo/:mensagemId/:anexoId`.
                   `<a href>` e não `fetch`: a rota é do MESMO domínio, então o cookie httpOnly da
                   sessão vai junto no clique — com `fetch` seria preciso montar um blob na memória
                   do navegador só para recriar o download que o navegador já sabe fazer. A rota
                   responde `Content-Disposition: attachment` + `octet-stream` + `nosniff`, então
                   nada abre dentro do nosso domínio, nem um `.html` com script.

                   SEM o atributo `download`, de propósito: com ele o navegador salva o corpo da
                   resposta seja qual for o status, e um 401 (sessão expirada) ou 404 (o IMAP não
                   devolveu a parte) vira um "contrato.pdf" com `{"error":"…"}` dentro, que o
                   leitor de PDF abre como arquivo corrompido — a mensagem do servidor nunca
                   chegaria a ninguém. Em aba nova, o sucesso baixa igual (é o
                   `Content-Disposition` que manda, com o nome em UTF-8) e o erro aparece legível
                   sem derrubar a tela do e-mail. */
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {msgAberta.anexos.map((a) => (
                    <span key={a.id} className="inline-flex items-center">
                      <a
                        href={`/email-anexo/${msgAberta.id}/${a.id}`}
                        target="_blank"
                        rel="noopener"
                        aria-label={`Baixar anexo ${a.nome}`}
                        className="inline-flex max-w-[16rem] items-center gap-1 rounded-l border px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                      >
                        <Download className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {/* `title` no texto (não no link): serve de balão para o mouse quando o nome
                            é truncado, sem virar uma segunda leitura para o leitor de tela. */}
                        <span className="truncate" title={a.nome}>
                          {a.nome}
                        </span>
                      </a>
                      {/* Fase 2D-2: o anexo vira documento do cliente sem passar pelo disco de
                          ninguém. Já guardado vira SELO, não botão — repetir o clique não cria
                          um segundo documento, e a tela deve dizer isso antes de o servidor dizer. */}
                      {a.arquivoId ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-r border border-l-0 bg-muted px-1.5 py-0.5 text-success"
                          title="Este anexo já está nos documentos do cliente."
                        >
                          <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                          na ficha
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={arquivarAnexo.isPending}
                          onClick={() => guardarAnexo(a.id, a.nome)}
                          aria-label={`Guardar ${a.nome} nos documentos do cliente`}
                          title={
                            clienteUnico
                              ? `Guardar nos documentos de ${clienteUnico.nome}.`
                              : "Guardar nos documentos de um cliente (você escolhe qual)."
                          }
                          className="inline-flex items-center gap-1 rounded-r border border-l-0 px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          <FolderPlus className="h-3 w-3 shrink-0" aria-hidden="true" />
                          guardar
                        </button>
                      )}
                    </span>
                  ))}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEscrevendo({ modo: "responder", mensagemId: msgAberta.id })}
                >
                  <Reply className="mr-1.5 h-3.5 w-3.5" /> Responder
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEscrevendo({ modo: "responderTodos", mensagemId: msgAberta.id })}
                >
                  <ReplyAll className="mr-1.5 h-3.5 w-3.5" /> Responder a todos
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEscrevendo({ modo: "encaminhar", mensagemId: msgAberta.id })}
                >
                  <Forward className="mr-1.5 h-3.5 w-3.5" /> Encaminhar
                </Button>
                {/*
                 * A válvula do ADR-97, do lado de cá: a ficha do cliente só TIRA um e-mail de lá;
                 * devolver é aqui, na caixa de quem é dono. Sem este botão a marcação seria de mão
                 * única na app inteira — só o banco desfaria.
                 */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={marcarParticular.isPending}
                  onClick={() =>
                    marcarParticular.mutate({ mensagemId: msgAberta.id, particular: !msgAberta.particular })
                  }
                  title={
                    msgAberta.particular
                      ? "Hoje este e-mail não aparece na ficha do cliente. Devolvê-lo mostra assunto, data e trecho para a equipe."
                      : "Some da ficha do cliente para toda a equipe. Continua aqui, na sua caixa."
                  }
                >
                  {msgAberta.particular ? (
                    <>
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> Devolver à ficha
                    </>
                  ) : (
                    <>
                      <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Tirar da ficha
                    </>
                  )}
                </Button>

                {/*
                 * Quem é esta pessoa para a empresa (fase 2D-3). Três estados, e cada um responde
                 * a pergunta que quem lê o e-mail está fazendo:
                 *  - já é cliente ou lead → atalho para a ficha, para não procurar no menu;
                 *  - ninguém conhecido → o convite para pôr no funil com um clique;
                 *  - colega da casa → nada, e é de propósito (ADR-97: colega não vira lead).
                 */}
                {clienteUnico && (
                  <Link
                    to="/clientes/$clienteId"
                    params={{ clienteId: clienteUnico.id }}
                    className="inline-flex items-center rounded-md px-2 text-sm text-primary hover:underline"
                  >
                    <Building2 className="mr-1.5 h-3.5 w-3.5" /> Ver {clienteUnico.nome}
                  </Link>
                )}
                {contexto.data?.lead && (
                  <Link
                    to="/leads"
                    className="inline-flex items-center rounded-md px-2 text-sm text-primary hover:underline"
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" /> No funil: {contexto.data.lead.nome}
                  </Link>
                )}
                {podeVirarLead && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={criarLead.isPending}
                    onClick={() => criarLead.mutate({ mensagemId: msgAberta.id })}
                    title="Cria um lead no funil com o nome e o e-mail de quem escreveu."
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Virar lead
                  </Button>
                )}
              </div>
            </header>

            <CorpoEmail
              mensagemId={msgAberta.id}
              temHtml={!!msgAberta.corpoHtml}
              texto={msgAberta.corpoTexto}
              imagensBloqueadas={msgAberta.imagensBloqueadas}
            />
          </>
        )}
      </section>

      <AdicionarCaixaDialog open={adicionando} onClose={() => setAdicionando(false)} />
      <ReconectarCaixaDialog
        caixaId={reconectar?.id ?? null}
        email={reconectar?.email ?? ""}
        onClose={() => setReconectar(null)}
      />
      {escrevendo && caixaAtual && (
        <Escrever
          modo={escrevendo.modo}
          caixaId={caixaAtual.id}
          mensagemId={escrevendo.mensagemId}
          onFechar={() => setEscrevendo(null)}
        />
      )}

      {/* Só aparece quando o e-mail NÃO diz de quem é o documento — com vínculo único, guardar é
          um clique e esta caixa nunca abre. */}
      <Modal
        open={!!escolhendoCliente}
        onClose={() => setEscolhendoCliente(null)}
        title="Guardar anexo na ficha de qual cliente?"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEscolhendoCliente(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!clienteEscolhido || arquivarAnexo.isPending}
              onClick={() => {
                if (!msgAberta || !escolhendoCliente) return;
                arquivarAnexo.mutate({
                  mensagemId: msgAberta.id,
                  anexoId: escolhendoCliente.anexoId,
                  clienteId: clienteEscolhido,
                });
              }}
            >
              {arquivarAnexo.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          <strong className="text-foreground">{escolhendoCliente?.nome}</strong> vai virar um
          documento na ficha do cliente que você escolher — do mesmo jeito que um arquivo enviado
          pelo Portal.
        </p>
        <div className="space-y-1">
          <Label htmlFor="clienteDoAnexo">Cliente</Label>
          <Combobox
            id="clienteDoAnexo"
            value={clienteEscolhido}
            onChange={setClienteEscolhido}
            options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
            placeholder="Buscar cliente…"
            emptyText="Nenhum cliente encontrado."
          />
        </div>
      </Modal>
    </div>
  );
}
