/**
 * A ESTIMATIVA DO NEGÓCIO NO FUNIL — qual pergunta faz sentido para estes serviços.
 *
 * O funil sempre exigiu "Registrar o valor estimado da oportunidade" como passo obrigatório da
 * Qualificação. Só que o **Faturamento de contas médicas não tem valor fixo**: a Med ganha um
 * percentual sobre o que a clínica fatura. O passo travava a etapa pedindo um número que não
 * existe, e quem digitava um valor qualquer para destravar sujava o relatório.
 *
 * A regra aqui não cita "Faturamento" em lugar nenhum — ela lê o PREÇO dos serviços escolhidos.
 * Hoje isso só alcança o Faturamento (é o único serviço 100% percentual), e continua correta se
 * amanhã a Thaís criar outro. Casar por NOME é a fragilidade que já existe no credenciamento;
 * não vale repeti-la.
 *
 * O credenciamento fica FORA da conta, pelo mesmo motivo que já o tira do provisionamento da
 * conversão (ADR-104/108): o honorário dele só nasce quando a operadora aprova. Duas regras sobre
 * o mesmo dinheiro têm de concordar — daí `ehServicoDeCredenciamento` morar aqui, no pacote
 * compartilhado, e não em cada lado.
 *
 * Função pura (sem I/O, sem Prisma) porque a MESMA resposta é necessária nos dois lados: o
 * servidor decide o passo obrigatório, e a tela decide qual campo mostrar. Duas implementações
 * discordariam no primeiro caso de borda.
 */

/**
 * O nome do credenciamento no catálogo semeado. Serve para SEMEAR e para o backfill da
 * migração `20260829203721` — nunca para decidir regra de dinheiro em tempo de execução.
 * Quem decide é a marca `Servico.ehCredenciamento`; ver `ehServicoDeCredenciamento`.
 */
export const NOME_SERVICO_CREDENCIAMENTO = "Credenciamento médico e odontológico";

/**
 * Este serviço é o credenciamento? (honorário só no sucesso — fora de toda estimativa)
 *
 * ⚠️ LÊ A MARCA, NUNCA O NOME. Até a ADR-140 isto comparava `nome` com a constante acima, e a
 * ADR chamou o arranjo de remendo assumido: corrigir um typo em Ajustes → Serviços religava a
 * cobrança antecipada, e o cliente era cobrado na conversão do lead E de novo na aprovação da
 * operadora. As duas metades dessa porta estão travadas por teste
 * (`conversao-provisao-financeira.test.ts`): nome mudado não desliga a regra, nome copiado não
 * a liga.
 *
 * O parâmetro exige o campo de propósito — assim o compilador cobra o `select` de quem
 * escrever a próxima consulta. Esquecer de selecionar devolveria `false` calado, que é
 * justamente o lado que cobra cedo demais.
 */
export function ehServicoDeCredenciamento(servico: { ehCredenciamento: boolean } | null | undefined): boolean {
  return servico?.ehCredenciamento === true;
}

/**
 * O nome do faturamento médico no catálogo semeado. Serve para SEMEAR — nunca para decidir
 * regra de dinheiro em tempo de execução. Quem decide é a marca `Servico.ehFaturamento`.
 */
export const NOME_SERVICO_FATURAMENTO = "Faturamento";

/**
 * Este serviço é o faturamento médico — o ÚNICO que pode ser cobrado por percentual?
 *
 * Ordem do dono (31/08/2026): a Med recebe percentual do que a clínica fatura **somente** no
 * faturamento médico. Todo o resto do catálogo é valor fixo, avulso ou mensal — inclusive o
 * credenciamento, que é valor fixo cobrado só quando a operadora aprova (ADR-104/108).
 *
 * ⚠️ LÊ A MARCA, NUNCA A CATEGORIA. `categoria === "Faturamento"` já foi escrita e removida
 * CINCO vezes neste código (ADR-125/126/127/137/138): bastava renomear a categoria na tela ao
 * lado para a forma de cobrança mudar em silêncio. O parâmetro exige o campo de propósito, para
 * o compilador cobrar o `select` de quem escrever a próxima consulta — esquecê-lo devolveria
 * `false` calado, e `false` aqui é "este serviço não pode ter percentual".
 *
 * ⚠️ NÃO CONFUNDIR COM `ehServicoSomentePercentual`, que responde outra pergunta. Esta diz
 * QUEM PODE ser percentual (identidade, vem do banco); aquela diz COMO ESTA LINHA está sendo
 * cobrada (preço, vem do registro). Trocar uma pela outra faria a linha de uma proposta antiga
 * mudar de forma sozinha.
 */
