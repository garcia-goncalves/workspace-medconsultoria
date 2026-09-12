/**
 * QUEM, DENTRO DA CLÍNICA, PODE FAZER O QUÊ NO PORTAL.
 *
 * Uma clínica não é uma pessoa. Quem entra no Portal é o médico, a secretária, o
 * administrador — e antes disto todos entravam com a MESMA conta, o que tinha três efeitos
 * ruins ao mesmo tempo: a senha circulava no WhatsApp da clínica; o histórico dizia "a
 * Clínica X aceitou a proposta" sem saber quem foi; e a secretária tinha, sem querer, o
 * poder de cancelar um serviço contratado.
 *
 * A separação é entre **falar pela clínica** e **tocar o operacional**:
 *
 * | Papel         | Quem é                        | O que faz                                    |
 * | ------------- | ----------------------------- | -------------------------------------------- |
 * | `RESPONSAVEL` | dono, sócio, administrador    | tudo — inclusive aceitar proposta e cancelar |
 * | `EQUIPE`      | médico, secretária, recepção  | o dia a dia: documento, briefing, suporte    |
 *
 * ⚠️ **A trava é sobre ASSINAR, não sobre VER.** Os dois papéis leem tudo o que o Portal
 * mostra daquela clínica, valores inclusive — é a mesma escolha da ADR-128 para a sessão de
 * suporte da equipe da Med. Esconder número da secretária resolveria um problema que
 * ninguém relatou e criaria um que morde toda semana: ela não conseguiria conferir a
 * cobrança que é justamente o trabalho dela.
 *
 * ⚠️ **A lista abaixo é de LIBERAÇÕES, e o padrão é NEGAR.** É o inverso do que parece
 * natural, e é de propósito, pela lição da ADR-128: numa lista de proibições, a ação que
 * alguém esquecer de proibir é justamente a que vai morder. Aqui, ação nova nasce fechada —
 * quem escrever a próxima precisa decidir conscientemente que a secretária pode.
 */

/** Papel de uma pessoa DENTRO da clínica. Espelha o enum `PortalPapel` do Prisma. */
export const PORTAL_PAPEIS = ["RESPONSAVEL", "EQUIPE"] as const;
export type PortalPapel = (typeof PORTAL_PAPEIS)[number];

export const PORTAL_PAPEL_LABEL: Record<PortalPapel, string> = {
  RESPONSAVEL: "Responsável",
  EQUIPE: "Equipe",
};

/** Explicação de uma linha, para o "?" ao lado do campo na tela. */
export const PORTAL_PAPEL_AJUDA: Record<PortalPapel, string> = {
  RESPONSAVEL:
    "Fala pela clínica: aceita proposta, contrata e cancela serviço, e convida outras pessoas.",
  EQUIPE:
    "Vê tudo e cuida do dia a dia: envia documento, responde formulário e fala com o suporte. Não assina nada pela clínica.",
};

/**
 * As ações do Portal que a EQUIPE também pode fazer. Tudo que não estiver aqui é do
 * RESPONSAVEL — inclusive o que ainda não foi escrito.
 *
 * O nome de cada ação é o caminho tRPC sem o prefixo `portal.` (ex.: `briefing.salvar`),
 * que é o mesmo texto que o middleware do servidor recebe. Um nome só, sem tradução no meio,
 * porque tradução no meio é onde as duas listas divergem.
 */
export const ACOES_LIBERADAS_PARA_EQUIPE = [
  // Dados cadastrais da clínica: telefone, endereço, contato. Reversível, sem dinheiro, e é
  // literalmente o trabalho da secretária.
  "atualizarMeusDados",
  // Agenda: confirmar presença numa reunião marcada não compromete a clínica com nada.
  "confirmarReuniao",
  // Documentos e formulários que a clínica ENVIA para a Med — a papelada do credenciamento.
  // `briefing.salvar` cobre rascunho E envio (o `enviar` é um campo do próprio input).
  "briefing.salvar",
  "removerArquivo",
  // Suporte: falar com a gente nunca pode depender de achar o dono da clínica.
  "suporte.abrir",
  "suporte.enviar",
] as const;

