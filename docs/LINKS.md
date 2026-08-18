# 🔗 LINKS E ACESSOS — Workspace MedConsultoria

> **Para que serve este arquivo:** saber, sem precisar perguntar a ninguém, **onde clicar** para
> ver a aplicação funcionando, o que é cada porta e o que fazer quando algo não abre.
> Escrito para ser entendido sem conhecimento técnico.
>
> Última verificação: **18/08/2026** (tudo abaixo foi testado, não é suposição —
> a tela respondeu `200` e o motor respondeu `{"status":"ok"}`).

---

## 1. O que abrir agora (os 3 links do dia a dia)

| Clique aqui | O que é |
| ----------- | ------- |
| **http://localhost:4310** | 🖥️ **A aplicação na sua máquina.** É aqui que você testa antes de subir para o ar. Mudanças no código aparecem sozinhas, sem recarregar. |
| **https://workspace.medconsultoria.com.br** | 🌐 **A aplicação de verdade**, que a Thaís e os clientes usam. |
| **http://localhost:4319/health** | 🩺 **Sinal de vida do motor local.** Se aparecer `{"status":"ok"}`, o servidor está de pé. Se não abrir, a aplicação local está fora. |

**Regra simples:** `localhost` = sua máquina, só você vê. `workspace.medconsultoria.com.br` = o ar,
todo mundo vê. Nunca teste coisa arriscada no segundo.

---

## 2. Todas as portas deste projeto

Uma "porta" é como um número de sala: o mesmo computador atende várias coisas ao mesmo tempo,
cada uma na sua sala.

| Porta | Serviço | Endereço | Precisa estar ligada? |
| ----- | ------- | -------- | --------------------- |
| **4310** | Tela da aplicação (front-end) | http://localhost:4310 | ✅ Sim, é o que você abre |
| **4319** | Motor da aplicação (API/back-end) | http://localhost:4319 | ✅ Sim, a tela não funciona sem ele |
| **3307** | Banco de dados MySQL (Docker) | `localhost:3307` | ✅ Sim, é onde ficam os dados |
| **4330** | Mapa do código (painel do CBM) | http://localhost:4330/painel.html | ⬜ Não, só quando quiser ver |

> **Por que 3307 e não 3306?** 3306 é a porta padrão do MySQL e já estava ocupada por outro
> programa na sua máquina. Mudamos para 3307 para não brigarem.

### Endereços úteis do motor (porta 4319)

| Endereço | O que faz |
| -------- | --------- |
| http://localhost:4319/health | Diz se o motor está vivo |
| `http://localhost:4319/trpc/…` | Por onde a tela conversa com o motor (não é para abrir no navegador) |

---

## 3. ❓ "Cadê o Swagger?"

**Este projeto não tem Swagger — e isso é de propósito, não é falta.**

Swagger é uma tela que lista os endereços de uma API para quem for programar contra ela. Ele
existe porque, numa API tradicional (REST), o programador do front precisa **descobrir** o que o
back-end aceita.

Aqui a API é **tRPC**: o front e o back compartilham o mesmo código de tipos. Se alguém escrever
uma chamada errada, **o projeto não compila** — o erro aparece na hora de escrever, não depois de
publicar. Swagger seria um documento a mais para manter desatualizado.

Se um dia um sistema **de fora** (outra empresa, um app) precisar conversar com esta aplicação,
aí sim vale criar endereços REST com Swagger. Hoje ninguém de fora consome esta API.

---

## 4. Páginas públicas (abrem sem login)

Servem para o cliente/prospect, e funcionam nos dois ambientes.

| Página | Local | No ar |
| ------ | ----- | ----- |
| Captação de lead | http://localhost:4310/comecar | https://workspace.medconsultoria.com.br/comecar |
| Aceite de proposta | `/proposta/{token}` | idem |
| Assinatura de documento | `/assinar/{token}` | idem |

O `{token}` é gerado pela aplicação e vai no link enviado ao cliente — não dá para adivinhar.

---

## 3-B. 🩺 O Painel de Credenciamentos (`/credenciamentos`)

| Clique aqui | O que é |
| ----------- | ------- |
| http://localhost:4310/credenciamentos | **Todos os credenciamentos, de todos os clientes, numa tela só.** Cada linha é um médico numa operadora. Abre mostrando o que está parado há mais tempo, e marca em amarelo o que passou de **60 dias** sem resposta. |

**Para que serve, em uma frase:** responder "o que travou e eu preciso cobrar hoje?" sem abrir cliente por cliente.

