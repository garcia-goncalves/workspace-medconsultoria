import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { plugarCaixaSchema, type PlugarCaixaInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";

export function AdicionarCaixaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<PlugarCaixaInput>({
    resolver: zodResolver(plugarCaixaSchema),
    defaultValues: { importarMeses: 3 },
  });

  const plugar = trpc.email.plugarCaixa.useMutation({
    onSuccess: () => {
      utils.email.caixas.invalidate();
      toast("Caixa conectada.", "success");
      reset();
      onClose();
    },
    // A mensagem vem pronta do servidor e distingue senha errada de servidor fora do ar.
    onError: (e) => toast(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar caixa de e-mail"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="caixa-form" disabled={plugar.isPending}>
            {plugar.isPending ? "Testando conexão…" : "Conectar"}
          </Button>
        </>
      }
    >
      <form
        id="caixa-form"
        onSubmit={(e) => {
          // O autofill do Chrome escreve no DOM sem disparar o evento que o react-hook-form
          // escuta — e este formulário é e-mail + senha, o alvo preferido do autofill. Sem
          // isto, "Conectar" manda o que o React lembrava (vazio) em vez do que está na tela.
          sincronizarAutofill(e, setValue, ["email", "senha", "nomeExibicao"]);
          void handleSubmit((v) => plugar.mutate(v))(e);
        }}
        className="space-y-3"
        noValidate
      >
        <div className="space-y-1">
          <Label htmlFor="cx-email" hint="O endereço completo, igual ao que você usa no webmail.">
            E-mail *
          </Label>
          <Input
            id="cx-email"
            type="email"
            autoComplete="off"
            placeholder="voce@medconsultoria.com.br"
            {...register("email")}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1">
          <Label
            htmlFor="cx-senha"
            hint="É a mesma senha que você usa para entrar no webmail. Ela fica guardada cifrada e nunca aparece em tela."
          >
            Senha da caixa *
          </Label>
          <Input id="cx-senha" type="password" autoComplete="new-password" {...register("senha")} />
          {errors.senha && <p className="text-xs text-destructive">{errors.senha.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cx-nome" hint="Nome que aparece para quem recebe seus e-mails.">
              Seu nome *
            </Label>
            <Input id="cx-nome" placeholder="André Cintra" {...register("nomeExibicao")} />
            {errors.nomeExibicao && <p className="text-xs text-destructive">{errors.nomeExibicao.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-rotulo" hint="Apelido para distinguir suas caixas na lista.">
              Apelido
            </Label>
            <Input id="cx-rotulo" placeholder="(opcional) Contato" {...register("rotulo")} />
          </div>
        </div>

        <div className="space-y-1">
          <Label
            htmlFor="cx-meses"
            hint="Quanto tempo para trás trazer na primeira sincronização. Quanto maior, mais demora a primeira vez."
          >
            Trazer os últimos (meses)
          </Label>
          <Input id="cx-meses" type="number" min={1} max={60} {...register("importarMeses")} />
        </div>

        <p className="rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Só você enxerga esta caixa. A senha é guardada cifrada e serve apenas para a aplicação
          buscar e enviar seus e-mails. Para cortar o acesso, troque a senha da caixa no painel da
          hospedagem.
        </p>
      </form>
    </Modal>
  );
}