export type AcaoDoPortal = (typeof ACOES_LIBERADAS_PARA_EQUIPE)[number] | (string & {});

/**
 * Pode esta pessoa executar esta ação do Portal?
 *
 * `papel` nulo é tratado como RESPONSAVEL: são as contas que existiam antes desta regra —
 * uma conta só por clínica, que sempre pôde tudo. Rebaixá-las em silêncio tiraria o poder de
 * assinar de quem já assinava, e a clínica descobriria isso na hora de aceitar uma proposta.
 */
export function podeNoPortal(papel: PortalPapel | null | undefined, acao: AcaoDoPortal): boolean {
  if (papel !== "EQUIPE") return true;
  return (ACOES_LIBERADAS_PARA_EQUIPE as readonly string[]).includes(acao);
}

/** A recusa, escrita para o médico ou a secretária ler — nunca "FORBIDDEN". */
export const PORTAL_SO_RESPONSAVEL =
  "Só o responsável pela clínica pode fazer isso. Peça a quem administra a conta, ou fale com a nossa equipe.";

/** A recusa quando se tenta deixar a clínica sem ninguém que possa assinar. */
export const PORTAL_PRECISA_DE_UM_RESPONSAVEL =
  "A clínica precisa de pelo menos um responsável com acesso ativo. Promova outra pessoa antes de fazer isso.";

/**
 * Sobraria alguém que fala pela clínica depois desta mudança?
 *
 * Pura porque a mesma pergunta é feita em três momentos — revogar, rebaixar e desativar —
 * e três cópias divergiriam no primeiro ajuste. Recebe as contas COMO ESTÃO HOJE mais a
 * mudança pretendida, e responde sobre o depois.
 *
 * "Vale como responsável" exige conta ATIVA: uma conta desativada não abre a porta, e um
 * responsável que não consegue entrar não é um responsável.
 * Conta ainda sem senha (convite não aceito) VALE — senão a clínica em que o dono foi
 * convidado e ainda não entrou ficaria travada, sem poder convidar mais ninguém.
 */
export function sobraResponsavel(
  contas: { id: string; papel: PortalPapel | null; ativo: boolean }[],
  mudanca: { id: string; papel?: PortalPapel | null; ativo?: boolean },
): boolean {
  return contas.some((c) => {
    const depois =
      c.id === mudanca.id
        ? {
            papel: mudanca.papel === undefined ? c.papel : mudanca.papel,
            ativo: mudanca.ativo ?? c.ativo,
          }
        : c;
    return depois.ativo && depois.papel !== "EQUIPE";
  });
}

/**
 * QUEM PODE ASSINAR / ACEITAR PELA CLÍNICA — a trava que faltava nas páginas de token.
 *
 * A página de proposta (`/proposta/:token`) e a de assinatura (`/assinar/:token`) são
 * PÚBLICAS de propósito: quem assina costuma clicar num link de e-mail sem nunca ter entrado
 * no sistema, e o token — 256 bits, sorteado — é a credencial. Isso continua valendo.
 *
 * O buraco não estava no anônimo: estava em quem chega ali **já logado**. O Portal entregava
 * o token no resumo da página inicial, então a secretária EQUIPE (ADR-131) e a sessão de
 * suporte da Med (ADR-128) — as duas barradas de assinar pelo `portalProcedure` — davam a
 * volta pela rota pública e assinavam o contrato mesmo assim. As duas travas existiam e
 * nenhuma das duas cobria o caminho que realmente assina.
 *
 * A regra, então, é sobre a SESSÃO, não sobre o token:
 *
 * | Quem está logado                   | Pode? | Por quê                                        |
 * | ---------------------------------- | ----- | ---------------------------------------------- |
 * | ninguém (link de e-mail)           | sim   | é o caminho normal de quem assina               |
 * | sessão de suporte da Med           | não   | "vê tudo, não assina nada" (ADR-128)            |
 * | conta EQUIPE da clínica            | não   | não fala pela clínica (ADR-131)                 |
 * | responsável, ou conta interna      | sim   | é quem a regra já autorizava                    |
 *
 * ⚠️ **Conta interna da Med logada NÃO é barrada, e é deliberado.** Ela já alcança o token pelo
 * painel do documento e assina com o próprio nome. O que a ADR-128 barra é agir **como o
 * cliente**, e isso continua barrado — e agora fica atribuído, pelo `assinadoPorId`.
 *
 * Devolve a CHAVE do motivo, não a frase: a frase da sessão de suporte mora no servidor, e
 * duas cópias do mesmo texto divergem no primeiro ajuste.
 */
