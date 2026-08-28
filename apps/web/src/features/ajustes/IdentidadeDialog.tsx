import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { maskCNPJ } from "../../lib/masks";
import { Modal } from "../../components/ui/modal";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { MaskedInput } from "../../components/ui/masked-input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";

/** Campos do formulário (tudo string na tela; o backend normaliza vazio→null nos jurídicos). */
type Form = {
  nome: string;
  tagline: string;
  site: string;
  siteUrl: string;
  email: string;
  telefone: string;
  cidade: string;
  instagram: string;
  instagramUrl: string;
  razaoSocial: string;
  cnpj: string;
  enderecoCompleto: string;
  foro: string;
  bancoNome: string;
  bancoAgencia: string;
  bancoConta: string;
  bancoTitular: string;
  pixChave: string;
  credenciamentoPrazoDias: string;
  retencaoCorpoEmailDias: string;
  retencaoAcervoAnos: string;
  encarregadoNome: string;
  encarregadoEmail: string;
};

const VAZIO: Form = {
  nome: "", tagline: "", site: "", siteUrl: "", email: "", telefone: "", cidade: "",
  instagram: "", instagramUrl: "", razaoSocial: "", cnpj: "", enderecoCompleto: "", foro: "",
  bancoNome: "", bancoAgencia: "", bancoConta: "", bancoTitular: "", pixChave: "",
  credenciamentoPrazoDias: "60",
  retencaoCorpoEmailDias: "180", retencaoAcervoAnos: "5", encarregadoNome: "", encarregadoEmail: "",
};

/**
 * Dados da empresa (Ajustes → Administração). A Thaís edita aqui a identidade que alimenta
 * contratos, propostas e e-mails — inclusive os dados jurídicos (razão social, CNPJ, endereço,
 * foro) que antes ficavam engessados no código. Nada é inventado: os jurídicos começam vazios e,
 * enquanto vazios, o contrato mostra um marcador "[A PREENCHER]" em vez de um dado falso.
 */
