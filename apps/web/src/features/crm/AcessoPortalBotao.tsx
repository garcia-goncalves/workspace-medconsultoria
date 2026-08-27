import { KeyRound, MonitorSmartphone, Loader2 } from "lucide-react";
import type { AcessoAoPortal } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { toast } from "../../components/ui/toast";

/**
 * O acesso ao Portal, como o card do lead e o do cliente mostram (ADR-128).
 *
 * **Três estados, não dois.** O do meio é o que a Thaís não tinha: saber que convidou e ninguém
 * apareceu. Antes, um cliente que nunca entrou e um que entrou ontem tinham exatamente a mesma
 * aparência no card, e a única saída era reenviar o convite no escuro.
 *
 * | Estado       | O que aparece      | O que ele diz                              |
 * | ------------ | ------------------ | ------------------------------------------ |
 * | `SEM_ACESSO` | **Enviar acesso**  | ninguém foi convidado ainda                 |
 * | `CONVIDADO`  | **Reenviar acesso**| convidado há N dias, ainda não entrou       |
 * | `ATIVO`      | **Painel**         | entrou; último acesso há N dias             |
 *
 * ⚠️ O "Painel" só aparece no estado ATIVO porque a sessão de suporte precisa de uma conta com
 * senha definida — conta pendente seria recusada na primeira validação de sessão.
 */

/** "há 3 dias", "hoje", "há 2 meses" — texto curto, sem biblioteca de datas. */
function faz(quando: Date | string | null): string {
  if (!quando) return "";
  const dias = Math.floor((Date.now() - new Date(quando).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

export function resumoDoAcesso(portal: AcessoAoPortal): string {
  if (portal.estado === "SEM_ACESSO") return "Sem acesso ao Portal";
  if (portal.estado === "CONVIDADO") return `Convidado ${faz(portal.convidadoEm)} — ainda não entrou`;
  return portal.ultimoAcessoEm ? `Último acesso ${faz(portal.ultimoAcessoEm)}` : "Já tem acesso";
}

interface Props {
  portal: AcessoAoPortal;
  /** Nulo quando o lead ainda não virou conta — aí não há painel a abrir. */
  clienteId: string | null;
  temEmail: boolean;
  onEnviarAcesso: () => void;
  className?: string;
}

const BOTAO =
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60";

export function AcessoPortalBotao({ portal, clienteId, temEmail, onEnviarAcesso, className }: Props) {
  const entrar = trpc.auth.entrarNoPainelDoCliente.useMutation({
    onSuccess: () => {
      // Recarrega tudo: a sessão passou a ser a do cliente e nenhum dado interno em cache vale
      // mais. Ir para a raiz deixa o roteador levar ao Portal, que é o que a sessão permite.
      window.location.href = "/";
    },
    onError: (e) => toast(e.message),
  });

  if (portal.estado === "ATIVO") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (clienteId) entrar.mutate({ clienteId });
        }}
        disabled={!clienteId || entrar.isPending}
        className={`${BOTAO} border-primary/40 text-primary hover:bg-primary/5 ${className ?? ""}`}
        title={`Abrir o Portal como este cliente, em modo de suporte (só leitura). ${resumoDoAcesso(portal)}.`}
      >
        {entrar.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <MonitorSmartphone className="h-3 w-3" />
        )}
        Painel
      </button>
    );
  }

  if (!temEmail) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onEnviarAcesso();
      }}
      className={`${BOTAO} border-primary/40 text-primary hover:bg-primary/5 ${className ?? ""}`}
      title={
        portal.estado === "CONVIDADO"
          ? `${resumoDoAcesso(portal)}. Reenviar o e-mail com o link para ele criar a senha.`
          : "Enviar o acesso ao Portal do Cliente"
      }
    >
      <KeyRound className="h-3 w-3" />
      {portal.estado === "CONVIDADO" ? "Reenviar acesso" : "Enviar acesso"}
    </button>
  );
}

/**
 * A mesma ação, no tamanho da barra de ações da FICHA do cliente (ADR-128).
 *
 * Existe separado do `AcessoPortalBotao` porque ali é um chip miúdo dentro de um card, e aqui é
 * um botão de comando ao lado de "Editar" e "Delegar tarefa" — mesma ação, peso visual diferente.
 * O que NÃO se duplica é a regra: os dois passam pelo mesmo `entrarNoPainelDoCliente`, e o
 * servidor é quem decide quem pode.
 */
export function PainelDoClienteBotao({ clienteId, portal }: { clienteId: string; portal: AcessoAoPortal }) {
  const entrar = trpc.auth.entrarNoPainelDoCliente.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (e) => toast(e.message),
  });
  return (
    <button
      onClick={() => entrar.mutate({ clienteId })}
      disabled={entrar.isPending}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/40 px-2.5 text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
      title={`Abrir o Portal como este cliente, em modo de suporte (só leitura). ${resumoDoAcesso(portal)}.`}
    >
      {entrar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorSmartphone className="h-4 w-4" />}
      Painel do cliente
    </button>
  );
}
