import { useState } from "react";
import { KeyRound, Mail, ShieldCheck, Trash2, Undo2, UserPlus, Users } from "lucide-react";
import {
  PORTAL_PAPEL_AJUDA,
  PORTAL_PAPEL_LABEL,
  PORTAL_PAPEIS,
  type PortalPapel,
} from "@app/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { data } from "../../lib/format-date";

/**
 * A LISTA DE PESSOAS DE UMA CLÍNICA — a mesma tela nos dois lados (ADR-131).
 *
 * A equipe da Med a vê na ficha do cliente; o responsável da clínica a vê no Portal dele. É um
 * componente só, de propósito: são a mesma lista, com as mesmas regras, e duas cópias
 * divergiriam no primeiro ajuste — a Thaís veria um estado e o cliente veria outro, sobre a
 * mesma pessoa.
 *
 * O que muda entre os dois lados são as CHAMADAS (uma rota interna, uma rota do Portal) e o
 * texto do cabeçalho. Por isso ele recebe as ações prontas em vez de chamar o servidor sozinho.
 */

export interface PessoaDaLista {
  id: string;
  nome: string;
  email: string;
  papel: PortalPapel | null;
  situacao: "ATIVO" | "CONVIDADO" | "REVOGADO";
  convidadoEm: Date | string;
  ultimoAcessoEm: Date | string | null;
  convidadoPor: string | null;
}

export interface AcoesSobrePessoas {
  convidar: (dados: { nome: string; email: string; papel: PortalPapel }) => void;
  alterarPapel: (dados: { pessoaId: string; papel: PortalPapel }) => void;
  revogar: (pessoaId: string) => void;
  devolver: (pessoaId: string) => void;
  reenviarConvite: (pessoaId: string) => void;
  ocupado: boolean;
}

const SELO: Record<
  PessoaDaLista["situacao"],
  { texto: string; variant: "success" | "warning" | "default" }
> = {
  ATIVO: { texto: "Entra no Portal", variant: "success" },
  CONVIDADO: { texto: "Convidado — ainda não entrou", variant: "warning" },
  REVOGADO: { texto: "Acesso revogado", variant: "default" },
};

