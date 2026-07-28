# 🔑 ACESSOS E LINKS — Workspace MedConsultoria (ambiente local)

> Guia rápido para acompanhar a aplicação **rodando na sua máquina**.
> Este é o ambiente de desenvolvimento (local). O app já está **em produção** em
> https://workspace.medconsultoria.com.br — ver seção "Acessos de PRODUÇÃO" no final deste documento.

---

## ▶️ A aplicação está rodando?

Se você acabou de pedir para eu rodar, ela **já está no ar**. Abra no navegador:

### 👉 **http://localhost:4310**

Se não abrir (ex.: você reiniciou o computador), veja "Como ligar" no final.

---

## 🗺️ Mapa completo de páginas (TODAS as rotas)

> Referência **completa e exaustiva** de todas as telas da aplicação — nenhuma fica de fora.
> Em produção troque `http://localhost:4310` por `https://workspace.medconsultoria.com.br`.
> **Acesso:** _Público_ = sem login · _CLIENTE_ = Portal do Cliente · _Equipe_ = qualquer conta interna
> (Funcionário/Admin/Root) · _Admin+_ = Admin ou Root · _Root_ = só o dono.

### 1) Páginas públicas (abrem **sem login**)

| Caminho                | Página (componente)     | Acesso           | O que é                                                                                     |
| ---------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `/comecar`             | `CapturaLeadPage`       | Público          | **Formulário de captação** ("Fale com a MedConsultoria") — quem preenche vira lead no funil (origem detectada) e já ganha acesso ao Portal. *(Nome antigo `/captura` foi removido de propósito.)* |
| `/login`               | `LoginPage`             | Público          | **Entrar** no sistema (mostrado em qualquer caminho quando não há sessão)                    |
| `/esqueci-senha`       | `EsqueciSenhaPage`      | Público          | Pedir um **link de redefinição** de senha por e-mail                                         |
| `/redefinir-senha`     | `RedefinirSenhaPage`    | Público (token)  | Definir uma **nova senha** usando o link recebido por e-mail                                 |
| `/definir-senha`       | `DefinirSenhaPage`      | Público (token)  | **Primeira senha** de uma conta recém-convidada (equipe ou cliente)                          |
| `/assinar/{token}`     | `AssinarPage`           | Público (token)  | **Assinatura eletrônica** de um documento (proposta/contrato) — grava IP+navegador          |
| `/proposta/{token}`    | `PropostaPublicaPage`   | Público (token)  | Ver e **aceitar uma proposta** online                                                        |

### 2) Portal do Cliente (login de papel **CLIENTE**)

| Caminho                | Página (componente)               | Acesso   | O que é                                                                                       |
| ---------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `/` (e qualquer rota)  | `PortalHome` dentro de `PortalLayout` | CLIENTE  | **Área do cliente** isolada: andamento do atendimento, documentos para assinar, projetos, documentos, e-mails recebidos, próximas reuniões e **chat de Suporte** — só os dados dele |

### 3) Área interna (equipe — dentro do `AppLayout`)

