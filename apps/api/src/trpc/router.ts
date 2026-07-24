import { router } from "./trpc.js";
import { authRouter } from "../modules/auth/auth.router.js";
import { clientesRouter } from "../modules/clientes/clientes.router.js";
import { pipelineRouter } from "../modules/pipeline/pipeline.router.js";
import { servicosRouter } from "../modules/servicos/servicos.router.js";
import { origensRouter } from "../modules/origens/origens.router.js";
import { leadsRouter } from "../modules/leads/leads.router.js";
import { projetosRouter } from "../modules/projetos/projetos.router.js";
import { cardsRouter } from "../modules/cards/cards.router.js";
import { agendaRouter } from "../modules/agenda/agenda.router.js";
import { notificacoesRouter } from "../modules/notificacoes/notificacoes.router.js";
import { financeiroRouter } from "../modules/financeiro/financeiro.router.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.router.js";
import { mensagensRouter } from "../modules/mensagens/mensagens.router.js";
import { documentosRouter } from "../modules/documentos/documentos.router.js";
import { assinaturasRouter } from "../modules/assinaturas/assinaturas.router.js";
import { propostasRouter } from "../modules/propostas/propostas.router.js";
import { portalRouter } from "../modules/portal/portal.router.js";
import { usuariosRouter } from "../modules/usuarios/usuarios.router.js";
import { emailsRouter } from "../modules/emails/emails.router.js";
import { emailsEnviadosRouter } from "../modules/emails/enviados.router.js";
import { buscaRouter } from "../modules/busca/busca.router.js";
import { formulariosRouter } from "../modules/formularios/formularios.router.js";
import { iaRouter } from "../modules/ia/ia.router.js";
import { sistemaRouter } from "../modules/sistema/sistema.router.js";
import { identidadeRouter } from "../modules/identidade/identidade.router.js";

/** Router raiz — cada módulo de domínio pluga aqui um sub-router. */
export const appRouter = router({
  auth: authRouter,
  dashboard: dashboardRouter,
  mensagens: mensagensRouter,
  documentos: documentosRouter,
  assinaturas: assinaturasRouter,
  propostas: propostasRouter,
  portal: portalRouter,
  clientes: clientesRouter,
  pipeline: pipelineRouter,
  servicos: servicosRouter,
  origens: origensRouter,
  leads: leadsRouter,
  projetos: projetosRouter,
  cards: cardsRouter,
  agenda: agendaRouter,
  notificacoes: notificacoesRouter,
  financeiro: financeiroRouter,
  usuarios: usuariosRouter,
  emails: emailsRouter,
  emailsEnviados: emailsEnviadosRouter,
  busca: buscaRouter,
  formularios: formulariosRouter,
  ia: iaRouter,
  sistema: sistemaRouter,
  identidade: identidadeRouter,
});

/** Tipo consumido pelo front para type-safety ponta-a-ponta. */
export type AppRouter = typeof appRouter;