export function IdentidadeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const dados = trpc.identidade.get.useQuery(undefined, { enabled: open });
  const [form, setForm] = useState<Form>(VAZIO);
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // O prazo é o único campo numérico daqui. Barrar no botão (e explicar embaixo do campo)
  // evita a pessoa preencher o formulário inteiro e descobrir o erro só ao salvar.
  const prazo = Number(form.credenciamentoPrazoDias);
  const prazoValido = Number.isInteger(prazo) && prazo >= 1 && prazo <= 365;

  // Prazos de guarda da LGPD (ADR-141). Mesmo tratamento do prazo acima: barra no botão e
  // explica embaixo do campo, em vez de deixar a pessoa descobrir o erro só ao salvar.
  const guardaEmail = Number(form.retencaoCorpoEmailDias);
  const guardaEmailValida = Number.isInteger(guardaEmail) && guardaEmail >= 30 && guardaEmail <= 3650;
  const guardaAcervo = Number(form.retencaoAcervoAnos);
  const guardaAcervoValida = Number.isInteger(guardaAcervo) && guardaAcervo >= 1 && guardaAcervo <= 10;

  useEffect(() => {
    if (open && dados.data) {
      const d = dados.data;
      setForm({
        nome: d.nome, tagline: d.tagline, site: d.site, siteUrl: d.siteUrl, email: d.email,
        telefone: d.telefone, cidade: d.cidade, instagram: d.instagram, instagramUrl: d.instagramUrl,
        razaoSocial: d.razaoSocial ?? "", cnpj: d.cnpj ?? "",
        enderecoCompleto: d.enderecoCompleto ?? "", foro: d.foro ?? "",
        bancoNome: d.bancoNome ?? "", bancoAgencia: d.bancoAgencia ?? "",
        bancoConta: d.bancoConta ?? "", bancoTitular: d.bancoTitular ?? "",
        pixChave: d.pixChave ?? "",
        credenciamentoPrazoDias: String(d.credenciamentoPrazoDias ?? 60),
        retencaoCorpoEmailDias: String(d.retencaoCorpoEmailDias ?? 180),
        retencaoAcervoAnos: String(d.retencaoAcervoAnos ?? 5),
        encarregadoNome: d.encarregadoNome ?? "", encarregadoEmail: d.encarregadoEmail ?? "",
      });
    }
  }, [open, dados.data]);

  const salvar = trpc.identidade.atualizar.useMutation({
    onSuccess: () => {
      utils.identidade.get.invalidate();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dados da empresa"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!form.nome.trim() || !prazoValido || !guardaEmailValida || !guardaAcervoValida || salvar.isPending || dados.isLoading}
            onClick={() =>
              salvar.mutate({
                ...form,
                credenciamentoPrazoDias: Number(form.credenciamentoPrazoDias),
                retencaoCorpoEmailDias: Number(form.retencaoCorpoEmailDias),
                retencaoAcervoAnos: Number(form.retencaoAcervoAnos),
              })
            }
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </>
      }
    >
      {dados.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Marca e contato */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Marca e contato</h3>
              <p className="text-xs text-muted-foreground">Aparece em documentos, propostas e e-mails para o cliente.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-nome">Nome / marca</Label>
              <Input id="id-nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="MedConsultoria" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-tagline">Frase de posicionamento</Label>
              <Input id="id-tagline" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Gestão estratégica para clínicas e consultórios" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-email">E-mail comercial</Label>
                <Input id="id-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="comercial@medconsultoria.com.br" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-tel">Telefone</Label>
                <Input id="id-tel" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} placeholder="(11) 90000-0000" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-site">Site (texto)</Label>
                <Input id="id-site" value={form.site} onChange={(e) => set("site", e.target.value)} placeholder="medconsultoria.com.br" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-siteurl">Site (link)</Label>
                <Input id="id-siteurl" value={form.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="https://medconsultoria.com.br" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-cidade">Cidade</Label>
                <Input id="id-cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} placeholder="São Paulo, SP" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-insta">Instagram</Label>
                <Input id="id-insta" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@med.consultoria" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-instaurl">Instagram (link)</Label>
              <Input id="id-instaurl" value={form.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} placeholder="https://instagram.com/med.consultoria" />
            </div>
          </section>

          {/* Dados jurídicos */}
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Dados jurídicos (para contratos)</h3>
              <p className="text-xs text-muted-foreground">Entram na qualificação da CONTRATADA nos contratos. Deixe em branco o que ainda não tiver.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-razao" hint="Nome oficial da empresa, o mesmo que consta no CNPJ.">Razão social</Label>
              <Input id="id-razao" value={form.razaoSocial} onChange={(e) => set("razaoSocial", e.target.value)} placeholder="Ex.: Med Consultoria em Gestão de Saúde LTDA" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-cnpj" hint="CNPJ da empresa, usado na qualificação da CONTRATADA nos contratos.">CNPJ</Label>
                <MaskedInput id="id-cnpj" inputMode="numeric" format={maskCNPJ} value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-foro" hint="Comarca escolhida para resolver disputas do contrato, ex.: da comarca de São Paulo/SP.">Foro de eleição</Label>
                <Input id="id-foro" value={form.foro} onChange={(e) => set("foro", e.target.value)} placeholder="Ex.: da comarca de São Paulo/SP" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-endereco" hint="Endereço da sede da empresa, como aparece nos contratos.">Endereço completo (sede)</Label>
              <Textarea id="id-endereco" value={form.enderecoCompleto} onChange={(e) => set("enderecoCompleto", e.target.value)} placeholder="Rua, número, complemento, bairro, CEP" rows={2} />
            </div>
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Enquanto um campo jurídico ficar em branco, o contrato mostra um marcador <strong>[A PREENCHER]</strong> no lugar — nunca um dado inventado.</span>
            </p>
          </section>

          {/* Dados para pagamento (ADR-127) */}
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Dados para pagamento</h3>
              <p className="text-xs text-muted-foreground">
                Saem no fim das propostas, para o cliente saber onde pagar. A proposta de
                credenciamento não os mostra — ali a cobrança só nasce quando a operadora aprova.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="id-banco">Banco</Label>
                <Input id="id-banco" value={form.bancoNome} onChange={(e) => set("bancoNome", e.target.value)} placeholder="Ex.: Nubank" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-agencia">Agência</Label>
                <Input id="id-agencia" value={form.bancoAgencia} onChange={(e) => set("bancoAgencia", e.target.value)} placeholder="0001" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-conta">Conta</Label>
                <Input id="id-conta" value={form.bancoConta} onChange={(e) => set("bancoConta", e.target.value)} placeholder="00000000-0" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-titular" hint="Nome de quem recebe, como está cadastrado no banco.">Titular da conta</Label>
                <Input id="id-titular" value={form.bancoTitular} onChange={(e) => set("bancoTitular", e.target.value)} placeholder="Ex.: Thais Garcia Gestão Saúde" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-pix" hint="A chave que o cliente usa para pagar por PIX — pode ser o CNPJ, um e-mail ou um telefone.">Chave PIX</Label>
                <Input id="id-pix" value={form.pixChave} onChange={(e) => set("pixChave", e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Campo em branco simplesmente não aparece na proposta. Com os cinco em branco, a
                seção inteira some — melhor faltar do que sair pela metade na frente do cliente.
              </span>
            </p>
          </section>

          {/* Credenciamento */}
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Credenciamento</h3>
              <p className="text-xs text-muted-foreground">Como o Painel de Credenciamentos decide o que já demorou.</p>
            </div>
            <div className="space-y-1.5 sm:max-w-xs">
              <Label
                htmlFor="id-prazo"
                hint="Depois desse tempo sem andar, o credenciamento aparece marcado no painel e entra na contagem de 'precisam de atenção'. Não dispara e-mail nenhum: só chama a sua atenção."
              >
                Avisar quando parar por mais de (dias)
              </Label>
              <Input
                id="id-prazo"
                inputMode="numeric"
                value={form.credenciamentoPrazoDias}
                onChange={(e) => set("credenciamentoPrazoDias", e.target.value.replace(/\D/g, ""))}
                placeholder="60"
              />
              {prazoValido ? (
                <p className="text-xs text-muted-foreground">
                  Hoje: {prazo} dias. O padrão é 60, o prazo com que a Thaís trabalha.
                </p>
              ) : (
                <p className="text-xs text-destructive">Informe um número de 1 a 365.</p>
              )}
            </div>
          </section>

          {/* Privacidade e prazos de guarda (LGPD — ADR-141) */}
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Privacidade e prazos de guarda</h3>
              <p className="text-xs text-muted-foreground">
                O que a página pública de privacidade promete, e o que o sistema cumpre sozinho.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="id-guarda-email"
                  hint="Depois desse prazo, o TEXTO dos e-mails enviados é apagado sozinho, todo dia. O registro de para quem foi, o assunto, a data e se chegou continuam — é disso que o monitor de e-mails precisa."
                >
                  Guardar o texto dos e-mails por (dias)
                </Label>
                <Input
                  id="id-guarda-email"
                  inputMode="numeric"
                  value={form.retencaoCorpoEmailDias}
                  onChange={(e) => set("retencaoCorpoEmailDias", e.target.value.replace(/\D/g, ""))}
                  placeholder="180"
                />
                {guardaEmailValida ? (
                  <p className="text-xs text-muted-foreground">Hoje: {guardaEmail} dias (padrão 180, cerca de 6 meses).</p>
                ) : (
                  <p className="text-xs text-destructive">Informe um número de 30 a 3650.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="id-guarda-acervo"
                  hint="Depois desse tempo do fim do contrato, o acervo de credenciamento daquele cliente aparece marcado como vencido. NADA é apagado sozinho: quem decide apagar o diploma de um médico é você."
                >
                  Avisar sobre o acervo de credenciamento após (anos)
                </Label>
                <Input
                  id="id-guarda-acervo"
                  inputMode="numeric"
                  value={form.retencaoAcervoAnos}
                  onChange={(e) => set("retencaoAcervoAnos", e.target.value.replace(/\D/g, ""))}
                  placeholder="5"
                />
                {guardaAcervoValida ? (
                  <p className="text-xs text-muted-foreground">Hoje: {guardaAcervo} anos (padrão 5, alinhado à guarda fiscal).</p>
                ) : (
                  <p className="text-xs text-destructive">Informe um número de 1 a 10.</p>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-dpo-nome" hint="A pessoa indicada para responder sobre dados pessoais. Em branco, a página mostra só o e-mail comercial.">
                  Encarregado de dados (nome)
                </Label>
                <Input id="id-dpo-nome" value={form.encarregadoNome} onChange={(e) => set("encarregadoNome", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-dpo-email" hint="Para onde vão os pedidos de acesso, correção e eliminação de dados. Em branco, usa o e-mail comercial acima.">
                  Encarregado de dados (e-mail)
                </Label>
                <Input id="id-dpo-email" value={form.encarregadoEmail} onChange={(e) => set("encarregadoEmail", e.target.value)} />
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Estes prazos aparecem na página pública <strong>/privacidade</strong>, que todo cliente
                pode ler. Mudá-los muda o que a empresa promete — o sistema cumpre exatamente o que
                estiver aqui.
              </span>
            </p>
          </section>

          {salvar.error && <p className="text-sm text-destructive">{salvar.error.message}</p>}
        </div>
      )}
    </Modal>
  );
}
