# Privacidade da IA (OpenAI) — Workspace MedConsultoria

> Documento técnico dos pontos que enviam dados à OpenAI, as medidas de minimização e o que
> depende de decisão administrativa/jurídica. Ver decisão técnica #3 da finalização.

## Interruptor global (técnico)

- A IA só funciona se **houver chave** (`OPENAI_API_KEY`) **e** não estiver desligada globalmente.
- **Desligar sem remover a chave:** `IA_ENABLED=false` no `.env` (aceita `false/0/off/no`). Nesse caso,
  `isAiEnabled` é `false`, os recursos de IA **somem da interface** e **nenhum dado é enviado** à OpenAI.
- Sem chave, a app funciona normalmente e as funções de IA ficam ocultas (degrada com elegância).
- Modelo usado: `gpt-4o-mini` (texto) e `whisper-1` (transcrição de áudio). Implementação em
  `apps/api/src/lib/ai.ts`; disponibilidade consultada no front via `trpc.ia.disponivel`.

## Pontos que ENVIAM dados à OpenAI (touchpoints)

| Função (arquivo) | Perfil | Dado enviado | Necessário? |
|---|---|---|---|
| `resumoDoDia` (`ia.service`) | equipe | Nomes/qtde de tarefas, compromissos e pendências do dia do usuário | sim (é um resumo do próprio dia) |
| `resumoAgenda` (`ia.service`) | equipe | Títulos/horários dos eventos do período | sim |
| `resumirCliente` (`ia.service`) | equipe | Nome + situação comercial + serviços ativos + projetos + próxima reunião + oportunidades abertas. **`observacoes` NÃO é mais enviado** (ADR-141) | sim (resumo daquele cliente) |
| `escreverMensagem` (`ia.service`) | equipe | Contexto do lead/cliente para redigir a mensagem | sim |
| `sugerirProximoPassoLead` (`ia.service`) | equipe | Nome, empresa, etapa, serviços de interesse, valor estimado e passos pendentes. **`observacoes` NÃO é mais enviado** (ADR-141) | sim |
| `sugerirRequisitos` / `sugerirCampos` (`ia.service`) | equipe | Nome/descrição do serviço ou do formulário | sim (baixo risco — dado de catálogo) |
| `gerarComIA` (`documentos.service`) | equipe | Instruções do usuário + nome do cliente | sim |
| `melhorarComIA` (`documentos.service`) | equipe | **Conteúdo do documento** a ser melhorado | sim (a feature É melhorar aquele texto) |
| `resumirReuniao` (`documentos.service`) | equipe | Anotações coladas pela equipe | sim |
| `gerarPautaReuniao` (`documentos.service`) | equipe | Tópicos + serviços ativos + etapa do cliente | sim |
| `gerarRascunho` (proposta, `documentos.service`) | equipe | Nome do cliente + nomes dos serviços propostos | sim |
| Transcrição de áudio (`/transcrever`, Whisper) | equipe | Arquivo de áudio enviado pela equipe | sim (a feature é transcrever) |
| `diagnosticoSistema`/`explicarErro`/`explicarIncidente` (`sistema.service`) | **ROOT** | Métricas e mensagens/stack de erro (técnicas) | sim (suporte técnico) |

> A **busca global** (`busca.service`) é **só Prisma** — não usa OpenAI. Não há envio de PII de pacientes;
> os dados são de negócio (clientes/leads/serviços da MedConsultoria).

## A peneira do portão (ADR-141) — o que a OpenAI NUNCA vê

> Antes de qualquer envio, `gerarRascunho` (`apps/api/src/lib/ai.ts`) passa o texto por
> `redigirDadoPessoal` (`packages/shared/src/dado-pessoal.ts`, função pura testada).

- **Escondido sempre, venha de onde vier:** CPF, CNPJ, CRM, RG, telefone, e-mail, CEP e todo
  número de 11 ou 14 dígitos sem máscara. Cada um vira uma etiqueta (`[[CPF-1]]`) na ida e
  **volta ao original na resposta** — a OpenAI não vê o dado e o rascunho não perde nada.
- **Por que no portão e não em cada chamada:** é a lição da ADR-140 — a trava furou 14 vezes pela
  *segunda porta*. `gerarRascunho` é a **única** porta de texto para a OpenAI, então chamada nova
  nasce coberta sem ninguém precisar lembrar.
- **O nome do cliente CONTINUA sendo enviado**, de propósito: sem ele o resumo não serve. Trocá-lo
  por identificador segue como decisão jurídica em aberto, na lista abaixo.
- **Limite honesto:** a peneira pega dado com FORMA. Texto corrido ("o filho do Dr. João") nenhuma
  expressão regular pega — por isso o campo `observacoes`, que é texto livre e guarda os CPFs
  movidos pela migração de 19/08 (ADR-119), foi **retirado do contexto na origem**, em
  `resumirCliente` e `sugerirProximoPassoLead`. São duas camadas, não uma.

## Medidas de minimização já aplicadas (código)

- **Nenhum documento completo é enviado sem necessidade:** o único ponto que envia o corpo do
  documento é `melhorarComIA` — e isso é a própria função (melhorar aquele texto). Geração de
  proposta envia apenas **nomes de serviços e do cliente**, não documentos inteiros.
- **Sem dados de paciente/prontuário** trafegando para a IA (a app é operacional/CRM, não clínica).
- **Erros externos não derrubam o processo:** todas as chamadas de IA são `try/catch` com
  degradação (mantêm o texto padrão / retornam vazio) — falha da OpenAI nunca quebra a request.
- **Logs sem conteúdo sensível:** os erros de IA são registrados sem o payload; segredos (`OPENAI_API_KEY`)
  nunca são logados nem expostos por `configInfo()`.

## Pendências ADMINISTRATIVAS / jurídicas (NÃO implementáveis em código)

> Registradas como pendência — **não invente consentimento no código**.

- [ ] **Base legal / DPA com a OpenAI** (a OpenAI passa a ser sub-processadora de dados de negócio de terceiros).
- [ ] **Menção na Política de Privacidade** de que dados de negócio podem ser processados por IA (OpenAI) para os recursos de assistência.
- [ ] Definir política de **retenção** e se haverá **opção por cliente** de não usar IA sobre os seus dados.
- [x] ~~Avaliar **redação de identificadores** (CPF/CNPJ/CRM/RG/telefone/e-mail/CEP)~~ — **FEITO na ADR-141**, no portão único, com restauração na volta.
- [ ] Avaliar **anonimização adicional** (ex.: substituir nome do cliente por um identificador nas chamadas de resumo) — hoje o nome é enviado por ser útil ao resultado; é uma decisão de trade-off utilidade × privacidade a ratificar com o jurídico.
