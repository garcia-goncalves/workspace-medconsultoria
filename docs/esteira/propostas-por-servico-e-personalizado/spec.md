# Spec — propostas por serviço, Personalizado e documentos limpos

## problema
Documentos exportados (PDF/Word) saem com rótulos internos (selo de status "Rascunho", selo do tipo, "*(a preencher)*", "_(a definir)_", marcadores `{{...}}`). Propostas juntam vários serviços num só papel, sem opção para o caso atípico. A IA some da tela em silêncio quando falta a chave.

## solucao
1. **Export limpo:** PDF e Word nunca imprimem o selo de status nem o selo do tipo (só a tela de edição os mostra). Antes de exportar, se o texto ainda contém `{{`, "(a preencher)" ou "(a definir", a tela avisa e pede confirmação. `render()` deixa de fabricar "*(a preencher)*" em texto de proposta: marcador desconhecido vira aviso visível ao editar, não texto final. Varredura automatizada de todos os modelos (DEFAULTS) garante zero marcador cru.
2. **Uma proposta por serviço:** no Novo documento, a Proposta comercial passa a emitir UMA proposta por serviço marcado (N chamadas a `criarProposta`, cada uma com 1 item, numeração sequencial existente). Credenciamento e faturamento já são separados. Sem migration.
3. **Personalizado (coringa):** modelo de tipo PROPOSTA (sem novo enum, sem migration) "Proposta personalizada", com caminho novo `criarPropostaPersonalizada`: cliente ou lead, título livre, itens do catálogo OU linhas avulsas (descrição, valor, quantidade, avulso/mensal ou percentual), seções livres (título + texto) reordenáveis, cláusulas livres, validade, forma de pagamento, observações; grava `conteudo` markdown. Linhas avulsas (sem `servicoId`) não viram ClienteServico no aceite; as do catálogo viram. Assistente de IA (via `ai.ts`, peneira de dado pessoal): sugerir seções a partir de um resumo, redigir cláusula, revisar/tornar mais objetivo, calcular resumo de investimento. Sem chave, os botões aparecem desabilitados com a explicação (não somem).
4. **IA visível:** todos os pontos de UI mostram o botão desabilitado com dica "IA desligada: falta configurar a chave" em vez de sumir, enquanto carrega ou quando indisponível. Chave Gemini no servidor OVH é ação do dono.

## o_que_ja_existe
- packages/shared/src/schemas/documento.ts (tipoModeloEnum :20, documentoServicoItemSchema :269, criarPropostaSchema :303, refine :350)
- apps/api/src/modules/documentos/documentos.service.ts (render :72, criarProposta :218-548, gerarComIA :1228, melhorarComIA :1277)
- apps/api/src/modules/documentos/modelos.service.ts (DEFAULTS :11-473, listModelos :475)
- apps/api/src/modules/documentos/documentos.router.ts
- apps/api/src/modules/propostas/propostas.service.ts (aceite :183-286)
- apps/web/src/features/documentos/DocumentoBranded.tsx (cabecalhoHtml :338, imprimirDocumento :547, montarWordMhtml :615)
- apps/web/src/features/documentos/DocumentoDetailPage.tsx (:329, :359-363, :482-486)
- apps/web/src/features/documentos/NovoDocumentoDialog.tsx (:107, :201-217, :757)
- apps/web/src/features/portal/PortalDocumentoModal.tsx, apps/web/src/features/publico/PropostaPublicaPage.tsx
- apps/api/src/config.ts:89-90, apps/api/src/lib/ai.ts, apps/api/src/modules/ia/*
- testes: apps/web/src/features/documentos/*.test.ts, apps/api/src/test/documento-aceita-lead.test.ts, e2e/flows-documentos-paginacao.spec.ts

## fontes_externas
nenhuma

## fora_de_escopo
Novo enum/migration; ampliar a Cora; publicar em produção; gravar chave no servidor; reescrever paginação.

## contradicoes_resolvidas
Tipo novo no enum × modelo PROPOSTA com caminho próprio: venceu o segundo (o aceite, o funil e DocumentosClienteCard já filtram tipo PROPOSTA; zero migration, menor risco).

## duvidas_para_o_dono
nenhuma