export type MotivoSemAssinar = "SUPORTE_SO_LEITURA" | "SO_RESPONSAVEL";

/**
 * O pedaço da sessão que esta régua lê. `operador` é tipado como OBJETO, não `unknown`: com
 * `unknown` o compilador aceitaria `operador: ""` ou `0`, que a guarda deixaria passar por serem
 * falsy — e a trava sumiria em silêncio.
 */
export interface SessaoQueAssina {
  papelPortal?: PortalPapel | null;
  operador?: { id: string; nome?: string } | null;
}

export function podeAssinarPelaClinica(
  sessao: SessaoQueAssina | null | undefined,
): { pode: true } | { pode: false; motivo: MotivoSemAssinar } {
  if (!sessao) return { pode: true };
  if (sessao.operador) return { pode: false, motivo: "SUPORTE_SO_LEITURA" };
  if (sessao.papelPortal === "EQUIPE") return { pode: false, motivo: "SO_RESPONSAVEL" };
  return { pode: true };
}

/**
 * PODE ESTA SESSÃO EXECUTAR ESTA AÇÃO DO PORTAL? — a régua ÚNICA, lida pela tela E pelo servidor.
 *
 * As duas condições já existiam, mas viviam soltas dentro do middleware do servidor: a sessão
 * de suporte da Med (ADR-128, "vê tudo e não assina nada") e o papel EQUIPE (ADR-131). Funcionava
 * — e a tela não sabia de nada. A secretária via quatro botões que o servidor ia recusar
 * ("Não tenho mais interesse", "Quero retomar", "Solicitar" e "Cancelar serviço"), clicava,
 * confirmava num modal e só então levava um "sem permissão".
 *
 * ⚠️ **Esconder o botão na tela sem trazer o servidor para a mesma função seria pior que o
 * problema.** Seriam duas réguas para a mesma pergunta, e a primeira vez que alguém liberasse
 * uma ação nova em `ACOES_LIBERADAS_PARA_EQUIPE` sem lembrar da tela, a tela esconderia um botão
 * que o servidor aceita — o modo de falha da ADR-133, de novo. Por isso o servidor passou a
 * chamar esta função, e a matriz de decisão dele é a mesma de antes, linha por linha.
 *
 * Devolve a CHAVE do motivo, não a frase: a frase de cada ponta é diferente de propósito (a tela
 * diz "Só o responsável pela clínica cancela", ao lado do botão que sumiu; o servidor devolve a
 * recusa completa, que pode chegar por API).
 */
export function podeAgirNoPortal(
  sessao: SessaoQueAssina,
  acao: AcaoDoPortal,
): { pode: true } | { pode: false; motivo: MotivoSemAssinar } {
  if (sessao.operador) return { pode: false, motivo: "SUPORTE_SO_LEITURA" };
  if (!podeNoPortal(sessao.papelPortal, acao)) return { pode: false, motivo: "SO_RESPONSAVEL" };
  return { pode: true };
}
