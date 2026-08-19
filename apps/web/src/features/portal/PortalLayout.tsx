import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, UserCog, ChevronDown, Lock, HelpCircle } from "lucide-react";
import { GuiaPortal } from "./GuiaPortal";
import { useAuth } from "../../lib/auth-context";
import { trpc } from "../../lib/trpc";
import { Avatar, AvatarUpload } from "../../components/ui/avatar";
import { Modal } from "../../components/ui/modal";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { MaskedInput } from "../../components/ui/masked-input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { maskCNPJ, maskTelefone } from "../../lib/masks";
import { validarCNPJ } from "@app/shared";

/** Botão de perfil no header: avatar + nome → menu (Editar perfil, Sair). */
function ProfileMenu({ onEditar }: { onEditar: () => void }) {
  const { user, logout, loggingOut } = useAuth();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Avatar id={user.id} nome={user.nome} avatarUrl={user.avatarUrl} className="h-8 w-8" text="text-xs" />
        <span className="hidden max-w-[160px] truncate text-sm font-medium sm:block">{user.nome}</span>
        <ChevronDown className={"h-4 w-4 text-muted-foreground transition-transform " + (aberto ? "rotate-180" : "")} />
      </button>
      {aberto && (
        <div className="absolute right-0 z-40 mt-2 w-60 origin-top-right animate-scale-in overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center gap-3 border-b px-3 py-3">
            <Avatar id={user.id} nome={user.nome} avatarUrl={user.avatarUrl} className="h-10 w-10" text="text-sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.nome}</div>
              {user.email && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
            </div>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => (setAberto(false), onEditar())}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <UserCog className="h-4 w-4 text-muted-foreground" /> Editar perfil
            </button>
            <button
              onClick={() => logout()}
              disabled={loggingOut}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Modal de editar perfil do cliente: foto/logotipo + dados cadastrais que o próprio
 * cliente pode ver e corrigir (LGPD — direito de acesso e retificação). Escopado ao
 * clienteId da sessão no backend; nunca expõe campos internos da equipe.
 */
function EditarPerfilModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const confirm = useConfirm();

  const dados = trpc.portal.meusDados.useQuery(undefined, { enabled: open });
  const [form, setForm] = useState({ nome: "", cnpj: "", email: "", telefone: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open && dados.data) {
      setForm({
        nome: dados.data.nome ?? "",
        cnpj: dados.data.cnpj ?? "",
        email: dados.data.email ?? "",
        telefone: dados.data.telefone ?? "",
      });
    }
  }, [open, dados.data]);

  // Vazio é permitido (o CNPJ é opcional); preenchido, tem de ser válido.
  const cnpjInvalido = form.cnpj.trim() !== "" && !validarCNPJ(form.cnpj);

  const salvar = trpc.portal.atualizarMeusDados.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      utils.portal.meusDados.invalidate();
      utils.portal.resumo.invalidate();
      onClose();
    },
  });
  const removerAvatar = trpc.auth.removerAvatar.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar perfil"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!form.nome.trim() || cnpjInvalido || salvar.isPending || dados.isLoading}
            onClick={() =>
              salvar.mutate({
                nome: form.nome.trim(),
                cnpj: form.cnpj.trim(),
                telefone: form.telefone.trim(),
              })
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Foto / logotipo */}
        <div className="space-y-1.5">
          <Label hint="Pode ser a sua foto ou o logotipo da sua empresa/clínica. JPG, PNG ou WebP, até 5 MB.">Foto ou logotipo</Label>
          <AvatarUpload
            id={user.id}
            nome={user.nome}
            avatarUrl={user.avatarUrl}
            onChanged={() => utils.auth.me.invalidate()}
            onRemover={async () => {
              if (
                await confirm({
                  title: "Remover foto",
                  description: "A foto/logotipo será removida do seu perfil.",
                  confirmText: "Remover",
                  variant: "destructive",
                })
              )
                removerAvatar.mutate();
            }}
            podeRemover
          />
        </div>

        {/* Dados cadastrais */}
        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">Seus dados cadastrais</h3>
            <p className="text-xs text-muted-foreground">Mantenha seus dados atualizados para o seu atendimento.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="perfil-nome" hint="Nome oficial da empresa ou clínica, como aparece nos documentos.">
              Nome da empresa/clínica
            </Label>
            <Input id="perfil-nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex.: Clínica Saúde+" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="perfil-doc" hint="CNPJ da empresa/clínica, com ou sem pontuação.">
                CNPJ
              </Label>
              <MaskedInput
                id="perfil-doc"
                format={maskCNPJ}
                value={form.cnpj}
                onChange={(e) => set("cnpj", e.target.value)}
                placeholder="00.000.000/0000-00"
                aria-invalid={cnpjInvalido || undefined}
                aria-describedby={cnpjInvalido ? "perfil-doc-erro" : undefined}
              />
              {/* O aviso mora JUNTO do campo. O servidor recusa igual (`cnpjOpcional`), mas a
                  mensagem dele saía num parágrafo solto no fim do modal: em tela comprida o
                  cliente não via por que o Salvar não funcionava. */}
              {cnpjInvalido && (
                <p id="perfil-doc-erro" className="text-xs text-destructive">
                  CNPJ inválido — confira os números
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Só leitura: o endereço é chave das consultas do histórico de e-mail, então
                quem o edita escolhe o que a consulta devolve. Trocar passa pela equipe. */}
            <div className="space-y-1.5">
              <Label htmlFor="perfil-email" hint="Para trocar o e-mail, fale com a nossa equipe — é ele que identifica você no nosso histórico de mensagens.">E-mail</Label>
              <Input id="perfil-email" type="email" value={form.email} readOnly disabled />
              <p className="text-xs text-muted-foreground">Para alterar, fale com a nossa equipe.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perfil-tel" hint="Um número para contato, com DDD.">Telefone</Label>
              <MaskedInput
                id="perfil-tel"
                inputMode="tel"
                format={maskTelefone}
                value={form.telefone}
                onChange={(e) => set("telefone", e.target.value)}
                placeholder="(11) 90000-0000"
              />
            </div>
          </div>

          {salvar.error && <p className="text-sm text-destructive">{salvar.error.message}</p>}

          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Seus dados são tratados conforme a <strong>LGPD</strong> (Lei nº 13.709/2018) e usados apenas para o seu atendimento. Você pode consultar e corrigir seus
              dados aqui a qualquer momento.
            </span>
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function PortalLayout({ children }: { children: ReactNode }) {
  const [editar, setEditar] = useState(false);
  const [guia, setGuia] = useState(false);
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <img src="/logo.png" alt="MedConsultoria" className="h-8 w-auto" />
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setGuia(true)}
              className="rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
              title="Guia do Portal"
              aria-label="Guia de instruções"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
            <ProfileMenu onEditar={() => setEditar(true)} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 md:py-8">{children}</main>
      {/* Modais FORA do header: um ancestral com backdrop-filter prende elementos position:fixed. */}
      <EditarPerfilModal open={editar} onClose={() => setEditar(false)} />
      <GuiaPortal open={guia} onClose={() => setGuia(false)} />
    </div>
  );
}
