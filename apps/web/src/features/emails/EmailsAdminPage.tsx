import { useEffect, useRef, useState } from "react";
import {
  Mail,
  Save,
  RotateCcw,
  Send,
  CheckCircle2,
  Sparkles,
  Bell,
  Plus,
  Info,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { PageHeader } from "../../components/ui/page-header";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm, usePrompt } from "../../components/ui/confirm-dialog";

interface Campos {
  assunto: string;
  titulo: string;
  corpo: string;
  ctaTexto: string;
  nota: string;
}

// id do elemento no DOM para cada campo (usado ao inserir campos automáticos).
const CAMPO_ID: Record<keyof Campos, string> = {
  assunto: "campo-assunto",
  titulo: "campo-titulo",
  corpo: "campo-corpo",
  ctaTexto: "campo-cta",
  nota: "campo-nota",
};

// Grupos com nomes em linguagem simples (a chave técnica vem do backend em `grupo`).
const GRUPOS: { id: "Transacionais" | "Notificações" | "Sistema"; label: string; descricao: string }[] = [
  {
    id: "Transacionais",
    label: "Mensagens automáticas",
    descricao: "E-mails que o sistema envia sozinho: boas-vindas, acesso ao Portal, confirmações e assinatura.",
  },
  {
    id: "Notificações",
    label: "Avisos e lembretes",
    descricao: "Aparecem como e-mail e também no sininho de notificações do app.",
  },
  {
    id: "Sistema",
    label: "Alertas do sistema",
    descricao: "Avisos técnicos automáticos — vão para o responsável do sistema.",
  },
];
type GrupoId = (typeof GRUPOS)[number]["id"];

// Largura real do e-mail (600px do template + margem); usada para escalar a prévia.
const EMAIL_W = 640;

