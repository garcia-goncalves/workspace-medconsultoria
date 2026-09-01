/**
 * Quem é o nosso proxy — a régua que decide de onde vem o `req.ip`.
 *
 * ⚠️ ESTE VALOR É REGRA DE SEGURANÇA, NÃO CONFIGURAÇÃO DE CONVENIÊNCIA. O `req.ip` é a chave de
 * TODOS os freios desta casa (limite geral de 300/min, 8 tentativas de login por conta, freio do
 * formulário público de leads) e é o que fica gravado como PROVA em `Assinatura.ip` e em
 * `Documento.propostaRespIp`. Quem controla esse valor controla os três.
 *
 * ⚠️ NUNCA `true`. `true` quer dizer "confie na cadeia inteira do X-Forwarded-For", e quem escreve
 * a entrada MAIS À ESQUERDA desse cabeçalho é o próprio visitante. O LiteSpeed acrescenta o IP real
 * à direita; não substitui a esquerda. Com `true`, qualquer um troca de IP a cada requisição só
 * mandando um cabeçalho — e assina contrato de um IP inventado.
 *
 * ⚠️ E NUNCA MAIS O NÚMERO `1`. Era o que esta linha dizia até 01/09/2026, e significava "confie
 * no salto mais próximo". O Fastify 5.12 APOSENTOU o formato numérico DE PROPÓSITO: contagem de
 * saltos não consegue validar QUEM é o vizinho imediato, então um cliente que chegue direto (sem
 * passar pelo proxy) mandando saltos suficientes se faz passar por confiável. Na 5.12 o número
 * passou a falhar fechado — não confia em ninguém —, e isso NÃO é o que queremos: sem confiar no
 * LiteSpeed, todo visitante vira o mesmo IP (o do próprio servidor) e os três freios acima passam
 * a ser compartilhados por todo mundo. Um visitante sozinho trancaria o site para os outros.
 *
 * A régua certa descreve QUEM é o proxy, em vez de contar quantos são:
 *  - `loopback`   → 127.0.0.0/8 e ::1. É a topologia real da TineHost: o LiteSpeed roda na MESMA
 *                   máquina que o Node (o mesmo motivo pelo qual `SMTP_HOST=localhost` funciona
 *                   lá — ver ADR-122). É também o caso do desenvolvimento local.
 *  - `uniquelocal` → faixas privadas (10/8, 172.16/12, 192.168/16, fc00::/7). Rede interna.
 *
 * Isto é ESTRITAMENTE MAIS SEGURO que o antigo `1`: o `1` confiava em quem quer que estivesse do
 * outro lado da conexão, inclusive um cliente público direto. Esta régua recusa confiar em
 * endereço público, então cabeçalho forjado por quem chega de fora é ignorado.
 */
export const PROXY_CONFIAVEL = ["loopback", "uniquelocal"] as const;