function Linha({
  pessoa,
  acoes,
  souEu,
  podeEditar,
}: {
  pessoa: PessoaDaLista;
  acoes: AcoesSobrePessoas;
  souEu: boolean;
  podeEditar: boolean;
}) {
  const confirm = useConfirm();
  const selo = SELO[pessoa.situacao];
  const revogado = pessoa.situacao === "REVOGADO";

  const onRevogar = async () => {
    if (
      await confirm({
        title: "Revogar o acesso?",
        description: `${pessoa.nome} não conseguirá mais entrar no Portal. O histórico do que essa pessoa já fez continua guardado, e o acesso pode ser devolvido depois.`,
        confirmText: "Revogar acesso",
        variant: "destructive",
      })
    )
      acoes.revogar(pessoa.id);
  };

  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5 " +
        (revogado ? "bg-muted/40 opacity-75" : "bg-card")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{pessoa.nome}</span>
          {souEu && <span className="text-xs text-muted-foreground">(você)</span>}
          <Badge variant={pessoa.papel === "EQUIPE" ? "default" : "primary"}>
            {pessoa.papel === "EQUIPE" ? (
              <Users className="h-3 w-3" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            {PORTAL_PAPEL_LABEL[pessoa.papel ?? "RESPONSAVEL"]}
          </Badge>
          <Badge variant={selo.variant}>{selo.texto}</Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {pessoa.email}
          {pessoa.situacao === "ATIVO" && pessoa.ultimoAcessoEm && (
            <> · último acesso em {data(pessoa.ultimoAcessoEm)}</>
          )}
          {pessoa.situacao === "CONVIDADO" && <> · convidado em {data(pessoa.convidadoEm)}</>}
          {pessoa.convidadoPor && <> · quem deu acesso: {pessoa.convidadoPor}</>}
        </div>
      </div>

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!revogado && (
            <Select
              aria-label={`Papel de ${pessoa.nome}`}
              className="h-8 w-[9.5rem] text-xs"
              value={pessoa.papel ?? "RESPONSAVEL"}
              disabled={acoes.ocupado}
              onChange={(e) =>
                acoes.alterarPapel({ pessoaId: pessoa.id, papel: e.target.value as PortalPapel })
              }
            >
              {PORTAL_PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {PORTAL_PAPEL_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
          {pessoa.situacao === "CONVIDADO" && (
            <Button
              variant="outline"
              size="sm"
              disabled={acoes.ocupado}
              onClick={() => acoes.reenviarConvite(pessoa.id)}
              title="Mandar de novo o e-mail com o link para essa pessoa criar a senha"
            >
              <Mail className="h-3.5 w-3.5" /> Reenviar convite
            </Button>
          )}
          {revogado ? (
            <Button
              variant="outline"
              size="sm"
              disabled={acoes.ocupado}
              onClick={() => acoes.devolver(pessoa.id)}
              title="Devolver o acesso a essa pessoa"
            >
              <Undo2 className="h-3.5 w-3.5" /> Devolver acesso
            </Button>
          ) : (
            !souEu && (
              <Button
                variant="outline"
                size="sm"
                disabled={acoes.ocupado}
                onClick={onRevogar}
                className="text-destructive hover:bg-destructive/10"
                title="Tirar o acesso dessa pessoa ao Portal"
              >
                <Trash2 className="h-3.5 w-3.5" /> Revogar
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ConvidarModal({
  open,
  onClose,
  acoes,
  faltaResponsavel,
}: {
  open: boolean;
  onClose: () => void;
  acoes: AcoesSobrePessoas;
  /** Nenhuma pessoa ativa desta clínica fala por ela hoje. */
  faltaResponsavel: boolean;
}) {
  // ⚠️ O padrão MUDA conforme a clínica, e isto foi achado clicando: convidando a primeira
  // pessoa com "Equipe" pré-selecionado, a clínica terminava com um acesso que não pode aceitar
  // proposta nem contratar nada — e nada na tela dizia isso. Quando ninguém fala pela clínica,
  // quem está sendo convidado é o dono dela; depois disso, o normal é secretária e médico.
  const padrao: PortalPapel = faltaResponsavel ? "RESPONSAVEL" : "EQUIPE";
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<PortalPapel>(padrao);

  const fechar = () => {
    setNome("");
    setEmail("");
    setPapel(padrao);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Convidar alguém da clínica"
      footer={
        <>
          <Button variant="ghost" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            disabled={acoes.ocupado || nome.trim().length < 2 || !email.includes("@")}
            onClick={() => {
              acoes.convidar({ nome: nome.trim(), email: email.trim(), papel });
              fechar();
            }}
          >
            <UserPlus className="h-4 w-4" /> Enviar convite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          A pessoa recebe um e-mail com um link para criar a senha dela. Cada uma entra com o
          próprio e-mail — ninguém precisa dividir senha.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="pessoa-nome">Nome</Label>
          <Input
            id="pessoa-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Dra. Helena Martins Prado"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pessoa-email">E-mail</Label>
          <Input
            id="pessoa-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ex.: helena@clinica.com.br"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pessoa-papel" hint="O que essa pessoa vai poder fazer no Portal.">
            O que essa pessoa faz
          </Label>
          <Select
            id="pessoa-papel"
            value={papel}
            onChange={(e) => setPapel(e.target.value as PortalPapel)}
          >
            {PORTAL_PAPEIS.map((p) => (
              <option key={p} value={p}>
                {PORTAL_PAPEL_LABEL[p]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{PORTAL_PAPEL_AJUDA[papel]}</p>
        </div>
      </div>
    </Modal>
  );
}

export function PessoasDoPortal({
  pessoas,
  acoes,
  carregando,
  meuUserId,
  podeEditar = true,
  vazio,
}: {
  pessoas: PessoaDaLista[];
  acoes: AcoesSobrePessoas;
  carregando?: boolean;
  /** Quem está olhando, quando é alguém da própria clínica. A pessoa não se revoga sozinha. */
  meuUserId?: string;
  /** Falso para quem é `EQUIPE` no Portal: vê a lista, não mexe nela. */
  podeEditar?: boolean;
  /** O que dizer quando ninguém tem acesso ainda — o texto muda conforme quem está olhando. */
  vazio: string;
}) {
  const [convidando, setConvidando] = useState(false);

  if (carregando) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  // Mesma régua do servidor (`sobraResponsavel`): quem foi convidado e ainda não entrou CONTA,
  // porque é o dono da clínica no dia seguinte ao cadastro; quem foi revogado, não.
  const faltaResponsavel = !pessoas.some((p) => p.situacao !== "REVOGADO" && p.papel !== "EQUIPE");

  return (
    <div className="space-y-3">
      {pessoas.length > 0 && faltaResponsavel && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Ninguém aqui fala pela clínica. Sem um responsável, não dá para aceitar proposta nem
          contratar serviço pelo Portal — marque alguém como <strong>Responsável</strong> na
          lista abaixo.
        </p>
      )}

      {pessoas.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {vazio}
        </p>
      ) : (
        <div className="space-y-1.5">
          {pessoas.map((p) => (
            <Linha
              key={p.id}
              pessoa={p}
              acoes={acoes}
              souEu={p.id === meuUserId}
              podeEditar={podeEditar}
            />
          ))}
        </div>
      )}

      {podeEditar && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConvidando(true)}
          disabled={acoes.ocupado}
        >
          <UserPlus className="h-4 w-4" /> Convidar pessoa
        </Button>
      )}

      {!podeEditar && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          Só quem é responsável pela clínica pode convidar ou tirar o acesso de alguém.
        </p>
      )}

      {/* `key` força o formulário a renascer quando a clínica passa a ter (ou deixa de ter) um
          responsável: sem isso o papel padrão ficaria congelado no que valia na primeira vez. */}
      <ConvidarModal
        key={faltaResponsavel ? "sem-responsavel" : "com-responsavel"}
        open={convidando}
        onClose={() => setConvidando(false)}
        acoes={acoes}
        faltaResponsavel={faltaResponsavel}
      />
    </div>
  );
}
