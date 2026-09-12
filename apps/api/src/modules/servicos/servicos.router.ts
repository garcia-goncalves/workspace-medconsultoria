import { z } from "zod";
import {
  createServicoSchema,
  updateServicoSchema,
  addServicoPassoSchema,
  updateServicoPassoSchema,
  addRequisitoSchema,
  updateRequisitoSchema,
  setRoteiroSchema,
} from "@app/shared";
import { router, publicProcedure, funcionarioProcedure, adminProcedure } from "../../trpc/trpc.js";
import * as service from "./servicos.service.js";

export const servicosRouter = router({
  // Público: usado pelo formulário de captação do site.
  publicos: publicProcedure.query(() => service.listServicosPublicos()),
  // Interno: lista para o cadastro de leads.
  ativos: funcionarioProcedure.query(() => service.listServicosAtivos()),
  // Gestão (ADMIN/ROOT): catálogo completo + CRUD.
  list: adminProcedure.query(() => service.listServicos()),
  criar: adminProcedure
    .input(createServicoSchema)
    .mutation(({ input }) => service.criarServico(input)),
  atualizar: adminProcedure.input(updateServicoSchema).mutation(({ input }) => {
    const { id, ...dados } = input;
    return service.atualizarServico(id, dados);
  }),
  remover: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => service.removerServico(input.id)),
  setRoteiro: adminProcedure.input(setRoteiroSchema).mutation(({ input }) => service.setRoteiro(input.servicoId, input.roteiro)),
  reordenar: adminProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(({ input }) => service.reordenarServicos(input.ids)),

  // Passos padrão de um serviço (por etapa).
  passos: adminProcedure
    .input(z.object({ servicoId: z.string().min(1) }))
    .query(({ input }) => service.listPassosDoServico(input.servicoId)),
  addPasso: adminProcedure
    .input(addServicoPassoSchema)
    .mutation(({ input }) => service.addServicoPasso(input.servicoId, input.titulo, input.etapaChave, input.obrigatorio)),
  atualizarPasso: adminProcedure.input(updateServicoPassoSchema).mutation(({ input }) => {
    const { id, ...dados } = input;
    return service.atualizarServicoPasso(id, dados);
  }),
  removerPasso: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => service.removerServicoPasso(input.id)),
  reordenarPassos: adminProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(({ input }) => service.reordenarServicoPassos(input.ids)),

  // Exigências (checklist de documentos/briefings) de um serviço.
  requisitos: adminProcedure
    .input(z.object({ servicoId: z.string().min(1) }))
    .query(({ input }) => service.listRequisitos(input.servicoId)),
  addRequisito: adminProcedure
    .input(addRequisitoSchema)
    .mutation(({ input }) => service.addRequisito(input)),
  atualizarRequisito: adminProcedure.input(updateRequisitoSchema).mutation(({ input }) => {
    const { id, ...dados } = input;
    return service.atualizarRequisito(id, dados);
  }),
  removerRequisito: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => service.removerRequisito(input.id)),
  reordenarRequisitos: adminProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(({ input }) => service.reordenarRequisitos(input.ids)),
});