| Caminho                | Página (componente)             | Acesso  | O que é                                                                            |
| ---------------------- | ------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `/`                    | `DashboardPage`                 | Equipe  | **Início** — o que precisa da sua atenção hoje (ações, IA, funil, reuniões, upsell) |
| `/leads`               | `LeadsPipelinePage`             | Equipe  | **Vendas** — funil de leads (Kanban)                                                |
| `/clientes`            | `ClientesListPage`              | Equipe  | **Clientes** — lista (Ativos/Inativos)                                              |
| `/clientes/{id}`       | `ClienteDetailPage`             | Equipe  | **Ficha do cliente** — hub completo                                                 |
| `/projetos`            | `ProjetosListPage`              | Equipe  | **Projetos** — lista por cliente                                                    |
| `/projetos/{id}`       | `ProjetoDetailPage`             | Equipe  | **Kanban do projeto**                                                               |
| `/tarefas`             | `TarefasPage`                   | Equipe  | **Tarefas** — pedidos/delegação entre a equipe (abas Comigo/Deleguei/Da equipe)     |
| `/agenda`              | `AgendaPage`                    | Equipe  | **Agenda** — calendário (Lista/Dia/Semana/Mês/Ano)                                  |
| `/mensagens`           | `MensagensPage`                 | Equipe  | **Mensagens** — chat interno + Suporte na mesma conversa                            |
| `/documentos`          | `DocumentosPage`                | Equipe  | **Documentos** — gerar/gerir (proposta, ata, briefing…) + Formulários              |
| `/documentos/{id}`     | `DocumentoDetailPage`           | Equipe  | **Documento aberto** (edição/preview A4)                                            |
| `/servicos`            | `ServicosPage`                  | Admin+  | **Serviços** — catálogo + exigências + passos do checklist                          |
| `/financeiro`          | `FinanceiroPage`                | Admin+  | **Financeiro** — carteiras Empresa×Pessoal, a pagar/receber                         |
| `/modelos`             | `ModelosPage`                   | Admin+  | **Modelos de documentos** — biblioteca de modelos com `{{variáveis}}`               |
| `/modelos/{id}`        | `ModeloDetailPage`              | Admin+  | **Editar modelo**                                                                   |
| `/usuarios`            | `UsuariosPage`                  | Admin+  | **Equipe & acessos** — convidar equipe e criar acesso ao Portal                     |
| `/emails`              | `EmailsAdminPage`               | Admin+  | **Comunicações** — editar os textos dos e-mails do sistema                          |
| `/emails-enviados`     | `EmailsEnviadosMonitorPage`     | Admin+  | **E-mails enviados** — monitor (entregues/falhas + motivo)                          |
| `/ajustes`             | `AjustesPage`                   | Admin+  | **Ajustes** — Modelos, Categorias, Origens, Operadoras e **Dados da empresa**       |
| `/configuracoes`       | `ConfiguracoesPage`             | Equipe  | **Configurações** — seu perfil e trocar a própria senha                             |
| `/sistema`             | `SistemaPage`                   | **Root**| **Sistema** — saúde, desempenho, erros, incidentes, sessões e **Operação**          |
| `/login` (já logado)   | `JaConectadoPage`               | Logado  | "**Já conectado**" — mostra quem está logado e oferece **trocar de conta**          |
| *(qualquer outra)*     | `NotFound`                      | —       | "Página não encontrada" (estado amigável dentro do shell)                          |

> **Como as rotas são resolvidas:** as **públicas** são tratadas em `App.tsx` (por `window.location.pathname`, fora do gate de login); o **Portal** (`PortalHome`) aparece quando o papel é CLIENTE; a **área interna** é o `router.tsx` (TanStack Router) dentro do `AppLayout`. As telas com _Admin+/Root_ são protegidas por `RoleGuard`.

---

## 🔐 Logins de teste (senha `medconsultoria123` em todos)

| E-mail                                 | Papel        | O que vê                                                                    |
| -------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `root@medconsultoria.com.br`         | ROOT         | **Root principal (imutável)** — nunca pode ser rebaixado, desativado nem excluído. Tudo + painel**Sistema**; cria e gerencia outros ROOTs/administradores |
| `thiago.garcia@medconsultoria.com.br` | ROOT        | Root nominal (Thiago). Pode virar Admin/Funcionário se quiser; troca a senha no 1º login |
| `andre.cintra@medconsultoria.com.br` | ROOT         | Root nominal (André). Pode virar Admin/Funcionário se quiser; troca a senha no 1º login |
| `thais.garcia@medconsultoria.com.br` | ADMIN        | Tudo (inclusive Financeiro e Equipe) —**exceto** o painel Sistema      |

> Estas contas são criadas pelo `pnpm db:seed` e **sobrevivem** ao `pnpm db:limpar`.
> O seed **nunca sobrescreve a senha** de uma conta que já existe — pode rodar à vontade.
> **`root@medconsultoria.com.br` é o root primordial protegido** (config `ROOT_PROTEGIDO_EMAIL`): garante que a aplicação nunca fique sem super-admin. Os demais roots podem ser alterados/rebaixados entre si por qualquer ROOT.

**FUNCIONÁRIO e CLIENTE:** não existem mais como conta fixa. A limpeza de 20/07/2026 removeu
os usuários fictícios — inclusive o antigo login de teste `cliente@medconsultoria.com.br`
(**removido**, não use mais). Crie-os pelo fluxo real da aplicação:

- **funcionário** → **Ajustes → Equipe e acessos → convidar** (o convite chega por e-mail);
- **cliente** → cadastre o cliente e use **"Enviar acesso ao Portal"** na ficha dele.