- **A faixa amarela no topo** diz quantos processos estão parados demais. Clicar nela mostra só esses.
- **Os três filtros** (cliente, operadora, situação) funcionam juntos: "Omint" + "Em análise" mostra só o que está parado naquela operadora.
- **O botão "Atualizar"** muda a situação sem sair da tela. Marcar **Aprovado** é o que **cria a cobrança** no Financeiro — o diálogo avisa o valor antes de você salvar.
- **Mudar o prazo de 60 dias:** Ajustes → Dados da empresa → "Avisar quando parar por mais de (dias)".

---

## 4-A. 📬 A página de e-mail (`/email`)

| Clique aqui | O que é |
| ----------- | ------- |
| http://localhost:4310/email | **Sua caixa de e-mail dentro do Workspace** — ler, escrever, responder e encaminhar sem abrir o webmail. Ao abrir um e-mail você também **guarda o anexo direto nos documentos do cliente** (botão "guardar", ao lado do nome do arquivo) e **põe no funil** quem escreveu pela primeira vez (botão "Virar lead"). |

**Cuidado para não confundir**, porque os três nomes se parecem e as três páginas são coisas diferentes:

| Endereço | O que é | Quem vê |
| -------- | ------- | ------- |
| `/email` (singular) | **A sua caixa de verdade** (a que você pluga com a senha do webmail) | Toda a equipe — e **só você enxerga a sua** |
| `/emails` | **Mensagens automáticas**: os modelos de e-mail que o sistema dispara sozinho | ADMIN |
| `/emails-enviados` | **Monitor de envios**: o que a aplicação mandou, o que falhou e por quê | ADMIN |

**Como plugar a sua caixa:** abra `/email` → botão **Adicionar caixa** → e-mail `@medconsultoria.com.br` + **a mesma senha que você usa no webmail** + seu nome. A aplicação **testa a conexão antes de gravar**: se a senha estiver errada, ela diz isso e não guarda nada. A senha fica **cifrada** no banco e nunca reaparece na tela.

**O que a tela faz hoje:**

- **Escrever um e-mail novo** — botão "Escrever", preenche Para/Cc/Cco, assunto e o texto, e pode **anexar arquivo** (até 20 MB cada, 25 MB somados no e-mail inteiro).
- **Responder** ou **Responder a todos** um e-mail recebido — abre já com o destinatário certo, o assunto com "Re:" e o texto original citado abaixo. Quando você responde, o e-mail original ganha uma marca de "respondido" (aparece também para quem olhar do outro lado, no celular ou no webmail).
- **Encaminhar** — manda o e-mail para outra pessoa, com "Fwd:" no assunto. Encaminhar **não** marca o original como respondido (faz sentido: você não respondeu a quem escreveu, só repassou).
- **Baixar um anexo** que alguém te mandou — clique e o navegador baixa o arquivo (nunca abre/executa direto, mesmo que seja uma página).
- **Rascunho automático:** enquanto você escreve, a aplicação salva sozinha na pasta **Rascunhos do seu e-mail de verdade** (a cada ~5 segundos de pausa) — se fechar sem terminar, o texto está lá, inclusive se você abrir o webmail de outro computador. Ao enviar, o rascunho correspondente é apagado sozinho.

**O e-mail do cliente aparece na ficha dele.** Abra **Clientes → o cliente** (ou o painel do lead, em Vendas) e olhe o card **"E-mails"**: ali fica, em ordem de data, tudo o que a empresa trocou com aquela pessoa — os avisos que o sistema mandou sozinho **e** os e-mails escritos por gente, de qualquer caixa da equipe. Cada linha tem um selo dizendo de onde veio ("Enviado pelo sistema" ou "Caixa de Fulano").

**O que a equipe vê ali é só a "capa" do e-mail:** quem mandou, para quem, assunto, data e as primeiras linhas. **O texto inteiro ninguém lê pela ficha** — só o dono da caixa, na própria caixa (o link "Abrir na minha caixa" aparece só para ele).

**E se um e-mail for pessoal?** Quem é dono da caixa clica em **"Tirar da ficha"** naquela linha: ele some da ficha para toda a equipe na hora. Para devolvê-lo, abra o e-mail em `/email` e clique em **"Devolver à ficha"** — a ficha só tira; quem devolve é a caixa. Rascunho, lixeira e spam **nunca** aparecem na ficha.

**Só para desenvolvimento/teste:** fora do site em produção, o envio só é aceito para `tibamooca@gmail.com` ou `contato@medconsultoria.com.br` — é uma trava da própria aplicação (não dá para "esquecer" e mandar e-mail de teste para um cliente de verdade).

**Não funciona ainda com Gmail nem Hotmail** (de propósito): esses exigem login próprio do Google/Microsoft. Fase 1 é só o domínio da Med.

**Se aparecer "não consegui falar com…"**: o problema é rede/servidor, não a sua senha — a mensagem distingue os dois casos. Em produção, se a página não deixar plugar caixa nenhuma, falta a variável `EMAIL_CRYPTO_KEY` no `.env` do servidor (ver `DEPLOY.md`).

