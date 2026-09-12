import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  autenticarChamadaDeAgente,
  CABECALHO_CLIENTE,
  CABECALHO_SEGREDO,
  type EscopoDeAgente,
  type MotivoDaRecusa,
} from "../modules/agente/agente.service.js";
import {
  listarTarefasDoAgente,
  validarEntrada,
  type EntradaCrua,
  type ErroDeEntrada,
} from "../modules/agente/tarefas-do-agente.service.js";
import {
  criarTarefaDoAgente,
  montarPrevia,
  revalidar,
  validarArgumentos,
  validarPedido,
  type EntradaDaPrevia,
} from "../modules/agente/criar-tarefa-do-agente.service.js";
import { hashDosArgumentos, lerAprovacao, referenciasDoToken } from "../modules/agente/aprovacao.js";

/**
 * A API DO AGENTE — `/api/agent/v1`. Leitura na 0.1.0 (ADR-149), escrita na 0.2.0 (ADR-150).
 *
 * Fica FORA do tRPC de propósito. O tRPC daqui é o transporte do nosso próprio navegador:
 * fala superjson, agrupa chamadas em lote e não tem contrato publicável. A Cora é um cliente
 * de fora, versionado, com contrato OpenAPI que outra equipe lê — e o briefing dela proíbe,
 * com todas as letras, "expor todo tRPC ou SQL como ferramenta genérica".
 *
 * ⚠️ **O contrato é o arquivo, não este código.** Toda mudança de forma aqui obriga a subir a
 * versão em `med-coordination/contracts/workspace-agent-v1.openapi.yaml` e regerar o SHA-256.
 */

export const VERSAO_DO_CONTRATO = "0.2.1";

type CodigoDeErro =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "DELEGATION_EXPIRED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  // ─── a escrita (0.2.0) ───
  /** Token ausente, malformado, com assinatura inválida, ou emitido para outra pessoa/serviço. */
  | "APPROVAL_INVALID"
  /** Token além dos 15 minutos. Refaça a prévia. */
  | "APPROVAL_EXPIRED"
  /** O `task` enviado não é o que o token aprovou. **Não executamos o novo.** */
  | "APPROVAL_MISMATCH"
  /** Token já consumido por outra chave de idempotência. Uso é único. */
  | "APPROVAL_ALREADY_USED"
  /** O mundo mudou entre a prévia e a execução. Vem com `divergencias[]`. */
  | "PRECONDITION_CHANGED"
  /** Mesma `Idempotency-Key`, argumentos diferentes. Isto é bug de quem chama. */
  | "IDEMPOTENCY_CONFLICT";

/**
 * O identificador da requisição. A CORA manda `X-Request-Id` para correlacionar o log dos dois
 * lados; quando não vem, geramos um — resposta de erro sem identificador é impossível de
 * rastrear depois, que é justamente quando alguém precisa dela.
 */