> ⚠️ **A senha real é a do `.env` (`SEED_ROOT_PASSWORD`)**, não a que está escrita aqui. Hoje as
> duas coincidem (`medconsultoria123` — conferido). Se alguém mudar o `.env`, **este documento
> passa a mentir** e o `pnpm acessos` continuará dando ✓ (ele testa com a senha do `.env`).
> Ao trocar a senha, atualize esta tabela.

### ❓ Não está conseguindo entrar?

Rode **`pnpm acessos`**. Ele testa o login de cada conta contra a aplicação no ar e diz o
motivo exato (conta inativa, sem senha, senha trocada, bloqueio por tentativas).

**A causa mais comum é o autofill do navegador** repondo uma conta antiga: a página abre com
um e-mail já preenchido, você clica em Entrar sem reparar, e leva "E-mail ou senha incorretos".
O erro agora mostra **qual e-mail foi tentado** — se não for o seu, apague o campo e digite de
novo (ou use uma janela anônima, `Ctrl+Shift+N`).

> Senhas só de teste local. Em produção, senhas reais e fortes.
> **Novidade:** dá para trocar a própria senha e editar o perfil em **Configurações** (menu do usuário, no rodapé da barra lateral).

---

## 🔗 Links da área interna (equipe) — abrem dentro de http://localhost:4310

| Tela                            | Link                                | O que é                                                                                                                                                                 |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🏠**Dashboard**           | http://localhost:4310/              | "O que precisa da sua atenção hoje": **ações rápidas** no topo, **✨ Seu dia com a IA** (plano priorizado do que fazer hoje), central de atenção, leads no funil, reuniões, tarefas, financeiro (admin), **clientes querendo mais (upsell)** — tudo clicável e por papel   |
| 🎯**Funil de vendas**     | http://localhost:4310/leads         | Kanban de leads —**arraste os cartões** entre as etapas; botão **Converter** transforma um lead em cliente                                                |
| 👥**Clientes**            | http://localhost:4310/clientes      | Só seus **clientes** (Ativos/Inativos). KPIs, filtros Todos/Ativos/Inativos, selo **"No funil"** (quer mais), e o botão **"Enviar acesso"** (manda o convite do Portal, igual ao Funil). Na ficha: **Ativar/Desativar**, **Enviar acesso ao Portal** (ou "Portal ativo") + card **"Negócios & serviços"** (serviços contratados, valor, cliente desde, o que quer agora) |
| 📄**Ficha do cliente**    | (clique num cliente)                | Hub do cliente: contatos, anotações, **origem comercial**, projetos, documentos, reuniões, financeiro (admin), e-mails e **suporte**. Dá para **Ativar/Desativar** o cliente (com confirmação); o botão **"Nova oportunidade"** abre um novo negócio no funil (escolhendo os **serviços** — o card e as tarefas já nascem prontos) sem transformar o cliente em lead. Toda exclusão pede confirmação |
| 🧰**Serviços**            | http://localhost:4310/servicos      | **Admin**: catálogo de serviços da Med e os **passos de cada etapa** que entram no checklist do lead                                                                    |
| 📁**Projetos**            | http://localhost:4310/projetos      | Projetos por cliente; clique para abrir o kanban                                                                                                                         |
| 🗂️**Kanban do projeto** | (clique num projeto)                | Colunas **A fazer → Em andamento → Aguardando cliente / Aguardando terceiros → Concluído**. **Arraste o cartão por qualquer lugar** dele; **clique** no cartão para abrir (checklist, **cronômetro**, comentários). Concluir todos os cartões **conclui o projeto sozinho**; contratar um serviço **já cria o cartão** no projeto |
| ✅**Tarefas**             | http://localhost:4310/tarefas       | **Delegação entre a equipe**: peça e acompanhe o que combina com os colegas. Abas **Comigo** (pediram a você) e **Deleguei** (você pediu); admin vê **Da equipe**. Botão **"Delegar tarefa"** também na ficha do cliente e no projeto. Avisa ao delegar e ao concluir; aparece em **"Pedidos comigo"** no Início. *(≠ Projetos, que é entrega do cliente; ≠ Agenda, que é hora marcada.)* |
| 📅**Agenda**              | http://localhost:4310/agenda        | Semana com compromissos/retornos/reuniões;**Novo evento**, link "Entrar" nas reuniões; **🔔 sino** no topo avisa lembretes em tempo real                   |
| 💬**Mensagens**           | http://localhost:4310/mensagens     | Chat interno em tempo real: conversas individuais e grupos, não-lidas. Botão**+** para nova conversa                                                                   |
| 📄**Documentos**          | http://localhost:4310/documentos    | Gera proposta/ata/briefing a partir de modelos com`{{variáveis}}` **ou com IA (✨)**; fluxo rascunho→revisão→**aprovação**→enviado; export PDF/Word |
| 🧩**Modelos**             | http://localhost:4310/modelos       | **Admin**: biblioteca de **modelos de documentos** (com `{{variáveis}}`) que alimentam a tela Documentos |
| 🛠️**Ajustes**            | http://localhost:4310/ajustes       | **Admin**: catálogos e configurações — Modelos, **Categorias**, **Origens**, **Operadoras** e **Dados da empresa** (CNPJ/razão/endereço/foro editáveis) |
| 💰**Financeiro**          | http://localhost:4310/financeiro    | Contas a pagar/receber, resumo,**alerta de vencidas**, marcar paga, **gerenciar categorias**. **Só administradores**                                  |
| ⚙️**Configurações**   | http://localhost:4310/configuracoes | Editar seu**perfil** e **trocar a senha** (abre pelo menu do usuário)                                                                                       |
| 👤**Usuários & acessos** | http://localhost:4310/usuarios      | **Admin**: cadastrar equipe interna **e criar acessos ao Portal do Cliente**                                                                                 |
| ✉️**Comunicações**      | http://localhost:4310/emails        | **Admin**: editar os **textos dos e-mails** que o sistema envia (boas-vindas, avisos, etc.)                                                                     |
| 📤**E-mails enviados**   | http://localhost:4310/emails-enviados | **Admin/ROOT**: **monitor** de tudo que o sistema enviou — quantos foram, **quantos falharam e por quê**, com filtros (enviados/só falhas/tipo/período/busca)     |
| 🩺**Sistema**            | http://localhost:4310/sistema       | **Só ROOT**: saúde do sistema, desempenho, erros, incidentes e sessões ativas                                                                                    |