export function EmailsAdminPage() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const lista = trpc.emails.list.useQuery();

  const [grupoAtivo, setGrupoAtivo] = useState<GrupoId>("Transacionais");
  const [chave, setChave] = useState<string | null>(null);
  const [form, setForm] = useState<Campos>({ assunto: "", titulo: "", corpo: "", ctaTexto: "", nota: "" });
  const [salvo, setSalvo] = useState(false);
  const [abaPrev, setAbaPrev] = useState<"email" | "notif">("email");
  // Em telas menores (abaixo de xl) o editor e a prévia empilham — aqui a prévia
  // fica recolhida por padrão (página curta) e o usuário abre quando quiser conferir.
  const [previaAberta, setPreviaAberta] = useState(false);
  const focoRef = useRef<keyof Campos | null>(null);

  // Prévia escalada: mede a largura disponível e a altura real do e-mail.
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [prevW, setPrevW] = useState(EMAIL_W);
  const [emailH, setEmailH] = useState(680);
  const escala = Math.min(1, prevW / EMAIL_W);

  const atual = lista.data?.find((t) => t.chave === chave) ?? null;

  const camposDe = (t: NonNullable<typeof lista.data>[number]): Campos => ({
    assunto: t.assunto,
    titulo: t.titulo,
    corpo: t.corpo,
    ctaTexto: t.ctaTexto ?? "",
    nota: t.nota ?? "",
  });

  const selecionar = (t: NonNullable<typeof lista.data>[number]) => {
    setChave(t.chave);
    setGrupoAtivo(t.grupo as GrupoId);
    setForm(camposDe(t));
    setSalvo(false);
    setAbaPrev("email");
  };

  // Há edição não salva na mensagem aberta?
  const dirty = !!atual && JSON.stringify(form) !== JSON.stringify(camposDe(atual));

  const confirmarDescarte = () =>
    confirm({
      title: "Descartar alterações?",
      description: `Você editou "${atual?.label}" e ainda não salvou. Se sair agora, as alterações serão perdidas.`,
      confirmText: "Descartar",
      cancelText: "Continuar editando",
      variant: "destructive",
    });

  // Abrir outra mensagem: se há edição pendente, confirma antes (evita perda silenciosa).
  const irParaMensagem = async (t: NonNullable<typeof lista.data>[number]) => {
    if (t.chave === chave) return;
    if (dirty && !(await confirmarDescarte())) return;
    selecionar(t);
  };

  // Trocar de categoria e abrir a 1ª mensagem dela (o editor nunca fica vazio).
  const trocarGrupo = async (id: GrupoId) => {
    if (id === grupoAtivo) return;
    if (dirty && !(await confirmarDescarte())) return;
    setGrupoAtivo(id);
    const primeira = lista.data?.find((t) => t.grupo === id);
    if (primeira) selecionar(primeira);
  };

  useEffect(() => {
    if (lista.data && lista.data.length && !chave) {
      const primeira = lista.data.find((t) => t.grupo === grupoAtivo) ?? lista.data[0]!;
      selecionar(primeira);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista.data]);

  const preview = trpc.emails.preview.useMutation();
  const salvar = trpc.emails.update.useMutation({
    onSuccess: () => {
      utils.emails.list.invalidate();
      setSalvo(true);
    },
  });
  const resetar = trpc.emails.resetar.useMutation({
    onSuccess: async () => {
      await utils.emails.list.refetch();
      const t = utils.emails.list.getData()?.find((x) => x.chave === chave);
      if (t) selecionar(t);
    },
  });
  const testar = trpc.emails.enviarTeste.useMutation();

  const set = (campo: keyof Campos, valor: string) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setSalvo(false);
  };

  // Prévia ao vivo: recalcula (com atraso) sempre que o texto muda.
  useEffect(() => {
    if (!chave || !form.assunto.trim() || !form.titulo.trim() || !form.corpo.trim()) return;
    const t = setTimeout(() => preview.mutate({ chave, ...form }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, form]);

  // Acompanha a largura da caixa de prévia para calcular a escala do e-mail.
  // Re-mede também ao abrir a prévia recolhida (largura sai de 0 → valor real).
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const medir = () => {
      if (el.clientWidth > 0) setPrevW(el.clientWidth);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chave, abaPrev, previaAberta]);

  // Ao carregar o e-mail no iframe, mede a altura real do conteúdo (srcDoc = mesma origem).
  const onIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument;
      if (doc?.body) {
        const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
        if (h > 0) setEmailH(h);
      }
    } catch {
      /* ignore */
    }
  };

  // Insere um campo automático ({{chave}}) na posição do cursor do último campo focado.
  const inserirCampo = (varChave: string) => {
    const alvo = focoRef.current ?? "corpo";
    const el = document.getElementById(CAMPO_ID[alvo]) as HTMLInputElement | HTMLTextAreaElement | null;
    const valor = form[alvo] ?? "";
    const pos = focoRef.current && el ? el.selectionStart ?? valor.length : valor.length;
    const token = `{{${varChave}}}`;
    set(alvo, valor.slice(0, pos) + token + valor.slice(pos));
    setTimeout(() => {
      const e2 = document.getElementById(CAMPO_ID[alvo]) as HTMLInputElement | HTMLTextAreaElement | null;
      if (e2) {
        e2.focus();
        const p = pos + token.length;
        e2.setSelectionRange(p, p);
      }
    }, 0);
  };

  const onSalvar = () => {
    if (!chave) return;
    salvar.mutate({ chave, ...form });
  };

  const onResetar = async () => {
    if (!chave) return;
    if (
      await confirm({
        title: "Restaurar texto padrão",
        description: `O texto de "${atual?.label}" volta ao padrão do sistema. Sua personalização será perdida.`,
        confirmText: "Restaurar",
        variant: "destructive",
      })
    )
      resetar.mutate({ chave });
  };

  const onTestar = async () => {
    if (!chave) return;
    const email = await prompt({
      title: "Enviar e-mail de teste",
      description: "Enviaremos este e-mail (com dados de exemplo) para o endereço abaixo.",
      placeholder: "voce@medconsultoria.com.br",
      confirmText: "Enviar teste",
      required: true,
      icon: Send,
    });
    if (!email) return;
    testar.mutate(
      { chave, email },
      {
        onSuccess: () =>
          void confirm({ title: "Teste enviado", description: `E-mail de teste enviado para ${email}.`, confirmText: "Ok", cancelText: "Fechar" }),
        onError: (e) =>
          void confirm({ title: "Não foi possível enviar", description: e.message, confirmText: "Entendi", cancelText: "Fechar" }),
      },
    );
  };


  return (
    <div className="space-y-6">
      <PageHeader
        title="Mensagens automáticas"
        subtitle="Edite o texto das mensagens que o sistema envia sozinho — e-mails e avisos. Escolha uma mensagem na lista, ajuste o texto e veja a prévia ao lado. O visual (logo, cores e assinatura) é fixo."
      />

      {lista.isError ? (
        <QueryError onRetry={() => lista.refetch()} />
      ) : lista.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="space-y-5">
          {/* Abas por categoria de mensagem */}
          <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/30 p-1">
            {GRUPOS.map((grupo) => {
              const n = lista.data?.filter((t) => t.grupo === grupo.id).length ?? 0;
              if (!n) return null;
              return (
                <button
                  key={grupo.id}
                  onClick={() => trocarGrupo(grupo.id)}
                  className={cn(
                    "flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    grupoAtivo === grupo.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {grupo.label}
                  <span className="ml-1.5 text-xs opacity-70">({n})</span>
                </button>
              );
            })}
          </div>

          {/* O que é esta categoria (explica para o usuário) */}
          <p className="flex items-start gap-1.5 px-0.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            {GRUPOS.find((g) => g.id === grupoAtivo)?.descricao}
          </p>

          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            {/* Mensagens desta categoria */}
            <div className="space-y-1.5">
              {(lista.data?.filter((t) => t.grupo === grupoAtivo) ?? []).map((t) => (
                <button
                  key={t.chave}
                  onClick={() => irParaMensagem(t)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                    chave === t.chave ? "border-primary/50 bg-primary/5" : "hover:bg-accent/50",
                  )}
                >
                  <Mail className={cn("mt-0.5 h-4 w-4 shrink-0", chave === t.chave ? "text-primary" : "text-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {t.label}
                      {t.personalizado && <Badge variant="warning">editado</Badge>}
                    </div>
                    <div className="text-xs leading-snug text-muted-foreground">{t.descricao}</div>
                    {t.notificacao && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        <Bell className="h-2.5 w-2.5" /> Também no sino
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

          {/* Editor + prévia */}
          {atual && (
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardContent className="space-y-4 p-5">
                  {atual.notificacao && (
                    <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground">
                      <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        Esta mensagem aparece em <strong>dois lugares</strong>: como <strong>e-mail</strong> e como{" "}
                        <strong>notificação no sino</strong> do app. O mesmo título e corpo valem para os dois.
                      </span>
                    </div>
                  )}

                  {atual.variaveis.length > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Campos automáticos
                      </div>
                      <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                        <Info className="mt-px h-3 w-3 shrink-0" />
                        Preenchidos sozinhos pelo sistema no envio. Clique em um campo para inseri-lo no texto onde o cursor
                        estiver — você não digita o valor, só escolhe onde ele aparece.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {atual.variaveis.map((v) => (
                          <button
                            key={v.chave}
                            type="button"
                            onClick={() => inserirCampo(v.chave)}
                            title={`Inserir "${v.rotulo}" — ${v.descricao}`}
                            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
                          >
                            <Plus className="h-3 w-3 text-primary" />
                            {v.rotulo}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor={CAMPO_ID.assunto} hint="Título que aparece na caixa de entrada do destinatário, antes de abrir o e-mail.">Assunto do e-mail</Label>
                    <Input
                      id={CAMPO_ID.assunto}
                      value={form.assunto}
                      onFocus={() => (focoRef.current = "assunto")}
                      onChange={(e) => set("assunto", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={CAMPO_ID.titulo} hint="Título em destaque dentro do e-mail (e da notificação, quando houver).">Título{atual.notificacao ? " (e-mail e sino)" : ""}</Label>
                    <Input
                      id={CAMPO_ID.titulo}
                      value={form.titulo}
                      onFocus={() => (focoRef.current = "titulo")}
                      onChange={(e) => set("titulo", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={CAMPO_ID.corpo} hint="Texto principal da mensagem. Use os campos automáticos abaixo para inserir dados do destinatário.">Corpo (separe parágrafos com uma linha em branco)</Label>
                    <Textarea
                      id={CAMPO_ID.corpo}
                      rows={6}
                      value={form.corpo}
                      onFocus={() => (focoRef.current = "corpo")}
                      onChange={(e) => set("corpo", e.target.value)}
                    />
                  </div>
                  {atual.temCta && (
                    <div className="space-y-1.5">
                      <Label htmlFor={CAMPO_ID.ctaTexto} hint="Texto exibido no botão de ação do e-mail, ex.: Acessar o Portal.">Texto do botão</Label>
                      <Input
                        id={CAMPO_ID.ctaTexto}
                        value={form.ctaTexto}
                        onFocus={() => (focoRef.current = "ctaTexto")}
                        onChange={(e) => set("ctaTexto", e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor={CAMPO_ID.nota} hint="Texto pequeno no rodapé do e-mail, para um aviso extra opcional.">Observação (rodapé pequeno, opcional)</Label>
                    <Textarea
                      id={CAMPO_ID.nota}
                      rows={2}
                      value={form.nota}
                      onFocus={() => (focoRef.current = "nota")}
                      onChange={(e) => set("nota", e.target.value)}
                    />
                  </div>

                  {salvar.error && <p className="text-sm text-destructive">{salvar.error.message}</p>}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button onClick={onSalvar} disabled={!dirty || salvar.isPending}>
                      <Save className="h-4 w-4" />
                      Salvar
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => atual && setForm(camposDe(atual))}
                      disabled={!dirty}
                    >
                      Cancelar
                    </Button>
                    <Button variant="outline" onClick={onTestar} disabled={testar.isPending}>
                      <Send className="h-4 w-4" />
                      Enviar teste
                    </Button>
                    {atual.personalizado && (
                      <Button variant="ghost" onClick={onResetar} disabled={resetar.isPending} className="text-muted-foreground">
                        <RotateCcw className="h-4 w-4" />
                        Restaurar padrão
                      </Button>
                    )}
                    {salvo && (
                      <span className="flex items-center gap-1 text-sm font-medium text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        Salvo
                      </span>
                    )}
                  </div>

                  {/* Em telas menores, a prévia fica recolhida — este botão mostra/oculta. */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviaAberta((v) => !v)}
                    className="w-full xl:hidden"
                  >
                    {previaAberta ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {previaAberta ? "Ocultar prévia" : "Ver prévia do e-mail"}
                  </Button>
                </CardContent>
              </Card>

              {/* Prévia ao vivo (sempre visível em telas largas; recolhível nas menores) */}
              <Card className={cn(!previaAberta && "hidden xl:block")}>
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-muted-foreground">Prévia ao vivo (dados de exemplo)</div>
                    {atual.notificacao && (
                      <div className="flex gap-1 rounded-md border bg-muted/30 p-0.5">
                        <button
                          onClick={() => setAbaPrev("email")}
                          className={cn(
                            "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                            abaPrev === "email" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Mail className="h-3 w-3" /> E-mail
                        </button>
                        <button
                          onClick={() => setAbaPrev("notif")}
                          className={cn(
                            "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                            abaPrev === "notif" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Bell className="h-3 w-3" /> Sino
                        </button>
                      </div>
                    )}
                  </div>

                  {abaPrev === "notif" && atual.notificacao ? (
                    <div className="flex h-[560px] items-start justify-center rounded-lg border bg-muted/20 p-6">
                      {/* Réplica de como a notificação aparece no sino */}
                      <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-popover shadow-sm">
                        <div className="border-b px-4 py-2.5 text-sm font-semibold">Notificações</div>
                        <div className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Bell className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold">{preview.data?.notifTitulo ?? form.titulo}</div>
                            <div className="truncate text-xs text-muted-foreground">{preview.data?.notifCorpo ?? form.corpo}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">agora</div>
                          </div>
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        </div>
                      </div>
                    </div>
                  ) : preview.data?.html ? (
                    // E-mail real (600px) encaixado por escala — mostra o layout fiel, sem scroll.
                    <div
                      ref={previewBoxRef}
                      className="w-full overflow-hidden rounded-lg border"
                      style={{ height: Math.round(emailH * escala) }}
                    >
                      <iframe
                        title="Prévia do e-mail"
                        srcDoc={preview.data.html}
                        onLoad={onIframeLoad}
                        scrolling="no"
                        style={{
                          width: EMAIL_W,
                          height: emailH,
                          border: 0,
                          display: "block",
                          transform: `scale(${escala})`,
                          transformOrigin: "top left",
                        }}
                      />
                    </div>
                  ) : (
                    <div ref={previewBoxRef} className="flex h-[560px] w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                      Gerando prévia…
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
