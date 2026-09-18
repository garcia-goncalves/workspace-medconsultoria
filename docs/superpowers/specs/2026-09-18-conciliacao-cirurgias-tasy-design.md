# Conciliação — Fase 2a: o mapa cirúrgico do TASY entra no sistema

> 18/09/2026 · pedido do dono: _"já temos dados do TASY do cliente Sergio Almeida, último ano,
> vamos importar?"_. Continuação de `2026-09-11-conciliacao-producao-design.md` (Fase 1).

## 1. O que chegou

`conciliacao_clinica_sergio_almeida_ago2025-set2026.csv` — CSV `;`, UTF-8, **uma linha por
cirurgia**, 226 linhas de 18/09/2025 a 18/09/2026. Responde a pergunta que travava a Fase 2
("o TASY exporta em planilha?"): exporta, e com a coluna **Atendimento**, que é por onde o
repasse casa.

Colunas: `Data · Hora (UTC) · Sala · Duração prev (min) · Paciente · Prontuário · Atendimento ·
Nº Cirurgia · Seq Cirurgia · Convênio · Tipo Conv · Médico · Anestesista · Tipo Anestesia ·
Procedimento · Status · Autorização · Cód Aut · Unid. Internação · Setor · Cód Pessoa · OPME ·
Tempo (min) · Técnica`.

## 2. Decisões

1. **A chave é o `Nº Cirurgia`, não a competência.** Diferente do relatório de consultas (um arquivo
   = um mês), o TASY exporta um **período** — e o próximo arquivo vai se sobrepor a este. Por isso
   a cirurgia é gravada por `@@unique([clienteId, numeroCirurgia])` e reimportar **atualiza** a
   linha (status, autorização, atendimento) em vez de duplicar. Não há "substituir o mês".
   Mesmo arquivo (mesmo hash) continua recusado.
2. **O lote registra o período**, não um mês: `periodoInicio`/`periodoFim` novos em
   `ProducaoLote`. `competencia` guarda o mês da cirurgia mais recente (a coluna é obrigatória) e
   `competenciaVigente` fica **nula** — a trava "um lote vigente por mês" é das consultas.
3. **Minimização (LGPD):** `Prontuário`, `Cód Pessoa`, `Unid. Internação` (leito) **não são
   gravados** — nada aqui os usa, e o original fica no acervo do cliente. O nome do paciente fica
   em claro, pela mesma razão da Fase 1 (identifica a linha na tela). Não há CPF neste arquivo.
4. **Sem `Atendimento` importa mesmo assim**, marcada. São 30 de 226 no arquivo real — todas também
   sem unidade de internação e com autorização pendente. Sem o número ela **não casa com o
   repasse**; a tela mostra quantas são e deixa filtrar. Descartar esconderia o problema.
5. **`Reservada` importa, e não conta como produção.** O resumo conta só `Executada`; a reservada
   aparece na lista, e na próxima importação vira executada sozinha (é o mesmo `Nº Cirurgia`).
6. **`Tipo Conv` vira categoria**: `1` particular · `2` convênio · `3` SUS · `6` autogestão
   (inferido dos convênios reais de cada código: Cabesp, Cassi, Fusex, Postal Saúde…). O texto
   original fica ao lado. Código desconhecido é `OUTRO`, nunca palpite.
7. **Autorização** lida pelo `Cód Aut` (`A`, `PZ`, `PA`, `NN`), com o texto como reserva. ⚠️ No
   arquivo real 199 de 226 dizem "Pendente de autorização" — **a confirmar com a Juliana** se o
   TASY não atualiza o campo ou se é pendência real. A tela mostra o número sem transformá-lo em
   alarme.
8. **O de-para é o MESMO das consultas** (`MapeamentoConvenio`/`MapeamentoProfissional`, por
   cliente): ligar "Sul América" vale para consulta e cirurgia, e a retroação passa a atualizar as
   duas tabelas. Casamento automático de médico por nome, igual à Fase 1.
9. **SUS não é operadora do catálogo hoje.** Para "SUS - BP Paulista" sair das pendências, basta
   cadastrar a operadora "SUS" em Ajustes → Operadoras (marcada como faturamento).

## 3. Fora de escopo

Valor em reais (depende dos "5 modelinhos" de códigos por cirurgia) e o cruzamento com o
relatório de repasse — é a Fase 2b, e ela vai casar por `atendimento` (há índice para isso).
