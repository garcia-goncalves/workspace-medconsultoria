import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateModeloInput, UpdateModeloInput, TipoModelo } from "@app/shared";

/**
 * Modelos-semente da MedConsultoria em MARKDOWN (títulos, listas, tabelas) — renderizados
 * na moldura branded (DocumentoBranded). O cabeçalho da folha já mostra título/cliente/data,
 * então os modelos NÃO repetem isso; começam direto no conteúdo.
 */
/** Exportado para o teste conferir que a Proposta de credenciamento segue fiel ao papel real. */
export const DEFAULTS: { nome: string; tipo: TipoModelo; corpo: string }[] = [
  {
    // O marcador {{servicos}} é onde o construtor injeta a tabela de serviços + investimento
    // (com prazo/condições). O resto do corpo é livre e editável.
    nome: "Proposta comercial",
    tipo: "PROPOSTA",
    corpo: `Prezado(a) {{cliente.nome}},

{{apresentacao}}

{{servicos}}

Ficamos à disposição para qualquer dúvida e seguimos juntos no que você decidir. Será um prazer cuidar disso por você.

Atenciosamente,
**Equipe MedConsultoria**`,
  },
  {
    nome: "Proposta de credenciamento",
    tipo: "PROPOSTA",
    // FIEL AO PAPEL DA THAÍS (ADR-104). As cinco seções, os seis passos do plano de trabalho,
    // a cláusula de honorários no sucesso, as observações e a confidencialidade estão
    // transcritas do PDF real (`brand/identidade/Proposta Credenciamento…`), palavra por
    // palavra. O que o sistema escreve são só os marcadores: número, data, cliente,
    // profissionais, operadoras, valores e a consultora responsável.
    corpo: `**Proposta {{numero}}** &nbsp;·&nbsp; **Data:** {{data}}

**{{cliente.nome}}**

Prezado(a),

Atendendo à solicitação, apresentamos a proposta para o credenciamento junto à(s) operadora(s) de Saúde, através das solicitações de credenciamento e editais.

Considerando nossa experiência anterior em serviços da mesma natureza, temos convicção de que proporcionaremos benefícios significativos, além de um trabalho eficiente e organizado.

Queremos registrar nossa satisfação pela oportunidade de apresentação desta proposta, bem como de fortalecer nossas relações profissionais que, estamos seguros, serão profícuas para ambas as partes. Colocamo-nos à inteira disposição para quaisquer esclarecimentos adicionais.

# DESCRIÇÃO DA PROPOSTA

## 1. Dados, Serviços e instalações a serem fornecidos para o Cliente

Credenciamento de {{profissionais}}, junto aos planos de saúde:

{{operadoras}}

## 2. Plano de Trabalho Relativo à Execução do Serviço

O trabalho proposto será coordenado pela consultora comercial da MedConsultoria, {{consultora}}, que deverá realizar o processo conforme descrito abaixo.

1. Primeiro contato com a operadora;
2. Elaboração da carta de apresentação;
3. Follow-up da documentação solicitada;
4. Elaboração e negociação da tabela de valores;
5. Acompanhamento até pronunciamento do plano de saúde e assinatura do contrato;
6. Networking com a equipe de relacionamento médico para obter o referenciamento dos serviços oferecidos.

## 3. Honorários

O repasse de honorário ocorrerá **somente no sucesso** do nosso trabalho, após assinatura do contrato de prestação de serviço formalizado com a operadora. **Não haverá adiantamento nem despesas adicionais.**

{{servicos}}

## 4. Observações Importantes

- É de responsabilidade do doutor fornecer a documentação exigida pelo plano de saúde.
- Após 1 (uma) tentativa e negativa do plano de saúde, daremos por encerradas as tentativas, salvo em comum acordo para uma nova tentativa.

## 5. Confidencialidade e não divulgação

A MedConsultoria se compromete a não divulgar, sem autorização formal, quaisquer informações de propriedade dos médicos {{profissionais_nomes}}. Todas as informações fornecidas decorrentes da execução do trabalho são confidenciais.

Qualquer item que esteja fora do escopo proposto será necessária elaboração de nova proposta.

Cordialmente,

| | |
| --- | --- |
| \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ | \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ |
| **{{consultora}}** | **{{cliente.nome}}** |
| MedConsultoria | Cliente |`,
  },
  {
    nome: "Proposta de faturamento médico",
    tipo: "PROPOSTA",
    // ADR-126. O Faturamento de contas médicas NÃO tem valor fixo, NÃO tem quantidade e é
    // SEMPRE mensal: a Med ganha um percentual sobre o que a clínica fatura. Por isso este
    // modelo não fala em "investimento à vista" nem em prazo de entrega — fala em percentual,
    // convênios atendidos e faturamento médio mensal.
    //
    // O que o sistema escreve são só os marcadores: número, data, cliente, convênios,
    // percentual, faturamento médio e a consultora. `{{servicos}}` traz a tabela do serviço, a
    // conta (faturamento × percentual) e a condição de pagamento cadastrada no serviço.
    corpo: `**Proposta {{numero}}** &nbsp;·&nbsp; **Data:** {{data}}

**{{cliente.nome}}**

Prezado(a),

{{apresentacao}}

# DESCRIÇÃO DA PROPOSTA

## 1. Objeto

Gestão do faturamento das contas médicas de **{{cliente.nome}}** — auditoria e conferência das guias, processamento junto às operadoras, conciliação dos pagamentos, recurso de glosas e relatórios gerenciais.

## 2. Convênios atendidos

O trabalho abrange as contas dos seguintes convênios/operadoras:

{{convenios}}

Convênio novo passa a ser atendido mediante simples comunicação, sem necessidade de nova proposta.

## 3. Remuneração

A remuneração da MedConsultoria é de **{{percentual}}** sobre o valor **efetivamente faturado e recebido** no mês, apurada mensalmente. **Não há valor fixo, taxa de adesão nem cobrança mínima** — se não houver faturamento no mês, não há honorário.

{{servicos}}

## 4. Plano de Trabalho

O trabalho será coordenado pela consultora comercial da MedConsultoria, {{consultora}}, e seguirá o seguinte ciclo mensal.

1. Recebimento e conferência das guias e dos demonstrativos das operadoras;
2. Auditoria das inconsistências antes do envio;
3. Processamento e protocolo junto a cada operadora;
4. Conciliação dos pagamentos recebidos;
5. Identificação, recurso e acompanhamento das glosas;
6. Relatório gerencial do mês, com o que foi faturado, recebido e glosado.

## 5. Observações Importantes

- É de responsabilidade da CONTRATANTE fornecer, em tempo hábil, as guias, os demonstrativos das operadoras e o acesso aos portais de faturamento.
- Os prazos de pagamento são os praticados por cada operadora; a MedConsultoria acompanha e cobra, mas não os define.
- Qualquer item fora do escopo desta proposta demandará elaboração de nova proposta.

## 6. Confidencialidade e não divulgação

A MedConsultoria se compromete a não divulgar, sem autorização formal, quaisquer informações de propriedade de {{cliente.nome}}. Todas as informações decorrentes da execução do trabalho são confidenciais.

Cordialmente,

| | |
| --- | --- |
| \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ | \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ |
| **{{consultora}}** | **{{cliente.nome}}** |
| MedConsultoria | Cliente |`,
  },
  {
    nome: "Contrato de prestação de serviços",
    tipo: "CONTRATO",
    corpo: `**CONTRATO DE PRESTAÇÃO DE SERVIÇOS**

Pelo presente instrumento particular, de um lado {{contratada}}, doravante denominada **CONTRATADA**; e de outro **{{cliente.nome}}**, inscrita sob o CNPJ nº {{cliente.cnpj}}, e-mail {{cliente.email}}, doravante denominada(o) **CONTRATANTE**; têm entre si justo e contratado o quanto segue.

## 1. Objeto
A CONTRATADA prestará à CONTRATANTE os seguintes serviços:

{{objeto}}

As condições específicas de **cada serviço contratado** estão detalhadas na Cláusula 9 (Condições específicas dos serviços).

## 2. Obrigações da CONTRATADA
- Executar os serviços com zelo, técnica e ética profissional;
- Manter a CONTRATANTE informada sobre o andamento dos trabalhos;
- Guardar sigilo sobre todas as informações a que tiver acesso.

## 3. Obrigações da CONTRATANTE
- Fornecer, em tempo hábil, os documentos e as informações necessários;
- Efetuar os pagamentos nas condições acordadas;
- Indicar um responsável para o contato com a CONTRATADA.

## 4. Valor e forma de pagamento
{{valor}}

Os valores serão reajustados a cada 12 (doze) meses pela variação acumulada do IPCA/IBGE (ou índice que venha a substituí-lo).

## 5. Prazo e vigência
{{prazo}}

## 6. Confidencialidade e proteção de dados (LGPD)
As partes manterão sigilo sobre as informações trocadas. A CONTRATADA tratará eventuais dados pessoais e dados de pacientes estritamente para a execução deste contrato, conforme a Lei nº 13.709/2018 (LGPD), adotando as medidas de segurança adequadas.

## 7. Rescisão
Este contrato pode ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias, sem prejuízo dos valores devidos até a data da rescisão. Na rescisão imotivada antes do término da vigência, a parte que der causa pagará multa compensatória equivalente a 1 (uma) mensalidade dos serviços.

## 8. Disposições gerais
Fica eleito o foro de {{foro}} para dirimir eventuais dúvidas. As partes assinam este contrato **eletronicamente**, com validade jurídica (Lei nº 14.063/2020), declarando concordância com todas as condições aqui estabelecidas.

## 9. Condições específicas dos serviços
As condições abaixo se aplicam a cada serviço efetivamente contratado pela CONTRATANTE e integram o objeto deste contrato.

{{clausulas_servicos}}

---

**MedConsultoria** (CONTRATADA) &nbsp;·&nbsp; **{{cliente.nome}}** (CONTRATANTE)`,
  },
  {
    nome: "Escopo de trabalho",
    tipo: "ESCOPO",
    corpo: `**ESCOPO DE TRABALHO**

**Cliente:** {{cliente.nome}}
**Serviço:** {{servico}}

## Objetivo
{{objetivo}}

## O que está incluído
{{atividades}}

## Entregáveis
{{entregaveis}}

## O que NÃO está incluído
{{fora_escopo}}

## Prazos e marcos
{{prazos}}

## Responsabilidades
- **MedConsultoria:** execução do serviço, acompanhamento e relatórios de andamento.
- **Cliente:** envio dos documentos e informações em tempo hábil, e um responsável para contato.

## Observações
{{observacoes}}`,
  },
  {
    nome: "Ata de reunião",
    tipo: "ATA",
    corpo: `**Data da reunião:** {{data_reuniao}} &nbsp;·&nbsp; **Local:** {{local}}
**Participantes:** {{participantes}}

## Pauta
{{pauta}}

## Discussões e decisões
{{decisoes}}

## Próximos passos (o quê · quem · quando)
{{proximos_passos}}`,
  },
  {
    nome: "Pauta de reunião",
    tipo: "PAUTA_REUNIAO",
    corpo: `**Data e hora:** {{data_hora}} &nbsp;·&nbsp; **Participantes:** {{participantes}}

## Objetivo da reunião
{{objetivo}}

## Tópicos a tratar
{{topicos}}

## Decisões que precisamos tomar
{{decisoes_necessarias}}

## Pontos que não podemos esquecer
{{pontos_chave}}

## Materiais de apoio
{{materiais}}`,
  },
  {
    nome: "Checklist de onboarding do cliente",
    tipo: "ONBOARDING",
    corpo: `## Onboarding de {{cliente.nome}}

**Boas-vindas e alinhamento**
- [ ] Proposta aceita e contrato assinado
- [ ] Reunião de kickoff realizada
- [ ] Responsável e equipe definidos

**Acessos e informações**
- [ ] Documentos e acessos recebidos
- [ ] Ferramentas e relatórios configurados

**Plano de trabalho**
- [ ] Cronograma e metas acordados
- [ ] Primeiro alinhamento de resultados agendado

**Observações:** {{observacoes}}`,
  },
  {
    nome: "Checklist de documentos — Credenciamento",
    tipo: "CHECKLIST",
    corpo: `Lista dos documentos necessários para o credenciamento. Marque conforme for enviando — você pode enviar tudo de forma simples pelo seu **Portal do Cliente**.

## Do profissional
- [ ] RG e CPF
- [ ] Registro no conselho (CRM / CRO)
- [ ] Diploma de graduação
- [ ] Título de especialista / RQE (se houver)
- [ ] Comprovante de endereço
- [ ] Dados bancários
- [ ] Foto 3x4 (se solicitada pela operadora)

## Da clínica / PJ (quando aplicável)
- [ ] CNPJ e contrato social
- [ ] Alvará de funcionamento
- [ ] Licença sanitária (vigilância)
- [ ] Responsável técnico
- [ ] Comprovante de endereço da clínica

_A lista pode variar conforme a operadora / convênio._

**Observações:** {{observacoes}}`,
  },
  {
    nome: "Pauta de postagem (calendário editorial)",
    tipo: "PAUTA_POSTAGEM",
    corpo: `**Período:** {{periodo}}

## Calendário de conteúdo

{{postagens}}

## Diretrizes
- Sempre dentro das normas do CFM (sem promessas de resultado, sem antes/depois indevido).
- Tom acolhedor e informativo.

**Observações:** {{observacoes}}`,
  },
  {
    nome: "Relatório de faturamento e glosas",
    tipo: "RELATORIO",
    corpo: `**Período:** {{periodo}}

## Resumo do faturamento

| Indicador | Valor |
| --- | --- |
| Total faturado | {{total_faturado}} |
| Total glosado | {{total_glosado}} |
| Glosas recuperadas | {{glosas_recuperadas}} |
| % de glosa | {{percentual_glosa}} |

## Principais motivos de glosa
{{motivos_glosa}}

## Ações realizadas
{{acoes}}

## Recomendações
{{recomendacoes}}`,
  },
  {
    nome: "Relatório gerencial mensal",
    tipo: "RELATORIO",
    corpo: `**Período:** {{periodo}}

## Indicadores do mês
{{indicadores}}

## Destaques e conquistas
{{destaques}}

## Pontos de atenção
{{atencao}}

## Próximos passos
{{proximos_passos}}

**Equipe MedConsultoria**`,
  },
  {
    nome: "Relatório de desempenho de marketing",
    tipo: "RELATORIO",
    corpo: `**Período:** {{periodo}}

## Resultados

| Métrica | Resultado | Variação |
| --- | --- | --- |
| Alcance | {{alcance}} | {{var_alcance}} |
| Seguidores | {{seguidores}} | {{var_seguidores}} |
| Engajamento | {{engajamento}} | {{var_engajamento}} |
| Agendamentos/leads | {{leads}} | {{var_leads}} |

## Destaques do período
{{destaques}}

## Próximas ações
{{proximas_acoes}}`,
  },
  {
    nome: "Diagnóstico inicial",
    tipo: "DIAGNOSTICO",
    corpo: `**Cliente:** {{cliente.nome}} &nbsp;·&nbsp; **Data:** {{data}}

## Situação atual
{{situacao}}

## Pontos fortes
{{pontos_fortes}}

## Oportunidades de melhoria
{{oportunidades}}

## Recomendações da MedConsultoria
{{recomendacoes}}`,
  },
  {
    nome: "Plano de ação",
    tipo: "PLANO_ACAO",
    corpo: `**Cliente:** {{cliente.nome}}
**Objetivo:** {{objetivo}}

## Ações

{{acoes}}

## Como mediremos o sucesso
{{indicadores}}`,
  },
  {
    nome: "Recibo",
    tipo: "RECIBO",
    corpo: `**RECIBO**

Recebemos de **{{cliente.nome}}** a importância de **{{valor}}** ({{valor_extenso}}), referente a **{{referente}}**.

**Forma de pagamento:** {{forma_pagamento}} &nbsp;·&nbsp; **Data:** {{data}}

Para clareza, firmamos o presente recibo, dando plena quitação do valor acima.

---

**MedConsultoria**`,
  },
];

