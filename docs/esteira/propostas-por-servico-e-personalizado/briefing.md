# Briefing — propostas por serviço, Personalizado e documentos sem quebra

## pedido_original
"Preciso analisar os modelos dos documentos pois estão bugados/quebrados (header/rodapé/etc). Quando for para baixar os documentos em PDF ou WORD não pode aparecer informações que não fazem sentido, como 'RASCUNHO / PROPOSTA'. Temos que refatorar as propostas: uma proposta separada para cada serviço da MedConsultoria, e um tipo chamado 'Personalizado' para criar propostas personalizadas (2 ou mais serviços, serviço atípico para cliente específico). A IA sumiu do Workspace. Quero o PERSONALIZADO como um coringa, bem completo, com todas as possibilidades e bem inteligente. Resposta sobre o que fica livre: TUDO."

## entendimento
Cada serviço do catálogo passa a ter a sua própria proposta. Nasce o tipo "Personalizado": coringa com tudo livre (serviços, preços, seções, cláusulas, texto), assistido pela IA. Todos os modelos são auditados para que PDF e Word saiam limpos (cabeçalho, rodapé, sem rótulos internos como RASCUNHO), e a IA volta a aparecer na tela.

## usuario_alvo
Thaís (ADMIN) e equipe da Med, ao montar e enviar proposta a lead ou cliente. Não é desenvolvedor.

## criterio_de_aceitacao
- Em Novo documento, cada serviço ativo do catálogo gera a sua proposta própria (uma por serviço); conferido na tela.
- Existe o tipo "Personalizado": permite escolher 0..N serviços, editar preço/quantidade/forma de cobrança, adicionar linhas avulsas, editar e reordenar seções e cláusulas, texto livre; conferido na tela e com teste de unidade do gerador.
- Personalizado tem assistente de IA (sugerir seções, redigir cláusula, revisar texto) passando por `ai.ts`; teste de unidade com IA simulada e prova na tela com chave real local.
- PDF e Word de TODOS os modelos não contêm as palavras "RASCUNHO", "[a preencher]" nem marcadores `{{...}}` crus; teste automatizado varre os 16+ modelos nos dois formatos.
- Cabeçalho e rodapé corretos em todas as folhas de PDF e no Word; e2e de paginação existente continua verde e cobre o modelo novo.
- Aceite de proposta, contrato automático e cobrança (ADR-104/108/127) continuam funcionando para propostas por serviço e Personalizado; testes de integração verdes.
- Botões de IA voltam a aparecer localmente; causa da ausência em produção documentada e ação para o dono (chave) indicada.
- typecheck, lint, suíte `@app/api` e `@app/web`, e e2e relevantes verdes; PR com CI verde.

## fora_de_escopo
- Ampliar a Cora (mexer em tela, PC, navegador) — decisão de produto separada.
- Publicar em produção e gravar a chave Gemini no servidor (exigem o dono).
- Reescrever o motor de paginação (ADR-129) além do necessário.

## riscos
Possível migration (novo tipo de documento/campos do Personalizado): aditiva, portão de risco antes de aplicar. Regras de dinheiro (aceite/cobrança) tocadas indiretamente. Nenhum dado de paciente.

## plano_de_voo
Fases 1, 2 (enxuto: um despacho com as quatro lentes), 4, 5, 6, 7; fase 3 só para a tela do Personalizado, sem painel de direções (segue UI_GUIDELINES). Modelos: sonnet nos executores e na descoberta, opus na síntese e revisão final. Despachos previstos: ~10.
