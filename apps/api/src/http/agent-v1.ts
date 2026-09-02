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

const umSo = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function registrarRotasDoAgente(app: FastifyInstance) {
  app.get<{ Querystring: EntradaCrua }>(
    "/api/agent/v1/tasks",
    {
      config: {
        // Freio PRÓPRIO, por credencial de serviço. O global de 300/min é por IP, e a Cora vai
        // rodar na mesma máquina que o Workspace: sem chave própria, o agente e o navegador da
        // Thaís dividiriam a mesma cota e um travaria o outro.
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => {
            const id = umSo(req.headers[CABECALHO_CLIENTE]);
            return id ? `agente:${id}` : `ip:${req.ip}`;
          },
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
      let autenticacao;
      try {
        autenticacao = await autenticarChamadaDeAgente(
          {
            clientId: umSo(req.headers[CABECALHO_CLIENTE]),
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

      // ─── 2. A ENTRADA ────────────────────────────────────────────────────────
      const entrada = validarEntrada(
        { scope: req.query.scope, status: req.query.status, limit: req.query.limit, cursor: req.query.cursor },
        config.SESSION_SECRET,
      );
      if (!entrada.ok) {
        return responderErro(reply, req, 400, "INVALID_INPUT", ERRO_DE_ENTRADA[entrada.campo]);
      }

      // ─── 3. A CONSULTA ───────────────────────────────────────────────────────
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