export async function listModelos() {
  // Semeia por NOME: cria os que faltam e mantém os modelos-semente atualizados com a versão
  // de referência — MAS nunca sobrescreve o que a equipe editou (`editadoManualmente`).
  const existentes = await prisma.modeloDocumento.findMany({
    select: { id: true, nome: true, corpo: true, tipo: true, editadoManualmente: true },
  });
  const porNome = new Map(existentes.map((m) => [m.nome, m]));
  for (const d of DEFAULTS) {
    const ex = porNome.get(d.nome);
    if (!ex) {
      await prisma.modeloDocumento.create({ data: d });
    } else if (!ex.editadoManualmente && (ex.corpo !== d.corpo || ex.tipo !== d.tipo)) {
      await prisma.modeloDocumento.update({ where: { id: ex.id }, data: { corpo: d.corpo, tipo: d.tipo } });
    }
  }
  // Os BRIEFINGS viraram formulários INTERATIVOS (model Formulario) — desativa os
  // modelos-semente de texto tipo BRIEFING que ninguém editou (deixam de aparecer).
  await prisma.modeloDocumento.updateMany({
    where: { tipo: "BRIEFING", ativo: true, editadoManualmente: false },
    data: { ativo: false },
  });
  return prisma.modeloDocumento.findMany({ where: { ativo: true }, orderBy: [{ tipo: "asc" }, { nome: "asc" }] });
}

export async function getModelo(id: string) {
  const m = await prisma.modeloDocumento.findUnique({ where: { id } });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  return m;
}

export function createModelo(input: CreateModeloInput) {
  return prisma.modeloDocumento.create({
    data: { nome: input.nome.trim(), tipo: input.tipo, corpo: input.corpo },
  });
}

export function updateModelo(input: UpdateModeloInput) {
  const { id, ...rest } = input;
  // Toda edição da equipe protege o modelo da semente daqui em diante.
  const data: Record<string, unknown> = { editadoManualmente: true };
  if (rest.nome !== undefined) data.nome = rest.nome.trim();
  if (rest.tipo !== undefined) data.tipo = rest.tipo;
  if (rest.corpo !== undefined) data.corpo = rest.corpo;
  return prisma.modeloDocumento.update({ where: { id }, data });
}

export async function removeModelo(id: string) {
  await prisma.modeloDocumento.update({ where: { id }, data: { ativo: false } });
  return { ok: true };
}