---

> **Briefings online (novo).** Além de anexar arquivos, o cliente pode **preencher formulários direto na tela** (ex.: Briefing de site, de logo, de redes sociais) — no Portal, é só clicar em **"Preencher na tela"**; ele também pode **Baixar** se preferir. A equipe vê as respostas na ficha. Você cria e edita esses formulários em **Documentos → aba Formulários** — sem programar — e liga cada um a um serviço na aba **Exigências** (em Serviços).

> **✨ IA por toda a parte (a IA sugere, você aprova).** Onde tiver a estrelinha ✨: em **Serviços** (Exigências) → "Sugerir com IA" monta o checklist de documentos; em **Documentos → Formulários** → "Sugerir perguntas" cria o briefing; na **ficha do cliente** → "Resumir com IA" dá um resumo + próximos passos; no **funil** (abrindo um lead) → "Próximo passo" e "Escrever e-mail". Também: gerar/melhorar documentos, a apresentação da proposta e a busca inteligente (Ctrl+K). Nada é enviado sozinho — a IA sempre entrega um rascunho para você conferir.

> **Serviços contratados e documentos (novo).** Na **ficha do cliente**, o card **"Serviços contratados"** mostra tudo que a Med oferece — clique em **Contratar** para ligar um serviço (ou **Cancelar** para desligar). Cada serviço tem uma **lista de documentos** que o cliente precisa enviar (ex.: credenciamento → docs dos médicos); a equipe e o cliente podem **anexar arquivos** ali. No **Portal do Cliente**, o card **"Seus serviços"** mostra o que falta ele enviar — ele anexa direto por lá, e você **recebe um aviso** (notificação + e-mail) na hora. Os documentos que cada serviço pede são configurados em **Serviços** (ícone de prancheta) — já vêm com exemplos prontos para a Thaís ajustar. *(Em breve: briefings que o cliente responde online, sem baixar nada.)*

> **Você decide quando o cliente recebe e-mail.** Ao **cadastrar um cliente**, **converter um lead**, **solicitar assinatura** ou **agendar um evento com um cliente**, aparece um pop-up de confirmação com uma **caixinha "enviar e-mail?"** — marque para avisar o cliente (acesso ao Portal, boas-vindas, link de assinatura, aviso da reunião) ou desmarque para não enviar. Nada de e-mail automático sem você querer. (A **captação pública** e o botão **"Enviar acesso"** enviam direto, porque enviar é o próprio objetivo.) Se converter um lead **sem serviço marcado**, o pop-up avisa — e a ficha de um cliente sem serviço mostra um lembrete para registrar o que ele contratou.

