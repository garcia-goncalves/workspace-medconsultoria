import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { maskCpfCnpj } from "../../lib/masks";
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
};

const VAZIO: Form = {
  nome: "", tagline: "", site: "", siteUrl: "", email: "", telefone: "", cidade: "",
  instagram: "", instagramUrl: "", razaoSocial: "", cnpj: "", enderecoCompleto: "", foro: "",
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

  useEffect(() => {
    if (open && dados.data) {
      const d = dados.data;
      setForm({
        nome: d.nome, tagline: d.tagline, site: d.site, siteUrl: d.siteUrl, email: d.email,
        telefone: d.telefone, cidade: d.cidade, instagram: d.instagram, instagramUrl: d.instagramUrl,
        razaoSocial: d.razaoSocial ?? "", cnpj: d.cnpj ?? "",
        enderecoCompleto: d.enderecoCompleto ?? "", foro: d.foro ?? "",
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
          <Button disabled={!form.nome.trim() || salvar.isPending || dados.isLoading} onClick={() => salvar.mutate(form)}>
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
              <Label htmlFor="id-razao">Razão social</Label>
              <Input id="id-razao" value={form.razaoSocial} onChange={(e) => set("razaoSocial", e.target.value)} placeholder="Ex.: Med Consultoria em Gestão de Saúde LTDA" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="id-cnpj">CNPJ</Label>
                <MaskedInput id="id-cnpj" inputMode="numeric" format={maskCpfCnpj} value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="id-foro">Foro de eleição</Label>
                <Input id="id-foro" value={form.foro} onChange={(e) => set("foro", e.target.value)} placeholder="Ex.: da comarca de São Paulo/SP" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="id-endereco">Endereço completo (sede)</Label>
              <Textarea id="id-endereco" value={form.enderecoCompleto} onChange={(e) => set("enderecoCompleto", e.target.value)} placeholder="Rua, número, complemento, bairro, CEP" rows={2} />
            </div>
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Enquanto um campo jurídico ficar em branco, o contrato mostra um marcador <strong>[A PREENCHER]</strong> no lugar — nunca um dado inventado.</span>
            </p>
          </section>

          {salvar.error && <p className="text-sm text-destructive">{salvar.error.message}</p>}
        </div>
      )}
    </Modal>
  );
}
