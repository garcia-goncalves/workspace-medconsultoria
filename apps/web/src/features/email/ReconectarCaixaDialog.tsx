import { useRef } from "react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";

/**
 * Caixa que perdeu a senha guardada (senha trocada no webmail, ou EMAIL_CRYPTO_KEY rotacionada)
 * fica parada até alguém digitar a senha de novo. O `reconectarCaixa` já existia na API desde o
 * Bloco 1, mas nenhuma tela o chamava: a coluna só mostrava o aviso, sem saída.
 *
 * O campo é NÃO controlado de propósito: o autofill do Chrome escreve no DOM sem disparar o
 * evento que o React escuta, e este é justamente um formulário de senha (ver `form-autofill.ts`).
 * Lendo do ref no envio, o que vale é o que está na tela.
 */
export function ReconectarCaixaDialog({
  caixaId,
  email,
  onClose,
}: {
  caixaId: string | null;
  email: string;
  onClose: () => void;
}) {
  const senhaRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const reconectar = trpc.email.reconectarCaixa.useMutation({
    onSuccess: () => {
      utils.email.caixas.invalidate();
      utils.email.pastas.invalidate();
      toast("Caixa reconectada.", "success");
      onClose();
    },
    // A mensagem vem pronta do servidor e distingue senha recusada de servidor fora do ar.
    onError: (e) => toast(e.message),
  });

  return (
    <Modal
      open={!!caixaId}
      onClose={onClose}
      title="Reconectar caixa"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="reconectar-form" disabled={reconectar.isPending}>
            {reconectar.isPending ? "Testando conexão…" : "Reconectar"}
          </Button>
        </>
      }
    >
      <form
        id="reconectar-form"
        onSubmit={(e) => {
          e.preventDefault();
          const senha = senhaRef.current?.value ?? "";
          if (!caixaId || !senha) return;
          reconectar.mutate({ caixaId, senha });
        }}
        className="space-y-3"
        noValidate
      >
        <p className="text-sm text-muted-foreground">
          A senha guardada de <strong>{email}</strong> não funciona mais. Digite a senha atual da
          caixa para religar a sincronização.
        </p>

        <div className="space-y-1">
          <Label
            htmlFor="rc-senha"
            hint="É a mesma senha que você usa para entrar no webmail. Ela fica guardada cifrada e nunca aparece em tela."
          >
            Senha da caixa *
          </Label>
          <Input id="rc-senha" ref={senhaRef} type="password" autoComplete="new-password" />
        </div>
      </form>
    </Modal>
  );
}