---

## 🌐 Links públicos (abrem sem login)

| Link                                        | O que é                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **http://localhost:4310/comecar**     | **Formulário de captação** ("Fale com a MedConsultoria") para pôr no site — quem preenche vira um lead no funil (com a **origem detectada** automaticamente) e já ganha acesso ao Portal para acompanhar. *(Nome antigo `/captura` foi removido — "captura" assustava o futuro cliente.)* |
| `http://localhost:4310/assinar/...`       | Página de **assinatura eletrônica** de um documento (o link vai por e-mail para o cliente assinar proposta/contrato)             |

> No **Funil de vendas**, o botão **"Link de captação"** copia o endereço do formulário público. Cadastro **manual** de lead também registra "de onde veio". O botão **"Perdidos"** mostra os leads que não avançaram (com o motivo) e permite **reabrir**.

---

## 🔎 Busca inteligente (Ctrl + K) — com IA

No topo de qualquer tela há uma **busca global**. Aperte **Ctrl + K** (ou clique nela) e:

- **Busque de verdade** por clientes, leads, projetos e documentos — os resultados aparecem agrupados e levam direto ao registro (não é mais só o menu).
- **Pergunte à IA** ✨ — digite uma dúvida em linguagem natural (ex.: *"Como faço para lançar uma conta a pagar?"*) e a assistente responde ali mesmo. A IA guia o uso do sistema; ela **nunca** executa ações sozinha, e toda resposta traz o aviso de conferir antes de agir.

> A IA só aparece quando a chave do provedor (`OPENAI_API_KEY`) está configurada no `.env`. Sem ela, a busca por dados continua funcionando normalmente.

**Autocomplete:** os campos de **cliente** nos formulários (projeto, conta, evento, documento, acesso de Portal) agora têm **busca com sugestão** — comece a digitar e escolha na lista, em vez de rolar um seletor grande.

---

## 🧑💼 Portal do Cliente (área do cliente)

