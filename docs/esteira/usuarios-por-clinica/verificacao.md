# Verificação — vários usuários por clínica (ADR-131)

Cada linha do `criterio_de_aceitacao` do `briefing.md`, com o que foi rodado e o que apareceu.
Nada aqui é "presumido verde": onde não foi conferido, está escrito que não foi.

## Comandos

| Critério | Comando | Resultado |
|---|---|---|
| typecheck e lint | `pnpm -r typecheck` · `pnpm lint` | sem erro |
| migração aplica | `prisma migrate deploy` no banco de dev **e** no `_test` | `All migrations have been successfully applied` |
| regra pura testada | `pnpm --filter @app/api test:unit` | **456** verdes (14 novos em `portal-papeis.test.ts`) |
| MySQL de verdade | `pnpm --filter @app/api test` | **585** verdes (15 novos em `pessoas-do-portal.integration.test.ts`) |
| tela automatizada | `node scripts/e2e-isolado.mjs flows-pessoas-do-portal` | **6/6** verdes, banco de dev intacto |

## Na tela, clicando (localhost, Chrome via Playwright, 1920×1080)

1. **Ficha do cliente** (Clínica Vida Plena): o card *"Pessoas com acesso ao Portal"* aparece com
   o texto de lista vazia. ✔
2. **Convidar pela ficha**: modal com nome, e-mail e "O que essa pessoa faz" (com a explicação de
   uma linha embaixo). Convidada "Marina Souza (secretária)" → a linha apareceu como
   **"Convidado — ainda não entrou"**, com o e-mail, a data e *"quem deu acesso: Thaís Garcia"*. ✔
3. **O aviso do responsável ausente**: com só uma pessoa de papel *Equipe*, a tela mostrou
   *"Ninguém aqui fala pela clínica…"*. Promovida a **Responsável** pelo seletor → o aviso sumiu. ✔
4. **A trava do último responsável**: tentar rebaixá-la de volta a *Equipe* respondeu, em toast,
   *"A clínica precisa de pelo menos um responsável com acesso ativo."*, e o seletor **voltou
   sozinho** para "Responsável" — a tela não fica mostrando a mudança que não aconteceu. ✔
5. **Portal, como cliente** (`cliente@teste.local`): a seção *"Quem da clínica entra aqui"* mostrou
   as **duas** contas daquela clínica (o caso da ADR-128), ambas Responsável pela migração, e
   **sem** botão de revogar na própria linha. ✔
6. **Convidar pelo Portal**: convidado "Dr. Paulo Ribeiro"; o papel padrão veio **Equipe**, porque
   esta clínica já tem responsável. Apareceu na lista com *"quem deu acesso: Clínica teste"*. ✔
7. **A prova de ponta a ponta da trava** (a que mais importa): rebaixada a própria conta a
   *Equipe*, a tela escondeu os controles e explicou por quê; e o **servidor** respondeu
   - `portal.cancelarServico` → **403** *"Só o responsável pela clínica pode fazer isso…"*
   - `portal.suporte.abrir` → **200** (a equipe continua falando com o suporte). ✔

## O que NÃO foi verificado, e por quê

- **O e-mail de convite não saiu.** No ambiente local não há SMTP (`ECONNREFUSED 127.0.0.1:587`),
  e a trava de ambiente só permite envio para os dois endereços de teste do dono. O que se prova
  aqui é que o convite é **gerado** e que a tela avisa quando o e-mail não saiu; a entrega em si
  depende do servidor.
- **A pessoa convidada não chegou a entrar.** Sem o e-mail, não há link de criar senha. O caminho
  "definir senha pelo convite" já é o mesmo de toda conta convidada e está coberto por
  `flows-primeiro-acesso`.
- **Nada foi conferido em produção.** Nada foi publicado — é o ritmo combinado (localhost →
  GitHub → publicar uma vez no fim do dia).
- **Revisores especialistas não foram despachados.** Esta sessão está configurada para não abrir
  subagentes; a revisão de autorização foi feita à mão e o que ela cobre está travado pelos 15
  testes de integração de isolamento entre clínicas.
