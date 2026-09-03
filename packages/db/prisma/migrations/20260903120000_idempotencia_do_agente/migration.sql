-- CORA-003, Fase 2 da API do agente: a ESCRITA de tarefa, com aprovacao e idempotencia.
--
-- UMA tabela NOVA. Nenhuma tabela existente e alterada, nenhuma linha e apagada ou convertida,
-- nao ha backfill. Sem esta tabela nao existe criacao pela API do agente -- ela nasce fechada.
--
-- POR QUE ESTA TABELA E, ESPECIFICAMENTE, POR QUE OS DOIS INDICES UNICOS:
--
--   1. `AgentIdempotency_reserva_key (clientId, userId, ferramenta, chave)` e a RESERVA DA
--      CHAVE DE IDEMPOTENCIA. E ele -- nao um nivel de isolamento de transacao -- que torna a
--      reserva atomica. Em REPEATABLE READ (o padrao do MySQL e do MariaDB 10.6 que roda em
--      producao) duas conexoes que LEEM "ja existe?" e depois INSEREM passam as duas: o
--      "confere e grava" perdido. So SERIALIZABLE ou um lock explicito impediriam, e os dois
--      custam caro numa rota chamada em laco por um programa. O indice unico e imposto pelo
--      motor de armazenamento e vale entre conexoes diferentes do pool -- que aqui e 13.
--      O caminho e: INSERT primeiro; violacao (P2002) significa "alguem ja tem".
--
--   2. `AgentIdempotency_jti_key (jti)` e o USO UNICO DO `approvalToken`. O token e assinado e
--      SEM ESTADO; o que o consome e este INSERT. Reapresentar o mesmo token com outra chave
--      de idempotencia colide aqui e e recusado.
--
-- POR QUE `tarefaId` E ANULAVEL: a linha nasce ANTES da tarefa, dentro da MESMA transacao. Ela
-- nunca e observavel nula de fora -- ou a transacao inteira entra (reserva + tarefa +
-- responsaveis), ou nada entra. Em dois passos, uma queda entre eles deixaria a chave gravada
-- sem tarefa (repetir nunca mais criaria) ou a tarefa sem chave (repetir criaria a segunda).
--
-- POR QUE `COLLATE utf8mb4_bin` EM `chave`, `argsHash` E `jti`: a colacao da casa e
-- utf8mb4_unicode_ci, que IGNORA maiuscula e acento (ADR-147). Estas tres colunas sao as que o
-- servidor consulta para decidir "ja fiz isto?" e "este token ja foi usado?". Hoje os valores
-- sao hex minusculo e UUID, e nao haveria colisao; o defeito seria a coluna DEPENDER disso.
--
-- POR QUE `ON DELETE CASCADE` NO `tarefaId`: se a tarefa deixar de existir de verdade, a
-- reserva vai junto e a chave volta a valer -- coerente, porque a tarefa aprovada nao existe
-- mais. Nesta casa tarefa e apagada por `deletedAt` (soft delete), entao na pratica a reserva
-- sobrevive ate o expurgo das 24 h.
--
-- REVERTER E UMA LINHA:
--   DROP TABLE `AgentIdempotency`;

CREATE TABLE `AgentIdempotency` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `ferramenta` VARCHAR(64) NOT NULL,
    `chave` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `argsHash` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    `jti` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    `tarefaId` VARCHAR(191) NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiraEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AgentIdempotency_reserva_key`(`clientId`, `userId`, `ferramenta`, `chave`),
    UNIQUE INDEX `AgentIdempotency_jti_key`(`jti`),
    INDEX `AgentIdempotency_expiraEm_idx`(`expiraEm`),
    INDEX `AgentIdempotency_userId_idx`(`userId`),
    INDEX `AgentIdempotency_tarefaId_idx`(`tarefaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AgentIdempotency` ADD CONSTRAINT `AgentIdempotency_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `AgentClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AgentIdempotency` ADD CONSTRAINT `AgentIdempotency_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AgentIdempotency` ADD CONSTRAINT `AgentIdempotency_tarefaId_fkey` FOREIGN KEY (`tarefaId`) REFERENCES `Tarefa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