---

## 5. Como ligar e desligar a aplicação local

**Para ligar** (é o que eu faço automaticamente na primeira tarefa do dia):

```
pnpm db:up                    # sobe o banco (Docker) — só se estiver desligado
node scripts/keep-alive.mjs   # sobe a aplicação e a RE-SOBE sozinha se cair
```

O `keep-alive` é um vigia: se a aplicação travar, ele reinicia em segundos. O registro do que
aconteceu fica em `scripts/.keepalive.log`.

**Para pausar** (necessário só quando se mexe na estrutura do banco):

```
touch scripts/.keepalive-pause    # o vigia para e espera
rm scripts/.keepalive-pause       # o vigia volta a subir
```

> ⚠️ **Nunca feche o Node "na força"** (matar processo) para mexer no banco — use a pausa acima.
> Fechar na força deixa o banco travado pela metade.

**Se não abrir:** confira nesta ordem — (1) `http://localhost:4319/health` responde? (2) o Docker
está aberto? (3) veja as últimas linhas de `scripts/.keepalive.log`.

> ⚠️ **Se a tela aparecer na porta 4311 em vez da 4310**, o vigia foi ligado **duas vezes**: o
> segundo não conseguiu a 4310 (já ocupada pelo primeiro) e caiu para a 4311. Não é defeito da
> aplicação, mas engana feio — você testa numa tela e confere na outra, e as duas discordam.
> Aconteceu em 05/08/2026. A saída é ficar com **um** vigia só: `touch scripts/.keepalive-pause`,
> fechar os dois, apagar a pausa e ligar de novo. Pode pedir a mim, é um minuto.

> 💡 **O `/health` da API responde, mas `http://localhost:4319` sozinho devolve 404.** Está certo:
> a raiz da API não tem página — quem tem tela é a 4310. Não confunda esse 404 com aplicação fora
> do ar (aconteceu comigo em 18/08/2026, conferindo a porta errada).

---

## 6. Outros projetos ocupando portas nesta máquina

Você tem vários projetos e o Docker mantém os containers ligados mesmo quando você não está
trabalhando neles. **Nada abaixo pertence ao Workspace MedConsultoria** — está aqui só para você
não confundir uma tela de outro projeto com esta.

| Porta | De quem é |
| ----- | --------- |
| 3939 | Site do **Grimoire** (Next.js) |
| 8080 | `sophia-web` (projeto Sophia Camargo) |
| 8090 | `medcrm-nginx` (projeto MedCRM) |
| 8025 / 1025 | Mailpit do **Sophia Camargo** |
| 8039 / 1039 | Mailpit do **Grimoire** |
| 5432 | Postgres do **MedCRM** |
| 5433 | Postgres do **Inkflow** |
| 5435 | Postgres do **Grimoire** |
| 6379 | Redis do **Inkflow** |
| 9000 / 9001 | MinIO (armazenamento de arquivos) do **Inkflow** |
| 3306 | MySQL do **cad_anest** (outro projeto) |
| 3312 | MySQL do **CCVP** (outro projeto) |
| 8099 | Um servidor **PHP** solto na máquina (não é do Docker nem deste projeto) |
| 3119 / 31190 | MySQL instalado direto no Windows (não é do Docker) |
| 9749 | Servidor do **Codebase Memory** (o mapa de código que eu uso) |
| 54321 – 54327 | **Supabase do projeto "Dents"** — banco, painel, API e caixa de e-mail de teste, tudo em containers próprios (visto ligado em 18/08/2026) |

> ⚠️ **Cuidado com o Mailpit.** Mailpit é uma caixa de entrada falsa, para ver e-mails de teste
> sem enviar de verdade. A da porta 8025 é do **Sophia Camargo**. Se um e-mail deste projeto cair
> lá, é porque a configuração local está apontando para ela — não é a caixa "oficial" daqui.
> **Em produção os e-mails são reais** e só devem ser testados com `tibamooca@gmail.com` ou
> `contato@medconsultoria.com.br`.

---

## 7. Mapa do código (painel do CBM)

**http://localhost:4330/painel.html**

O **Codebase Memory** é o mapa do código que eu uso para achar as coisas sem ler o projeto
inteiro toda vez: **4.314 partes mapeadas, 10.385 ligações entre elas.** O painel mostra isso em
tela — tamanho de cada área do sistema, as peças mais reutilizadas, onde o código é mais difícil
e como as partes dependem umas das outras. Cada gráfico vem com a explicação do que significa.

**Para abrir** (ele não sobe junto com a aplicação, é um servidor separado e leve):

```
cd docs/cbm && python -m http.server 4330 --bind 127.0.0.1
```

Depois é só abrir o link acima. Para fechar, `Ctrl+C` na janela onde rodou.