function idDaRequisicao(req: FastifyRequest): string {
  const bruto = req.headers["x-request-id"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  // Teto de tamanho: cabeçalho é entrada de fora e vai para o log e para a resposta.
  if (typeof valor === "string" && valor.trim() && valor.length <= 200) return valor.trim();
  return randomUUID();
}

/**
 * Envelope ÚNICO de erro. Nunca sai daqui stack, SQL, nome de tabela ou segredo: a `message` é
 * escolhida de uma lista fixa deste arquivo, nunca vem de exceção.
 *
 * `extra` existe para UM caso: o `409 PRECONDITION_CHANGED`, que precisa dizer **o que**
 * divergiu, campo a campo — sem isso a Cora só saberia "mudou alguma coisa", e a frase que a
 * Thaís leria seria inútil.
 */
function responderErro(
  reply: FastifyReply,
  req: FastifyRequest,
  http: number,
  code: CodigoDeErro,
  message: string,
  extra?: Record<string, unknown>,
): FastifyReply {
  return reply
    .code(http)
    .send({ error: { code, message, requestId: idDaRequisicao(req), ...(extra ?? {}) } });
}

/** Recusa de autenticação → par (HTTP, código). A tabela é o contrato; não improvise fora dela. */
const RECUSA: Record<MotivoDaRecusa, { http: number; code: CodigoDeErro; message: string }> = {
  SEM_CREDENCIAL: { http: 401, code: "UNAUTHENTICATED", message: "Credencial ausente ou incompleta." },
  CLIENTE_INVALIDO: { http: 401, code: "UNAUTHENTICATED", message: "Credencial de serviço inválida." },
  TOKEN_INVALIDO: { http: 401, code: "UNAUTHENTICATED", message: "Delegação inválida." },
  DELEGACAO_EXPIRADA: { http: 401, code: "DELEGATION_EXPIRED", message: "Delegação expirada." },
  DELEGACAO_REVOGADA: { http: 401, code: "DELEGATION_EXPIRED", message: "Delegação revogada." },
  // ⚠️ USUÁRIO DESATIVADO É 403, E A ESCOLHA TEM MOTIVO (T5 do CORA-001).
  //
  // 401 significa "sua credencial não serve — consiga outra", e é o que a Cora faria: pediria
  // renovação da delegação, em laço. Mas delegação nova para uma pessoa desativada também não
  // vai existir, então o laço nunca fecha. 403 diz a coisa certa: a credencial está boa, quem
  // não pode mais é a PESSOA — pare e avise gente.
  USUARIO_SEM_ACESSO: { http: 403, code: "FORBIDDEN", message: "Usuário sem acesso ativo no Workspace." },
  ESCOPO_INSUFICIENTE: { http: 403, code: "FORBIDDEN", message: "Sem permissão para esta operação." },
};

const ERRO_DE_ENTRADA: Record<ErroDeEntrada, string> = {
  SCOPE: "Parâmetro `scope` inválido: o único valor aceito é `mine`.",
  STATUS: "Parâmetro `status` inválido: o único valor aceito é `open`.",
  LIMIT: "Parâmetro `limit` inválido: informe um inteiro entre 1 e 100.",
  CURSOR: "Parâmetro `cursor` inválido: use exatamente o `nextCursor` da resposta anterior.",
};

/**
 * Primeiro valor de um cabeçalho ou parâmetro que pode chegar REPETIDO.
 *
 * ⚠️ O Fastify sem schema devolve **array** quando a query vem duplicada (`?limit=10&limit=20`),
 * e o tipo `EntradaCrua` promete `string`. Hoje a validação falha para o lado seguro por
 * acidente (comparação de tipos diferentes, regex que não casa em `"10,20"`) — e "falha por
 * acidente" é o que deixa de valer no dia em que alguém trocar um `!==` por um `.includes()`.
 * Normalizar na fronteira faz a promessa do tipo virar verdade.
 */
const umSo = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Forma de um `cuid()` do Prisma. Serve só para **recusar antes de tocar o banco** um
 * `X-Agent-Client` que nem parece um id — ver o comentário no freio, abaixo.
 */
const FORMA_DE_ID = /^[a-z0-9]{20,40}$/;

/**
 * Forma de um UUID. O contrato pede **v4**; a régua confere o FORMATO e não o dígito de versão.
 *
 * ⚠️ De propósito: recusar um UUID perfeitamente único por causa do nibble de versão seria a
 * Cora levando `400` num pedido correto e passando a caçar defeito do lado dela por uma
 * exigência nossa que não protege nada. O que importa é ser único e ter forma conferível.
 */
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⚠️ **FREIO POR IP — o de fora, e a chave NÃO pode depender de nada que quem chama escolhe.**
 *
 * A primeira versão da Fase 1 chaveava por `X-Agent-Client`, e o revisor de segurança mostrou o
 * estrago: `config.rateLimit` na rota **substitui** o freio global de 300/min (o
 * `@fastify/rate-limit` registra um hook só, com o merge), então um anônimo trocando o
 * cabeçalho a cada requisição ganhava um balde novo por chamada — teto nenhum — e cada chamada
 * custava uma conexão do pool, que nesta hospedagem é 13 e já esgotou em produção. Um host
 * sozinho derrubava API, site e tempo real, sem credencial.
 *
 * É a ADR-148 pela segunda vez: **freio cuja chave o atacante escolhe não é freio.**
 *
 * ⚠️ Isto precisa ser repetido em CADA rota. A substituição é por rota: uma rota nova sem este
 * bloco fica **sem teto nenhum**, e não há erro nem log que avise.
 */
function freioPorIp() {
  return {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => req.ip,
    errorResponseBuilder: (req: FastifyRequest) => ({
      error: {
        code: "RATE_LIMITED",
        message: "Limite de chamadas atingido. Tente de novo em instantes.",
        requestId: idDaRequisicao(req),
      },
    }),
  };
}

export function registrarRotasDoAgente(app: FastifyInstance) {
  /**
   * ⚠️ **FREIO POR CREDENCIAL — o de dentro, e ele só roda DEPOIS da autenticação.**
   *
   * Existe para um serviço não comer a cota do outro. Chaveia pelo `clientId` **já conferido**;
   * antes da autenticação esse valor é escolhido por quem chama, e chavear por ele ali é
   * exatamente o buraco descrito acima. É um só para as três rotas, de propósito — a cota é do
   * serviço, não de cada endereço.
   */
  const freioPorCredencial = app.createRateLimit({
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) =>
      `agente:${(req as { clienteDeAgente?: string }).clienteDeAgente ?? "-"}`,
  });

  interface Autenticado {
    requesterUserId: string;
    clientId: string;
  }

  /**
   * O porteiro comum às três rotas: forma do cabeçalho → autenticação → cota da credencial.
   *
   * Devolve `null` quando **já respondeu** — quem chama só precisa dar `return`.
   */
  async function porteiro(
    req: FastifyRequest,
    reply: FastifyReply,
    escopo: EscopoDeAgente,
  ): Promise<Autenticado | null> {
    const bearer = (() => {
      const bruto = umSo(req.headers.authorization);
      if (!bruto) return undefined;
      const m = /^Bearer\s+(.+)$/i.exec(bruto.trim());
      return m?.[1];
    })();

    // ⚠️ A autenticação vem ANTES da validação de entrada, de propósito: quem não se identificou
    // não tem direito nem a saber se o parâmetro que mandou existe.
    const clienteBruto = umSo(req.headers[CABECALHO_CLIENTE]);

    // ⚠️ Recusa ANTES de tocar o banco quando o cabeçalho nem tem forma de id. Sem isto, cada
    // requisição anônima com lixo no cabeçalho custava uma conexão do pool — o gasto que a
    // ADR-148 aprendeu a não conceder a quem ainda não provou nada.
    if (!clienteBruto || !FORMA_DE_ID.test(clienteBruto)) {
      const r = RECUSA.SEM_CREDENCIAL;
      void responderErro(reply, req, r.http, r.code, r.message);
      return null;
    }

    let autenticacao;
    try {
      autenticacao = await autenticarChamadaDeAgente(
        { clientId: clienteBruto, clientSecret: umSo(req.headers[CABECALHO_SEGREDO]), bearer },
        escopo,
      );
    } catch (erro) {
      req.log.error({ err: erro }, "[agent-v1] falha ao autenticar");
      void responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      return null;
    }
    if (!autenticacao.ok) {
      const r = RECUSA[autenticacao.motivo];
      void responderErro(reply, req, r.http, r.code, r.message);
      return null;
    }

    // Só agora: aqui o `clientId` já foi provado com o segredo, então chavear por ele não é
    // mais chavear por entrada de quem chama.
    (req as { clienteDeAgente?: string }).clienteDeAgente = autenticacao.clientId;
    const cota = await freioPorCredencial(req);
    // ⚠️ **`isAllowed` NÃO significa "pode passar".** No `@fastify/rate-limit`, `isAllowed: true`
    // só sai quando a chave está na lista de permissão; o caminho normal devolve SEMPRE
    // `isAllowed: false`, e quem responde "estourou?" é `isExceeded`. Ler o nome pelo que ele
    // parece dizer recusa toda chamada legítima — foi o que aconteceu na 1ª versão da Fase 1, e
    // a suíte pegou (`expected 429 to be 200`).
    if (!cota.isAllowed && cota.isExceeded) {
      void responderErro(
        reply,
        req,
        429,
        "RATE_LIMITED",
        "Limite de chamadas atingido. Tente de novo em instantes.",
      );
      return null;
    }

    return { requesterUserId: autenticacao.requesterUserId, clientId: autenticacao.clientId };
  }

  // ─────────────────────────────────────────────────────────────
  // GET /tasks — a leitura (0.1.0)
  // ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: EntradaCrua }>(
    "/api/agent/v1/tasks",
    { config: { rateLimit: freioPorIp() } },
    async (req, reply) => {
      const quem = await porteiro(req, reply, "tasks:read");
      if (!quem) return reply;

      const entrada = validarEntrada(
        {
          scope: umSo(req.query.scope),
          status: umSo(req.query.status),
          limit: umSo(req.query.limit),
          cursor: umSo(req.query.cursor),
        },
        config.SESSION_SECRET,
        quem.requesterUserId,
      );
      if (!entrada.ok) {
        return responderErro(reply, req, 400, "INVALID_INPUT", ERRO_DE_ENTRADA[entrada.campo]);
      }

      try {
        const pagina = await listarTarefasDoAgente(
          quem.requesterUserId,
          entrada.valor,
          config.SESSION_SECRET,
        );
        return reply
          .code(200)
          .send({ contractVersion: VERSAO_DO_CONTRATO, items: pagina.items, nextCursor: pagina.nextCursor });
      } catch (erro) {
        // ⚠️ **INDISPONIBILIDADE NUNCA VIRA LISTA VAZIA.** Requisito explícito da CORA, e o
        // motivo é o que o assistente diria à Thaís: `{"items":[]}` se lê como "você não tem
        // nada pendente" — a frase mais perigosa que um assistente pode dizer errado. Banco
        // fora do ar é 503, e a Cora tem de dizer "não consegui consultar".
        req.log.error({ err: erro }, "[agent-v1] falha ao listar tarefas");
        return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // POST /tasks/preview — a prévia aprovável (0.2.0). LEITURA PURA.
  // ─────────────────────────────────────────────────────────────
  app.post<{ Body: EntradaDaPrevia }>(
    "/api/agent/v1/tasks/preview",
    { config: { rateLimit: freioPorIp() } },
    async (req, reply) => {
      // ⚠️ **A PRÉVIA EXIGE O ESCOPO DE ESCRITA, mesmo sem escrever nada.** Ela existe só para
      // habilitar uma escrita, e é ela que devolve o `approvalToken`; liberá-la a uma delegação
      // de leitura entregaria a chave da porta a quem não pode abri-la.
      const quem = await porteiro(req, reply, "tasks:write");
      if (!quem) return reply;

      const pedido = validarPedido(req.body ?? {}, config.SESSION_SECRET);
      if (!pedido.ok) {
        return responderErro(
          reply,
          req,
          400,
          "INVALID_INPUT",
          `Campo \`${pedido.campo}\` inválido: ${pedido.detalhe}.`,
        );
      }

      try {
        const r = await montarPrevia(pedido.valor, quem, config.SESSION_SECRET);
        return reply.code(200).send({ contractVersion: VERSAO_DO_CONTRATO, ...r });
      } catch (erro) {
        req.log.error({ err: erro }, "[agent-v1] falha ao montar a prévia");
        return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // POST /tasks — a criação (0.2.0)
  // ─────────────────────────────────────────────────────────────
  app.post<{ Body: { approvalToken?: unknown; task?: unknown } }>(
    "/api/agent/v1/tasks",
    { config: { rateLimit: freioPorIp() } },
    async (req, reply) => {
      const quem = await porteiro(req, reply, "tasks:write");
      if (!quem) return reply;

      // ─── 1. A CHAVE DE IDEMPOTÊNCIA ──────────────────────────────────────
      // ⚠️ **Obrigatória.** Sem ela, uma repetição depois de um timeout de rede — o caso mais
      // provável de todos — criaria a segunda tarefa, e a Thaís perderia a confiança na
      // assistente por um defeito de transporte.
      // ⚠️ **CAIXA ÚNICA.** A coluna `chave` é `utf8mb4_bin`, então `A1B2…` e `a1b2…` seriam
      // DUAS chaves e criariam DUAS tarefas — a mesma armadilha de colação da ADR-147, pelo lado
      // oposto. A régua aceita as duas caixas; o banco guarda uma só.
      const chave = umSo(req.headers["idempotency-key"])?.toLowerCase();
      if (!chave || !FORMA_DE_UUID.test(chave)) {
        return responderErro(
          reply,
          req,
          400,
          "INVALID_INPUT",
          "Cabeçalho `Idempotency-Key` obrigatório, no formato UUID.",
        );
      }

      // ─── 2. A APROVAÇÃO ──────────────────────────────────────────────────
      const corpo = req.body ?? {};
      if (typeof corpo.approvalToken !== "string" || !corpo.approvalToken) {
        return responderErro(reply, req, 400, "APPROVAL_INVALID", "`approvalToken` obrigatório.");
      }
      const aprovacao = lerAprovacao(corpo.approvalToken, quem, config.SESSION_SECRET);
      if (!aprovacao.ok) {
        if (aprovacao.motivo === "EXPIRADO") {
          return responderErro(
            reply,
            req,
            409,
            "APPROVAL_EXPIRED",
            "A aprovação venceu. Refaça a prévia e peça a aprovação de novo.",
          );
        }
        return responderErro(
          reply,
          req,
          400,
          "APPROVAL_INVALID",
          "`approvalToken` inválido para esta credencial.",
        );
      }

      // ─── 3. OS ARGUMENTOS SÃO OS APROVADOS? ──────────────────────────────
      const args = validarArgumentos(corpo.task);
      if (!args.ok) {
        return responderErro(reply, req, 400, "INVALID_INPUT", `${args.detalhe}.`);
      }
      // ⚠️ **Argumento diferente do aprovado é RECUSA, nunca "executa o novo".** É esta linha
      // que faz a aprovação da Thaís valer sobre o que é gravado, e não sobre uma montagem
      // parecida.
      if (hashDosArgumentos(args.valor) !== aprovacao.corpo.ah) {
        return responderErro(
          reply,
          req,
          409,
          "APPROVAL_MISMATCH",
          "Os argumentos enviados não são os que foram aprovados.",
        );
      }

      // ─── 4. O MUNDO AINDA É O MESMO? ─────────────────────────────────────
      let divergencias;
      try {
        divergencias = await revalidar(referenciasDoToken(aprovacao.corpo));
      } catch (erro) {
        req.log.error({ err: erro }, "[agent-v1] falha ao revalidar a aprovação");
        return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }
      if (divergencias.length > 0) {
        return responderErro(
          reply,
          req,
          409,
          "PRECONDITION_CHANGED",
          "O que foi aprovado mudou desde a prévia.",
          { divergencias },
        );
      }

      // ─── 5. A CRIAÇÃO ────────────────────────────────────────────────────
      let r;
      try {
        r = await criarTarefaDoAgente({
          clientId: quem.clientId,
          requesterUserId: quem.requesterUserId,
          chave,
          jti: aprovacao.corpo.jti,
          argumentos: args.valor,
        });
      } catch (erro) {
        req.log.error({ err: erro }, "[agent-v1] falha ao criar a tarefa");
        return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }

      switch (r.situacao) {
        case "CRIADA":
          return reply
            .code(201)
            .send({ contractVersion: VERSAO_DO_CONTRATO, taskId: r.tarefaId, created: true });
        // ⚠️ **`200` e não `201` na repetição, e é informação, não capricho:** o código diz à
        // Cora que nada nasceu agora, então ela não anuncia "criei" duas vezes para a Thaís.
        case "REPETIDA":
          return reply
            .code(200)
            .send({ contractVersion: VERSAO_DO_CONTRATO, taskId: r.tarefaId, created: false });
        case "CONFLITO_DE_CHAVE":
          return responderErro(
            reply,
            req,
            409,
            "IDEMPOTENCY_CONFLICT",
            "Esta `Idempotency-Key` já foi usada com outros argumentos.",
          );
        case "APROVACAO_JA_USADA":
          return responderErro(
            reply,
            req,
            409,
            "APPROVAL_ALREADY_USED",
            "Esta aprovação já foi usada. Cada aprovação vale uma vez.",
          );
        case "RESERVA_INCOMPLETA":
        default:
          // Estado que não deveria existir (ver o comentário no serviço). A resposta honesta é
          // "tente de novo" — nunca criar a segunda tarefa.
          req.log.error({ chave }, "[agent-v1] reserva de idempotência sem tarefa");
          return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }
    },
  );
}