O cliente entra pelo **mesmo endereço** (http://localhost:4310) com um login de papel **CLIENTE** e cai num ambiente **separado e isolado** — ele nunca vê o menu interno nem dados de outros clientes.

- **Como testar:** crie um acesso de Portal para um cliente real (ver abaixo) — não há mais login de teste fixo.
- **O que o cliente vê:** o **andamento do atendimento** (a etapa do funil em linguagem amigável), **documentos para assinar**, projetos, documentos, **e-mails recebidos**, próximas reuniões e um **chat de Suporte** com a equipe — tudo vinculado **apenas ao cadastro dele** (Acme Saude).
- **Prospect (ainda não é cliente):** quem chega pela captação também ganha acesso e acompanha o próprio atendimento pelo Portal desde o primeiro contato.
- **Liberdade do cliente:** no card "Seu atendimento" há um link discreto **"Não tenho mais interesse"** — se o cliente desistir, o lead vai automaticamente para **Perdidos** na aplicação (e a equipe é avisada). Se mudar de ideia, aparece um botão **"Quero retomar"** que o traz de volta ao funil.
- **Autosserviço ("O que você precisa?"):** o cliente escolhe no Portal os **serviços** que precisa e clica em **Solicitar** → automaticamente vira uma **oportunidade no Funil de vendas** (com esses serviços e o checklist certo) e a **equipe é avisada** (notificação + e-mail). O que ele já pediu aparece marcado.
- **Como criar um acesso de Portal para um cliente real:** em **Usuários & acessos** (admin) → **Novo usuário** → papel **Cliente** → escolha o cliente. Pronto: aquele cliente ganha login no Portal, restrito aos dados dele.

---

## 🧭 Roteiro para você experimentar (3 minutos)

1. Abra **http://localhost:4310** e faça login como Thaís.
2. Aperte **Ctrl + K**, digite **"Acme"** e veja os resultados reais; depois experimente **"Perguntar à IA"** com uma dúvida.
3. Clique em **Funil de vendas** e **arraste** um cartão entre colunas.
4. Clique em **Converter** num lead → ele vira cliente e abre a ficha.
5. Em **Projetos** → **Novo projeto** → note o campo **Cliente** com autocomplete.
6. Abra **Configurações** (rodapé da barra lateral, no seu nome) e veja perfil/senha.
7. Em **Usuários & acessos**, crie um acesso de **Portal** para um cliente e depois entre com ele para ver a área do cliente.

> Os dados de exemplo (clientes, leads, projetos, documentos) existem só para as telas não ficarem vazias. Pode editar/apagar à vontade — é ambiente de teste.

---

## ⚙️ Como ligar / desligar (para você ou um dev)

No terminal, dentro da pasta do projeto:

```bash
# 1) Ligar o banco de dados (uma vez)
pnpm db:up

# 2) Ligar a aplicação (API + site juntos)
pnpm dev
```

Depois é só abrir **http://localhost:4310**.

**Comandos úteis:**

| Comando                           | O que faz                                 |
| --------------------------------- | ----------------------------------------- |
| `pnpm dev`                      | Liga API (porta 4319) + site (porta 4310) |
| `pnpm db:up` / `pnpm db:down` | Liga / desliga o banco (Docker)           |
| `pnpm db:demo`                  | Recria os dados de exemplo (só em banco local — trava de produção) |
| `pnpm db:seed`                  | Recria o usuário ROOT + as etapas do funil |
| `pnpm test:e2e:isolado`         | Roda os testes num banco SEPARADO (`medconsultoria_e2e`) — não suja o banco de desenvolvimento |

**Para desligar a aplicação:** aperte `Ctrl + C` no terminal onde o `pnpm dev` está rodando.

---

## 🤖 Ligar a IA (opcional)

A busca com IA e a geração de documentos com IA usam a **OpenAI**. Para ativar:

1. Pegue uma chave em https://platform.openai.com (começa com `sk-...`).
2. No arquivo `.env` (raiz do projeto), preencha: `OPENAI_API_KEY="sk-..."`.
3. Reinicie a aplicação (`Ctrl + C` e `pnpm dev` de novo).

Sem chave, o app funciona normalmente — só as funções de IA ficam ocultas.

---

## 🔌 Portas usadas (escolhidas para não conflitar com seus outros projetos)

| Serviço                | Porta          |
| ----------------------- | -------------- |
| Site (o que você abre) | **4310** |
| API (bastidores)        | **4319** |
| Banco MySQL (Docker)    | **3307** |

Verificação técnica da API (opcional): http://localhost:4319/health deve responder `{"status":"ok"}`.

---

## 📌 Importante

- Isto roda **na sua máquina** — só você acessa. Ninguém de fora vê.
- O ambiente de produção é separado (ver seção "Acessos de PRODUÇÃO" abaixo).

---

## 🌐 Acessos de PRODUÇÃO

> App **já publicado e no ar**. Senhas reais não ficam neste documento — só quem tem a senha sabe.

- **URL:** https://workspace.medconsultoria.com.br
- **ROOT:** `root@medconsultoria.com.br` — senha trocada pelo dono diretamente no app (Configurações).
- **ADMIN (Thaís):** `thais.garcia@medconsultoria.com.br` — senha de teste até ela trocar pelo app.
- **SSH (deploy):** porta `1992`, chave `~/.ssh/medconsultoria_deploy`.
- Não existe mais login de teste de CLIENTE/FUNCIONÁRIO fixo em produção — crie acessos pelo fluxo real (Equipe e acessos / Enviar acesso ao Portal).

---

## 🩺 Verificar a saúde da aplicação

| Comando | O que faz |
| --- | --- |
| `pnpm doutor` | **Varre a área da equipe num navegador real** — 15 rotas × **8 tamanhos de tela** (320px a 1920px) — e lista os defeitos. Somente leitura: não cria, não apaga, não envia e-mail. |
| `pnpm doutor --perfil admin` | O mesmo, entrando como ADMIN (permissões diferentes) |
| `pnpm doutor --perfil cliente` | Varre o **Portal do Cliente** (precisa de um cliente com acesso ao Portal) |
| `pnpm acessos` | Testa o login de cada conta e diz o motivo exato de cada falha |
| `pnpm verificar:bootstrap` | Ensaio de banco limpo — o que acontecerá em produção |

O **doutor** detecta: página que não carrega, quebra ou fica em branco · erro de JavaScript ·
valores crus vazando na tela (`undefined`, `NaN`, `Invalid Date`…) · rolagem horizontal (layout
que não cabe) · link quebrado · imagem que não carregou · texto em inglês · campo de formulário
sem rótulo. Sai com erro se achar algo — dá para usar em automação.
