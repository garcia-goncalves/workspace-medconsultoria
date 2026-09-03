import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  autenticarChamadaDeAgente,
  CABECALHO_CLIENTE,
  CABECALHO_SEGREDO,
  type MotivoDaRecusa,
} from "../modules/agente/agente.service.js";
import {
  listarTarefasDoAgente,
  validarEntrada,
  type EntradaCrua,
  type ErroDeEntrada,
} from "../modules/agente/tarefas-do-agente.service.js";

/**
 * A API DO AGENTE, versão 0.1.0 (ADR-149) — `/api/agent/v1`.
 *
 * Fica FORA do tRPC de propósito. O tRPC daqui é o transporte do nosso próprio navegador:
 * fala superjson, agrupa chamadas em lote e não tem contrato publicável. A Cora é um cliente
 * de fora, versionado, com contrato OpenAPI que outra equipe lê — e o briefing dela proíbe,
 * com todas as letras, "expor todo tRPC ou SQL como ferramenta genérica".
 *
 * ⚠️ **O contrato é o arquivo, não este código.** Toda mudança de forma aqui obriga a subir a
 * versão em `med-coordination/contracts/workspace-agent-v1.openapi.yaml` e regerar o SHA-256.
 */

export const VERSAO_DO_CONTRATO = "0.1.0";

type CodigoDeErro =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "DELEGATION_EXPIRED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE";

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
 */
function responderErro(
  reply: FastifyReply,
  req: FastifyRequest,
  http: number,
  code: CodigoDeErro,
  message: string,
): FastifyReply {
  return reply.code(http).send({ error: { code, message, requestId: idDaRequisicao(req) } });
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

export function registrarRotasDoAgente(app: FastifyInstance) {
  /**
   * ⚠️ **FREIO POR CREDENCIAL — o de dentro, e ele só roda DEPOIS da autenticação.**
   *
   * Existe para um serviço não comer a cota do outro. Chaveia pelo `clientId` **já conferido**;
   * antes da autenticação esse valor é escolhido por quem chama, e chavear por ele ali é
   * exatamente o buraco descrito abaixo.
   */
  const freioPorCredencial = app.createRateLimit({
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => `agente:${(req as { clienteDeAgente?: string }).clienteDeAgente ?? "-"}`,
  });

  app.get<{ Querystring: EntradaCrua }>(
    "/api/agent/v1/tasks",
    {
      config: {
        // ⚠️ **FREIO POR IP — o de fora, e a chave NÃO pode depender de nada que quem chama
        // escolhe.** A primeira versão chaveava por `X-Agent-Client`, e o revisor de segurança
        // mostrou o estrago: `config.rateLimit` na rota **substitui** o freio global de 300/min
        // (o `@fastify/rate-limit` registra um hook só, com o merge), então um anônimo trocando
        // o cabeçalho a cada requisição ganhava um balde novo por chamada — teto nenhum — e
        // cada chamada custava uma conexão do pool, que nesta hospedagem é 13 e já esgotou em
        // produção. Um host sozinho derrubava API, site e tempo real, sem credencial.
        //
        // É a ADR-148 pela segunda vez: **freio cuja chave o atacante escolhe não é freio.** Lá
        // a cura foi um segundo freio por IP sozinho; aqui é a mesma.
        rateLimit: {
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
        },
      },
    },
    async (req, reply) => {
      const bearer = (() => {
        const bruto = umSo(req.headers.authorization);
        if (!bruto) return undefined;
        const m = /^Bearer\s+(.+)$/i.exec(bruto.trim());
        return m?.[1];
      })();

      // ─── 1. QUEM ESTÁ CHAMANDO, E EM NOME DE QUEM ───────────────────────────
      // Vem ANTES da validação de entrada de propósito: quem não se identificou não tem
      // direito nem a saber se o parâmetro que mandou existe.
      const clienteBruto = umSo(req.headers[CABECALHO_CLIENTE]);

      // ⚠️ Recusa ANTES de tocar o banco quando o cabeçalho nem tem forma de id. Sem isto, cada
      // requisição anônima com lixo no cabeçalho custava uma conexão do pool — o gasto que a
      // ADR-148 aprendeu a não conceder a quem ainda não provou nada.
      if (!clienteBruto || !FORMA_DE_ID.test(clienteBruto)) {
        const r = RECUSA.SEM_CREDENCIAL;
        return responderErro(reply, req, r.http, r.code, r.message);
      }

      let autenticacao;
      try {
        autenticacao = await autenticarChamadaDeAgente(
          {
            clientId: clienteBruto,
            clientSecret: umSo(req.headers[CABECALHO_SEGREDO]),
            bearer,
          },
          "tasks:read",
        );
      } catch (erro) {
        req.log.error({ err: erro }, "[agent-v1] falha ao autenticar");
        return responderErro(reply, req, 503, "UPSTREAM_UNAVAILABLE", "Serviço indisponível no momento.");
      }
      if (!autenticacao.ok) {
        const r = RECUSA[autenticacao.motivo];
        return responderErro(reply, req, r.http, r.code, r.message);
      }

      // ─── 2. A COTA DAQUELA CREDENCIAL ────────────────────────────────────────
      // Só agora: aqui o `clientId` já foi provado com o segredo, então chavear por ele não é
      // mais chavear por entrada de quem chama.
      (req as { clienteDeAgente?: string }).clienteDeAgente = autenticacao.clientId;
      const cota = await freioPorCredencial(req);
      // ⚠️ **`isAllowed` NÃO significa "pode passar".** No `@fastify/rate-limit`, `isAllowed:
      // true` só sai quando a chave está na lista de permissão; o caminho normal devolve
      // SEMPRE `isAllowed: false`, e quem responde "estourou?" é `isExceeded`. Ler o nome pelo
      // que ele parece dizer recusa toda chamada legítima — foi o que aconteceu na 1ª versão, e
      // a suíte pegou (`expected 429 to be 200`).
      if (!cota.isAllowed && cota.isExceeded) {
        return responderErro(
          reply,
          req,
          429,
          "RATE_LIMITED",
          "Limite de chamadas atingido. Tente de novo em instantes.",
        );
      }

      // ─── 3. A ENTRADA ────────────────────────────────────────────────────────
      const entrada = validarEntrada(
        {
          scope: umSo(req.query.scope),
          status: umSo(req.query.status),
          limit: umSo(req.query.limit),
          cursor: umSo(req.query.cursor),
        },
        config.SESSION_SECRET,
        autenticacao.requesterUserId,
      );
      if (!entrada.ok) {
        return responderErro(reply, req, 400, "INVALID_INPUT", ERRO_DE_ENTRADA[entrada.campo]);
      }

      // ─── 4. A CONSULTA ───────────────────────────────────────────────────────
      try {
        const pagina = await listarTarefasDoAgente(
          autenticacao.requesterUserId,
          entrada.valor,
          config.SESSION_SECRET,
        );
        return reply.code(200).send({
          contractVersion: VERSAO_DO_CONTRATO,
          items: pagina.items,
          nextCursor: pagina.nextCursor,
        });
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
}