export function ehServicoDeFaturamento(servico: { ehFaturamento: boolean } | null | undefined): boolean {
  return servico?.ehFaturamento === true;
}

/**
 * PERCENTUAL EM SERVIÇO QUE NÃO É O FATURAMENTO — a trava que faltava.
 *
 * Devolve `true` quando o estado é proibido: há percentual a cobrar e o serviço não é o
 * faturamento médico. Os quatro lugares que gravam preço (os dois schemas de serviço, a
 * contratação do cliente e as duas telas) leem esta mesma função; quatro cópias divergiriam, e
 * a divergência apareceria como um serviço que a tela mostra por percentual e o servidor grava
 * como valor fixo.
 */
export function percentualForaDoFaturamento(p: PrecoDoServico, ehFaturamento: boolean | null | undefined): boolean {
  return temPercentual(p) && ehFaturamento !== true;
}

/** A recusa, escrita para a Thaís ler — nunca "validation error". */
export const PRECO_PERCENTUAL_SO_NO_FATURAMENTO =
  "Só o serviço de faturamento médico é cobrado por percentual. Os demais têm valor fixo (avulso ou mensal). Para cobrar este por percentual, marque-o antes como o serviço de faturamento médico, em Ajustes → Serviços.";

/** A recusa de marcar um segundo serviço, ou de marcar o mesmo serviço como as duas coisas. */
export const MARCA_FATURAMENTO_UNICA = (nomeJaMarcado: string) =>
  `Já existe um serviço marcado como faturamento médico: "${nomeJaMarcado}". Só pode haver um — desmarque aquele antes de marcar este.`;

export const MARCA_FATURAMENTO_E_CREDENCIAMENTO =
  "Um serviço não pode ser o faturamento médico e o credenciamento ao mesmo tempo: um é cobrado por percentual todo mês, o outro é valor fixo pago só quando a operadora aprova.";

/**
 * A recusa de dois serviços com o mesmo nome.
 *
 * O nome do serviço não é só rótulo: a semeadura do catálogo casa por NOME
 * (`semearCatalogoSeFaltar`), e a tela de proposta lista os dois lado a lado sem nada que os
 * distinga. Com duas linhas iguais ninguém sabe qual leva o preço, as exigências e o roteiro do
 * projeto — e o erro só aparece no papel que já foi para o cliente.
 */
export const NOME_DE_SERVICO_DUPLICADO = (nomeExistente: string) =>
  `Já existe um serviço chamado "${nomeExistente}". Dois serviços com o mesmo nome ficam impossíveis de distinguir na proposta e na ficha do cliente — escolha outro nome, ou edite o que já existe. (Maiúsculas e acentos não contam como diferença.)`;

/** Um serviço do lead, só com o que decide a estimativa. */
export interface ServicoParaEstimativa {
  nome: string | null;
  valor: number | null;
  percentual: number | null;
  /** A marca do credenciamento (`Servico.ehCredenciamento`) — ver `ehServicoDeCredenciamento`. */
  ehCredenciamento: boolean;
}

/**
 * `VALOR_FIXO` — a pergunta é "quanto você espera fechar?" (o comportamento de sempre).
 * `PERCENTUAL` — a pergunta é "quanto o cliente fatura por mês?", e o valor sai da conta.
 */
export type ModoEstimativa = "VALOR_FIXO" | "PERCENTUAL";

export interface EstimativaDoLead {
  modo: ModoEstimativa;
  /** Soma dos percentuais dos serviços percentuais (ex.: 5 = 5%). Zero no modo VALOR_FIXO. */
  percentualTotal: number;
  /** Faturamento × percentual, com 2 casas. `null` quando não dá para calcular ainda. */
  valorEstimadoCalculado: number | null;
}

