import { useState } from "react";
import { UserPlus, Pencil, Trash2, Users, Send, ShieldCheck } from "lucide-react";
import { ROLE_LABEL, ROLE_LEVEL, type Role } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { PageHeader } from "../../components/ui/page-header";
import { Button } from "../../components/ui/button";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { TableSkeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { QueryError } from "../../components/ui/query-error";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Avatar } from "../../components/ui/avatar";
import { UsuarioFormDialog, type UsuarioEditavel, type ConviteResultado } from "./UsuarioFormDialog";
import { ExcluirUsuarioDialog } from "./ExcluirUsuarioDialog";
import { ConviteLinkDialog } from "./ConviteLinkDialog";

const roleVariant: Record<Role, BadgeProps["variant"]> = {
  ROOT: "danger",
  ADMIN: "primary",
  FUNCIONARIO: "default",
  CLIENTE: "success",
};

export function UsuariosPage() {
  const { user } = useAuth();
  const usuarios = trpc.usuarios.list.useQuery();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<UsuarioEditavel | null>(null);
  const [excluindo, setExcluindo] = useState<{ id: string; nome: string } | null>(null);
  const [conviteInfo, setConviteInfo] = useState<ConviteResultado | null>(null);

  const reenviar = trpc.usuarios.reenviarConvite.useMutation({
    onSuccess: (r) =>
      setConviteInfo({ email: r.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado }),
  });

  // Gerenciar a si mesmo, usuários de papel abaixo do seu, ou — sendo ROOT — qualquer um
  // (o ROOT gere outros roots; o root primordial tem os controles travados no formulário).
  const podeEditar = (u: { id: string; role: Role }) =>
    u.id === user.id || ROLE_LEVEL[u.role] < ROLE_LEVEL[user.role] || user.role === "ROOT";
  // Excluir: nunca a si mesmo nem o root primordial; papel abaixo do seu ou — sendo ROOT — um par.
  const podeExcluir = (u: { id: string; role: Role; protegido?: boolean }) =>
    u.id !== user.id && !u.protegido && (ROLE_LEVEL[u.role] < ROLE_LEVEL[user.role] || user.role === "ROOT");

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Equipe e acessos"
        subtitle="Equipe interna e acessos de Portal do Cliente."
      >
        <Button onClick={() => setNovo(true)}>
          <UserPlus className="h-4 w-4" />
          Convidar usuário
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {usuarios.isError ? (
        <QueryError onRetry={() => usuarios.refetch()} />
      ) : usuarios.isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : !usuarios.data || usuarios.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum usuário ainda"
          description="Cadastre o primeiro membro da equipe ou um acesso de Portal."
        >
          <Button onClick={() => setNovo(true)}>
            <UserPlus className="h-4 w-4" />
            Convidar usuário
          </Button>
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>E-mail</TH>
              <TH>Papel</TH>
              <TH>Cliente</TH>
              <TH>Situação</TH>
              <TH className="text-right">Ações</TH>
            </tr>
          </THead>
          <tbody>
            {usuarios.data.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Avatar id={u.id} nome={u.nome} avatarUrl={u.avatarUrl} className="h-7 w-7" text="text-xs" />
                    {u.nome}
                  </span>
                </TD>
                <TD className="text-muted-foreground">{u.email}</TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant={roleVariant[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                    {u.protegido && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="Root principal — não pode ser rebaixado, desativado nem excluído">
                        <ShieldCheck className="h-3.5 w-3.5" /> principal
                      </span>
                    )}
                  </span>
                </TD>
                <TD className="text-muted-foreground">{u.cliente?.nome ?? "—"}</TD>
                <TD>
                  {u.pendente ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-warning">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      Convite pendente
                    </span>
                  ) : u.ativo ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                      Inativo
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {u.pendente && podeEditar(u) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reenviar.isPending}
                        title="Reenviar convite"
                        className="text-muted-foreground hover:text-primary"
                        onClick={() => reenviar.mutate({ id: u.id })}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Reenviar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!podeEditar(u)}
                      title={podeEditar(u) ? "Editar" : "Sem permissão sobre este usuário"}
                      onClick={() =>
                        setEditando({
                          id: u.id,
                          nome: u.nome,
                          email: u.email,
                          role: u.role,
                          ativo: u.ativo,
                          clienteId: u.clienteId,
                          protegido: u.protegido,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!podeExcluir(u)}
                      title={podeExcluir(u) ? "Excluir" : "Sem permissão para excluir este usuário"}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setExcluindo({ id: u.id, nome: u.nome })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      </div>

      <UsuarioFormDialog open={novo} onClose={() => setNovo(false)} onConvite={setConviteInfo} />
      <UsuarioFormDialog
        open={!!editando}
        onClose={() => setEditando(null)}
        usuario={editando ?? undefined}
      />
      <ExcluirUsuarioDialog
        open={!!excluindo}
        onClose={() => setExcluindo(null)}
        usuario={excluindo}
      />
      <ConviteLinkDialog info={conviteInfo} onClose={() => setConviteInfo(null)} />
    </div>
  );
}