> O painel é **estático**: mostra o retrato do código no dia em que foi gerado (a data está no
> topo da página). Depois de mudanças grandes, peça para eu reindexar o CBM e regerar — os
> números não se atualizam sozinhos.
>
> Também dá para abrir o arquivo direto, sem servidor: `docs/cbm/painel.html` no navegador.
> A porta existe porque assim você tem um link igual aos outros.

---

## 8. Contas de acesso

### 8-A. Para VOCÊ testar na sua máquina (pode usar à vontade)

Estas contas existem **só no seu computador**. A senha está escrita aqui de propósito: ela não é
segredo, é dado de teste — do mesmo jeito que um manequim de vitrine não é uma pessoa.

| Entre com | O que você vê |
| --------- | ------------- |
| `root@teste.local` | **Tudo**, inclusive o painel técnico "Sistema" |
| `admin@teste.local` | O que a Thaís vê (a empresa inteira, sem a parte técnica) |
| `funcionario@teste.local` | O que um funcionário vê (só o trabalho dele) |
| `cliente@teste.local` | O **Portal do Cliente**, do lado de fora |

**Senha de todas: `teste1234`**

Se alguma parar de funcionar (ou se você limpar o banco), recrie com:

```
pnpm contas:teste
```

O que aparece se der certo: uma linha `✔` para cada conta e, no fim, `✓ 4 contas de teste prontas`.

> 🔒 **Por que isso é seguro:** o comando **se recusa a rodar no servidor**. A aplicação que está
> no ar tem contas de verdade, com senhas de verdade, e nenhuma dessas quatro existe lá.
> Você também reconhece a máquina de ensaio pela tela: sempre que estiver rodando localmente,
> aparece um selo amarelo embaixo escrito **"AMBIENTE LOCAL — dados de teste"**.

### 8-B. As contas de verdade (as que existem no ar)

As contas reais e os papéis de cada uma estão em **[`ACESSOS.md`](./ACESSOS.md)**.

**Senha delas não é escrita em documento nenhum** — nem aqui, nem lá. Ao entrar pela primeira vez, a
própria aplicação obriga cada pessoa da equipe a definir uma senha só dela (ADR-91). Se esquecer,
use **"Esqueci minha senha"** na tela de login.

### Trocar a senha de teste da sua máquina

Serve quando a senha de desenvolvimento pode ter sido vista por alguém (foi o caso em
05/08/2026). **Só afeta esta máquina** — produção não é tocada.

```
pnpm senha:rotacionar
```

O que aparece se der certo: uma linha `✔ senha reescrita no banco` para cada conta interna e,
no fim, `✓ Senha de seed rotacionada`. **A senha nova não é mostrada de propósito** (o terminal
guarda o que passa por ele): ela fica na linha `SEED_ROOT_PASSWORD` do arquivo `.env`, na raiz do
projeto — abra o arquivo se precisar digitá-la.

Se der errado, a mensagem diz o motivo e **nada muda** (o `.env` volta como estava). O erro mais
comum é o banco desligado: rode `pnpm db:up` e tente de novo. Depois, confira com `pnpm acessos`
— todas as contas devem dizer "✓ entra com a senha de teste".

---

## 8.5. Como colocar no ar (mudou em 17/08/2026)

Publicar **não é mais um comando** — é um botão, e você mesmo consegue apertar.

1. Abra: **https://github.com/thi-garcia/workspace-medconsultoria/actions/workflows/deploy.yml**
2. Botão **"Run workflow"**, no canto direito.
3. No campo que aparece, digite **`PUBLICAR`** (em maiúsculas) e confirme.

**Deu certo quando** o último passo — *"Smoke test"* — ficar verde mostrando
`{"status":"ok"}` e o endereço do site.

**Deu errado?** O passo que falhou fica vermelho e diz o motivo. Se falhou no
passo *"Ensaio de boot"*, **o site não foi tocado**: ele continua no ar na versão
anterior, e não há nada urgente a fazer.

**Pode apertar duas vezes sem medo.** A segunda execução espera a primeira
terminar — antigamente, rodar dois deploys ao mesmo tempo estragava os dois.

O detalhe técnico está em [`DEPLOY.md`](./DEPLOY.md) §0.

---

## 9. Onde está o resto

| Assunto | Arquivo |
| ------- | ------- |
| Contas, papéis e todas as telas | [`ACESSOS.md`](./ACESSOS.md) |
| Como subir para o ar (deploy) | [`DEPLOY.md`](./DEPLOY.md) |
| Visão geral do projeto | [`CLAUDE.md`](./CLAUDE.md) |
| Por que cada decisão foi tomada | [`DECISIONS.md`](./DECISIONS.md) |
| Estrutura do banco de dados | [`DATABASE.md`](./DATABASE.md) |