/** Título do passo automático em cada modo — o servidor grava, a tela lê. */
export const TITULO_PASSO_VALOR = "Registrar o valor estimado da oportunidade";
export const TITULO_PASSO_FATURAMENTO = "Registrar o faturamento mensal estimado do cliente";

/** Arredonda para centavos sem o erro clássico de ponto flutuante. */
function emCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Decide a pergunta e, no modo percentual, calcula o valor do negócio.
 *
 * Ordem das guardas, e o porquê de cada uma:
 *  - **qualquer serviço com valor fixo → VALOR_FIXO.** No caso misturado (Faturamento + Gestão
 *    Operacional) há dinheiro fixo em jogo, e a estimativa segue sendo a pergunta certa. Deixar
 *    o modo percentual vencer aqui esconderia o valor fixo do relatório.
 *  - **nenhum fixo, mas há percentual → PERCENTUAL.** É o caso do Faturamento sozinho.
 *  - **nada com preço (nenhum serviço escolhido, ou só credenciamento) → VALOR_FIXO.** Mantém o
 *    comportamento de hoje: o passo continua pedindo a estimativa, e a conversão já sabe não
 *    provisionar credenciamento.
 */
export function planejarEstimativaDoLead(
  servicos: ServicoParaEstimativa[],
  faturamentoMensal: number | null | undefined,
): EstimativaDoLead {
  let temFixo = false;
  let percentualTotal = 0;

  for (const s of servicos) {
    if (ehServicoDeCredenciamento(s)) continue;
    if (s.valor != null && s.valor > 0) temFixo = true;
    if (s.percentual != null && s.percentual > 0) percentualTotal += s.percentual;
  }

  if (temFixo || percentualTotal <= 0) {
    return { modo: "VALOR_FIXO", percentualTotal: 0, valorEstimadoCalculado: null };
  }

  const base = faturamentoMensal ?? 0;
  return {
    modo: "PERCENTUAL",
    percentualTotal: emCentavos(percentualTotal),
    valorEstimadoCalculado: base > 0 ? emCentavos((base * percentualTotal) / 100) : null,
  };
}

/** O título que o passo automático da Qualificação deve ter, dado o modo. */
export function tituloDoPassoDeEstimativa(modo: ModoEstimativa): string {
  return modo === "PERCENTUAL" ? TITULO_PASSO_FATURAMENTO : TITULO_PASSO_VALOR;
}

/** Só o preço, como o catálogo (ou o item da proposta) o define. */
export interface PrecoDoServico {
  valor: number | null | undefined;
  percentual: number | null | undefined;
}

/** Este serviço tem um valor fixo (avulso ou mensal) a cobrar? */
export function temValorFixo(p: PrecoDoServico): boolean {
  return p.valor != null && p.valor > 0;
}

/** Este serviço cobra um percentual do faturamento do cliente? */
export function temPercentual(p: PrecoDoServico): boolean {
  return p.percentual != null && p.percentual > 0;
}

/**
 * Este serviço é cobrado **exclusivamente** por percentual — não tem valor, não tem quantidade
 * e é sempre mensal.
 *
 * É a MESMA pergunta que `planejarEstimativaDoLead` faz no funil, aplicada agora à linha da
 * proposta: quem decide é o PREÇO, nunca o nome da categoria. A checagem por
 * `categoria === "Faturamento"` que existia aqui quebraria no dia em que a Thaís criasse outro
 * serviço percentual, ou renomeasse a categoria na tela de Serviços (ADR-125/126).
 */
export function ehServicoSomentePercentual(p: PrecoDoServico): boolean {
  return !temValorFixo(p) && temPercentual(p);
}

/**
 * VALOR FIXO E PERCENTUAL NO MESMO SERVIÇO — a trava que nunca existiu.
 *
 * A ordem do dono é que o Faturamento seja **sempre e somente percentual mensal**, e nada na
 * aplicação garantia isso: nem o banco (sem CHECK), nem o Zod, nem o servidor, nem a tela. Um
 * serviço com os dois preenchidos quebra tudo o que lê `ehServicoSomentePercentual` — a linha da
 * proposta volta a mostrar valor e quantidade, a estimativa do funil troca de pergunta sozinha, e
 * a conversão passa a provisionar dinheiro fixo. Nenhum desses caminhos avisa; eles só mudam de
 * comportamento.
 *
 * A régua fica aqui, junto das outras três, porque quem a aplica são quatro lugares diferentes
 * (dois schemas de serviço, o de contratação do cliente e as duas telas) e quatro cópias
 * divergiriam.
 */
export function temValorEPercentual(p: PrecoDoServico): boolean {
  return temValorFixo(p) && temPercentual(p);
}

/** A recusa, escrita para a Thaís ler — nunca "validation error". */
export const PRECO_VALOR_E_PERCENTUAL =
  "Escolha uma forma de cobrança: valor fixo OU percentual do faturamento. Os dois juntos fazem o serviço aparecer com preço em um lugar e com percentual em outro.";

// ── O valor do funil, separado por forma de cobrança (F8) ─────────────────────

/** Um serviço do lead, com o que decide se o dinheiro é recorrente ou de uma vez só. */
export interface ServicoParaDivisao extends ServicoParaEstimativa {
  valorRecorrencia: string | null | undefined;
}

/** O valor previsto de um lead, separado pelo que ele significa. */
export interface DivisaoDaEstimativa {
  /** Receita que se repete todo mês (serviço mensal, ou percentual do faturamento). */
  mensal: number;
  /** Cobrança de uma vez só. */
  avulso: number;
}

/**
 * O TOTAL DO FUNIL SOMAVA MENSAL COM AVULSO (F8).
 *
 * "Total da coluna", no board de Vendas, e os números do Início somavam R$ 3.500/mês com
 * R$ 1.500 de cobrança única e mostravam R$ 5.000 — um número que não responde nem "por mês"
 * nem "no total". Não é cobrança errada (nada disso vira conta a receber por aqui): é relatório
 * que engana quem decide olhando para ele.
 *
 * A régua é pura e mora aqui porque quem a aplica são DOIS lugares — o board e o painel do
 * Início. Duas cópias divergiriam, e a divergência apareceria como dois totais diferentes para
 * o mesmo funil, na mesma tela (o modo de falha da ADR-133).
 *
 * As decisões, e o porquê de cada uma:
 *  - **quem decide o que é mensal é o PREÇO**, nunca a categoria (a comparação
 *    `categoria === "Faturamento"` já foi removida cinco vezes deste código);
 *  - **serviço só percentual conta como MENSAL**: o `valorEstimado` dele é derivado do
 *    faturamento (ADR-125) e vale por mês, não uma vez só;
 *  - **sem preço de serviço nenhum, a estimativa digitada à mão é AVULSA** — é exatamente o que
 *    a conversão provisiona nesse caso (uma conta `recorrencia: NENHUMA`, ver
 *    `planejarProvisaoDaConversao`). Duas leituras do mesmo número dariam relatório e cobrança
 *    contando coisas diferentes;
 *  - **o credenciamento fica fora dos dois**: o honorário só nasce quando a operadora aprova
 *    (ADR-104/108), então não é receita prevista do funil.
 */
export function dividirEstimativaDoLead(
  servicos: ServicoParaDivisao[],
  valorEstimado: number | null | undefined,
): DivisaoDaEstimativa {
  let mensal = 0;
  let avulso = 0;
  let temCredenciamento = false;
  let temOutroServico = false;

  for (const s of servicos) {
    if (ehServicoDeCredenciamento(s)) {
      temCredenciamento = true;
      continue;
    }
    temOutroServico = true;
    if (s.valor != null && s.valor > 0) {
      if (s.valorRecorrencia === "MENSAL") mensal += s.valor;
      else avulso += s.valor;
    }
  }

  // Lead SÓ de credenciamento não tem receita prevista: a estimativa do funil não pode entrar
  // pela porta dos fundos. É a mesma guarda de `planejarProvisaoDaConversao`, pelo mesmo motivo.
  const soCredenciamento = temCredenciamento && !temOutroServico;

  if (mensal === 0 && avulso === 0 && !soCredenciamento) {
    const estimado = valorEstimado ?? 0;
    if (estimado > 0) {
      const derivada = planejarEstimativaDoLead(servicos, null).modo === "PERCENTUAL";
      if (derivada) mensal = estimado;
      else avulso = estimado;
    }
  }

  return { mensal: emCentavos(mensal), avulso: emCentavos(avulso) };
}
