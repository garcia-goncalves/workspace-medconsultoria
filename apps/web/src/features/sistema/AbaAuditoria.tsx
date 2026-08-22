import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, TrendingUp, XCircle } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";

/**
 * Auditoria completa do projeto — DOCUMENTO CARIMBADO, não painel ao vivo.
 *
 * Por que fixo e não puxado da API: os números aqui vêm de comandos rodados fora da
 * aplicação (`pnpm -r typecheck`, `pnpm audit --prod`, `conferir-artefato.mjs`, `gh api`,
 * `curl` na produção). Nada disso a API sabe responder, e inventar uma consulta que
 * devolvesse "89%" seria fingir precisão que a conta não tem. A data e o commit estão no
 * topo justamente para o leitor saber de quando é — auditoria que se apresenta como
 * atualizada sem ser é pior do que auditoria velha e datada.
 *
 * Para atualizar: rodar os comandos de novo e reescrever as constantes deste arquivo.
 */

const DATA = "22 de agosto de 2026";
const COMMIT = "f23a1f2";
const NOTA_GERAL = 89;
const NOTA_ANTERIOR = 87;

/* ----------------------------- Dados da auditoria ----------------------------- */

type Tom = "ok" | "alerta" | "ruim";

const DIMENSOES: { nome: string; peso: number; nota: number; antes?: number; tom: Tom; tem: string; falta: string }[] = [
  {
    nome: "Funcionalidade",
    peso: 20,
    nota: 97,
    antes: 96,
    tom: "ok",
    tem: "As 10 fases do roadmap fechadas, a evolução pós-MVP, o credenciamento inteligente e esta aba. E uma função que existia no código e nunca funcionou passou a funcionar: nenhum e-mail jamais tinha saído de produção — 25 falhas em 7 dias, taxa de entrega 0% desde sempre — porque o certificado do SMTP local não se chama “localhost” (ADR-122).",
    falta: "Briefings online (o cliente responder na tela), timeline consolidada na ficha e o modo escuro — os tokens existem no CSS, o botão não.",
  },
  {
    nome: "Segurança da aplicação",
    peso: 15,
    nota: 90,
    antes: 90,
    tom: "ok",
    tem: "290 dos 305 endpoints atrás de guarda de papel. Argon2id, helmet, freio de 300 req/min, cookie assinado httpOnly com SameSite=lax, upload com allowlist e checagem de posse, senha de caixa cifrada em AES-GCM. A dispensa de certificado da ADR-122 vale só para loopback, contra conjunto fechado — e a caixa pessoal de cada um não foi tocada.",
    falta: "Proteção CSRF explícita (hoje só SameSite + origem) e as pendências de segredo que só o dono executa. Nada mudou aqui desde 20/08.",
  },
  {
    nome: "Testes",
    peso: 15,
    nota: 86,
    antes: 85,
    tom: "alerta",
    tem: "391 casos de unidade na API e 131 no web, rodados e verdes nesta auditoria; mais 80 de integração e 66 de ponta a ponta. O ganho é estrutural: o deploy agora chama a suíte COMPLETA no commit exato que vai ao ar (ADR-121) — em 22/08 os três jobs rodaram em f23a1f2 antes de o servidor ser tocado.",
    falta: "A cobertura não andou: 19,3% na API e 9,2% no web, com 15 módulos a 0,0% de unidade. Sem piso na CI, de propósito, até haver o que defender.",
  },
  {
    nome: "Qualidade de código",
    peso: 10,
    nota: 95,
    antes: 95,
    tom: "ok",
    tem: "Typecheck limpo nos 5 pacotes e saída de lint ZERADA, com `--max-warnings 0` ligado: aviso novo reprova. São 54,4 mil linhas de código produtivo.",
    falta: "Nada mudou aqui. A regra `react-refresh/only-export-components` segue desligada, com o porquê e a condição de religar escritos no eslint.config.mjs.",
  },
  {
    nome: "CI / CD",
    peso: 10,
    nota: 94,
    antes: 88,
    tom: "ok",
    tem: "A main tem regra de repositório ATIVA: push direto responde GH013 e exige PR com 3 verificações. Existe ponto de retorno (tag v1.0.0, a primeira do projeto). E a CI parou de estourar a cota — push na main roda só build-test em ~3 min, PR roda tudo, e o deploy chama a suíte completa (ADR-121).",
    falta: "Homologação segue inexistente, e a saída de emergência (`deploy.sh`) ainda não rodou ponta a ponta: falta a chave pública no servidor.",
  },
  {
    nome: "Operação e observabilidade",
    peso: 10,
    nota: 80,
    antes: 75,
    tom: "alerta",
    tem: "Telemetria no processo (atraso do event loop, GC, RED por endpoint), motor de alertas com histerese, health-check por cron, backup diário e aviso por e-mail ao ROOT — que só agora chega de verdade: enquanto o SMTP falhava, o canal de aviso estava mudo.",
    falta: "A restauração do backup segue sem ensaio, não há vigia externo (se a hospedagem cair, o cron cai junto) e ninguém é avisado quando a entrega de e-mail para — foram semanas a 0% até o dono reclamar.",
  },
  {
    nome: "Documentação",
    peso: 5,
    nota: 95,
    antes: 95,
    tom: "ok",
    tem: "122 ADRs e 14 documentos em docs/ explicando o porquê de cada escolha, inclusive dos erros. É o ativo mais forte do projeto depois do código.",
    falta: "Três documentos superados continuam na raiz. E o próprio retrato de entrada descrevia o lote como “esperando o disparo” horas depois de ele ter sido publicado — documentação boa também envelhece rápido.",
  },
  {
    nome: "Desempenho",
    peso: 5,
    nota: 80,
    antes: 80,
    tom: "alerta",
    tem: "O primeiro acesso são 688,5 kB brutos e 207,3 kB comprimidos — os quatro pedaços que o index.html carrega (app 353, react 143, tanstack 137, trpc 55) — mais 64,5 kB de CSS. Produção respondeu em 0,6 a 1,0 s nas quatro páginas medidas.",
    falta: "Nada mudou aqui. O próximo ganho é fatiar o pedaço da app, que sozinho é 353 kB.",
  },
  {
    nome: "Ambiente de desenvolvimento",
    peso: 5,
    nota: 75,
    antes: 75,
    tom: "alerta",
    tem: "A suíte roda em clone limpo, sem .env, e `pnpm cobertura` mede os dois pacotes de uma vez.",
    falta: "Nada mudou. `prisma migrate` ainda não enxerga o .env da raiz (precisa de DATABASE_URL exportada na mão) e o `pnpm --filter @app/db exec prisma` falha no Windows mesmo com o binário presente.",
  },
  {
    nome: "Prontidão comercial",
    peso: 5,
    nota: 74,
    antes: 70,
    tom: "alerta",
    tem: "O sistema faz proposta, aceite online, assinatura eletrônica e cobrança no sucesso do credenciamento — e agora o cliente recebe os e-mails desse fluxo, que antes morriam no servidor sem sair.",
    falta: "Razão social, CNPJ, endereço e foro: não deu para reconferir nesta rodada (o endpoint exige sessão de funcionário). Enquanto estiverem nulos, o contrato imprime “[A PREENCHER: CNPJ]”.",
  },
];

const RESOLVIDAS: { titulo: string; como: string }[] = [
  {
    titulo: "Nenhum e-mail jamais saiu de produção",
    como: "25 falhas em 7 dias e taxa de entrega 0% desde sempre, todas com a mesma mensagem: o certificado apresentado pelo SMTP local não se chama “localhost”. Não era senha, porta nem firewall. Corrigido em `email-tls.ts` dispensando só o NOME do certificado e só para loopback; a caixa pessoal de cada um não foi tocada. Publicado em 22/08 (ADR-122).",
  },
  {
    titulo: "A main não tinha proteção de ramo",
    como: "Deixou de ser disciplina e virou regra: o ruleset “Proteger main” da organização está ativo desde 21/08, e push direto responde `GH013: Changes must be made through a pull request`, com 3 verificações obrigatórias. Era a lacuna bloqueante mais antiga da lista.",
  },
  {
    titulo: "Não existia ponto de retorno",
    como: "A tag `v1.0.0` foi criada e enviada. Até 21/08 o projeto não tinha nenhuma — para voltar atrás só havia o snapshot de release no servidor, que ninguém tinha exercitado.",
  },
  {
    titulo: "A CI consumia 116% da cota de Actions da conta inteira",
    como: "2.313 min em 30 dias contra 3.000 de cota para 15 repositórios, medido tarefa a tarefa. Escalonada na ADR-121: push na main caiu de três jobs (~10 min) para um (3 min). E o corte não virou buraco de cobertura — o deploy passou a chamar a suíte completa.",
  },
  {
    titulo: "O lote parado desde 19/08 foi publicado",
    como: "22/08, das 18:38 às 19:03, no commit f23a1f2. Pela primeira vez a suíte completa (build-test, e2e e integração) rodou no commit exato antes de o servidor ser tocado; depois 7/7 no deploy, zero vulnerabilidade na instalação do servidor, ensaio de boot com 16 portas ouvindo e smoke test respondendo ok.",
  },
  {
    titulo: "Três documentos superados moravam na raiz",
    como: "STATUS_GERAL_APLICACAO.md, AUDITORIA_INICIAL_PROJETO.md e AUDITORIA_FUNCIONAL_COMPLETA.md descreviam um estado pré-produção, e só o primeiro avisava disso. Foram para docs/historico/ com aviso de SUPERADO no topo dos três. Fechada no mesmo dia desta auditoria — era o item mais barato do plano.",
  },
];

const VITAIS: { rotulo: string; valor: string; nota: string; tom: Tom }[] = [
  { rotulo: "Produção", valor: "200 OK", nota: "/health, /, /credenciamentos, /comecar", tom: "ok" },
  { rotulo: "Typecheck", valor: "0 erros", nota: "5 pacotes, tsc --noEmit", tom: "ok" },
  { rotulo: "Lint", valor: "0 avisos", nota: "--max-warnings 0 ligado", tom: "ok" },
  { rotulo: "Audit produção", valor: "0 falhas", nota: "pnpm audit --prod, sem corte", tom: "ok" },
  { rotulo: "Proteção da main", valor: "Ativa", nota: "ruleset da org · 3 checks obrigatórios", tom: "ok" },
  { rotulo: "Cobertura de unidade", valor: "19,3%", nota: "API · web 9,2% · não andou", tom: "alerta" },
];

const NUMEROS: { n: string; l: string }[] = [
  { n: "54.440", l: "linhas de código produtivo" },
  { n: "668", l: "casos de teste (602 + 66 e2e)" },
  { n: "305", l: "endpoints em 28 routers" },
  { n: "53", l: "tabelas · 25 enums" },
  { n: "64", l: "migrações aplicadas" },
  { n: "19,3%", l: "cobertura de unidade da API" },
  { n: "122", l: "decisões registradas (ADR)" },
  { n: "111", l: "PRs mesclados" },
];

const GUARDAS: { guarda: string; qtd: number; pct: string; alcance: string }[] = [
  { guarda: "funcionarioProcedure", qtd: 165, pct: "54,1%", alcance: "Equipe interna" },
  { guarda: "adminProcedure", qtd: 66, pct: "21,6%", alcance: "ADMIN e ROOT — inclui todo o Financeiro" },
  { guarda: "rootProcedure", qtd: 29, pct: "9,5%", alcance: "Só ROOT — aba Sistema e operação" },
  { guarda: "portalProcedure", qtd: 21, pct: "6,9%", alcance: "Cliente, com clienteId da sessão" },
  { guarda: "publicProcedure", qtd: 15, pct: "4,9%", alcance: "Login, captura, proposta e assinatura" },
  { guarda: "protectedProcedure", qtd: 9, pct: "3,0%", alcance: "Qualquer sessão válida" },
];

const LACUNAS: { titulo: string; sev: "bloqueante" | "grave" | "atencao"; texto: string; meta: string }[] = [
  {
    titulo: "Dados jurídicos vazios bloqueiam qualquer contrato",
    sev: "bloqueante",
    texto:
      "Não deu para reconferir nesta rodada: `identidade.get` exige sessão de funcionário e a auditoria roda sem credencial de produção. Enquanto ninguém abrir Ajustes → Dados da empresa e disser o contrário, vale o último retrato — razão social, CNPJ, endereço e foro nulos, e o contrato imprimindo “[A PREENCHER: CNPJ]”. É a única lacuna bloqueante que sobrou, e ela se resolve com um clique de conferência.",
    meta: "Só o dono · Ajustes → Dados da empresa · 15 min · ADR-85",
  },
  {
    titulo: "Ninguém é avisado quando o e-mail para de sair",
    sev: "grave",
    texto:
      "Foram semanas a 0% de entrega e 25 falhas seguidas sem um único alerta. Quem descobriu foi o dono, criando um lead pelo site e não recebendo nada. O monitor /emails-enviados mostra tudo — depois que alguém pensa em abrir a tela. O motor de alertas vigia atraso de event loop, GC e endpoints, e não vigia isto.",
    meta: "Dev · meio dia · alertar quando a taxa de entrega cair · achado desta auditoria",
  },
  {
    titulo: "A migração irreversível da ADR-119 está no ar e a tela nunca foi conferida lá",
    sev: "grave",
    texto:
      "O CPF de quem era pessoa física foi movido para as observações da ficha e a marcação de PF sumiu do banco. Isso rodou na publicação de 21/08 (02:22, commit 8159670), não hoje — o retrato de entrada ainda a descrevia como pendente. A lição da ADR-118 é exatamente essa: typecheck verde não prova tela, e o modo de falha aparece sem um único erro de console.",
    meta: "15 min · abrir /clientes e converter um lead EM PRODUÇÃO · achado desta auditoria",
  },
  {
    titulo: "Backup nunca foi restaurado",
    sev: "grave",
    texto:
      "O dump diário roda por cron e a documentação traz o comando, mas ninguém nunca o executou. Só o ensaio prova que o arquivo abre, que o schema bate com as 64 migrações e quanto tempo o sistema fica fora.",
    meta: "Meia tarde · restaurar num banco descartável e subir a app contra ele",
  },
  {
    titulo: "Não existe homologação de pé",
    sev: "grave",
    texto:
      "O HOMOLOGACAO.md descreve o ambiente inteiro, mas os quatro passos são todos “só você tem acesso” e nenhum foi feito. Na prática, produção é o primeiro lugar onde qualquer mudança roda de verdade — foi assim que a publicação de 18/08 deixou o servidor sem node_modules.",
    meta: "Dono (painel DirectAdmin) · 1 dia · DEPLOY.md §12",
  },
  {
    titulo: "Sem vigia externo do ar",
    sev: "grave",
    texto:
      "O health-check e o motor de alertas rodam dentro do mesmo servidor que vigiam. Se a hospedagem cair, o cron cai junto e ninguém é avisado. Agora que o e-mail volta a sair, o aviso finalmente chegaria — desde que quem avisa esteja de pé.",
    meta: "20 min · qualquer monitor externo batendo em /health",
  },
  {
    titulo: "15 módulos da API sem um único teste de unidade",
    sev: "grave",
    texto:
      "Medido, não suposto: sistema (689 linhas), clientes (525), mensagens (513), dashboard (357) e portal (348) estão a 0,0%. Os maiores em risco por tamanho são servicos (2.344 linhas a 7,0%) e leads (1.629 a 2,5%). Vários são exercitados por e2e — mas e2e não diz qual ramo do código nunca rodou.",
    meta: "Contínuo · comece pelos que mexem em dinheiro · pnpm cobertura",
  },
  {
    titulo: "A saída de emergência do deploy nunca foi exercitada",
    sev: "atencao",
    texto:
      "O deploy.sh está em paridade com o workflow e tem trava de concorrência própria, mas não rodou ponta a ponta: falta instalar a chave pública no servidor. Baixou de grave para atenção porque o caminho principal se provou de novo em 22/08 e a cobrança do GitHub, que o derrubou em 19/08, foi resolvida.",
    meta: "Dono do servidor · 5 min no DirectAdmin · depois ./deploy.sh --ensaio",
  },
  {
    titulo: "Pendências de segredo, só o dono executa",
    sev: "atencao",
    texto:
      "Rotacionar a chave da OpenAI no .env do servidor e conferir se as 4 contas semeadas ainda aceitam a senha de desenvolvimento que vazou — o root@ primordial é o candidato, porque ninguém o usa para entrar. A senha do SMTP saiu da lista de suspeitos: ela estava certa o tempo todo, como a entrega de 22/08 provou; rotacioná-la virou higiene, não conserto.",
    meta: "Só o dono · 30 min · ADR-98",
  },
  {
    titulo: "CSRF sem defesa explícita",
    sev: "atencao",
    texto:
      "A mitigação hoje é SameSite=lax mais checagem de origem, razoável para um sistema interno de domínio único. Está documentado como decisão consciente, não como esquecimento — por isso é atenção e não grave.",
    meta: "Meio dia se decidirem fechar · risco baixo hoje",
  },
];

const PLANO: { acao: string; quem: string; esforco: string; destrava: string }[] = [
  { acao: "Conferir Ajustes → Dados da empresa e preencher se estiver vazio", quem: "Dono", esforco: "15 min", destrava: "Contratos assináveis" },
  { acao: "Abrir /clientes em produção e converter um lead de verdade", quem: "Dono ou Dev", esforco: "15 min", destrava: "Fecha a dúvida da migração irreversível" },
  { acao: "Apontar um monitor externo para /health", quem: "Dono", esforco: "20 min", destrava: "Aviso de queda mesmo com o servidor fora" },
  { acao: "Alertar quando a taxa de entrega de e-mail cair", quem: "Dev", esforco: "meio dia", destrava: "O e-mail não volta a ficar mudo por semanas" },
  { acao: "Rotacionar a chave da OpenAI e conferir as 4 contas semeadas", quem: "Dono", esforco: "30 min", destrava: "Fecha a dívida do vazamento (ADR-98)" },
  { acao: "Instalar a chave pública de deploy no servidor (DirectAdmin)", quem: "Dono", esforco: "5 min", destrava: "Publicar sem depender do GitHub" },
  { acao: "Ensaiar a restauração do backup num banco descartável", quem: "Dev", esforco: "meia tarde", destrava: "Backup deixa de ser hipótese" },
  { acao: "Cobrir de unidade os módulos que mexem em dinheiro", quem: "Dev", esforco: "contínuo", destrava: "Tira servicos e leads do escuro" },
  { acao: "Subir o ambiente de homologação (DEPLOY.md §12)", quem: "Dono + Dev", esforco: "1 dia", destrava: "Produção deixa de ser o primeiro ensaio" },
];

const NAO_VERIFICADO = [
  "Os dados jurídicos da empresa — identidade.get exige sessão de funcionário, e esta auditoria roda sem credencial de produção.",
  "A taxa de entrega de e-mail NA TELA. Aqui conferi que a correção está no commit publicado e que email-tls.ts tem 6 testes e 100% de cobertura; quem viu o monitor sair de 0% foi a outra janela, em 22/08.",
  "Os 80 casos de integração da API — mandam e-mail de verdade e não foram executados nesta máquina. Rodaram verdes na CI, no commit f23a1f2, antes da publicação.",
  "Os 66 casos de ponta a ponta — precisam de MySQL, seed e Playwright; o verde é o da CI no commit publicado, não execução própria.",
  "A cota de Actions consumida no mês — a API de faturamento do GitHub mudou de endereço e o token não tem escopo. A economia da ADR-121 foi conferida por duração de execução (3 min contra ~10), não por minutos faturados.",
  "Os bugs do tracker: lidos, não reproduzidos um a um.",
];

/* ----------------------------- Peças ----------------------------- */

const COR_TEXTO: Record<Tom, string> = {
  ok: "text-success",
  alerta: "text-warning",
  ruim: "text-destructive",
};
const COR_BARRA: Record<Tom, string> = {
  ok: "bg-success",
  alerta: "bg-warning",
  ruim: "bg-destructive",
};
const COR_BORDA: Record<Tom, string> = {
  ok: "border-l-success",
  alerta: "border-l-warning",
  ruim: "border-l-destructive",
};

const SEVERIDADE = {
  bloqueante: { label: "Bloqueante", variant: "danger" as const, tom: "ruim" as Tom, icon: XCircle },
  grave: { label: "Grave", variant: "warning" as const, tom: "alerta" as Tom, icon: AlertTriangle },
  atencao: { label: "Atenção", variant: "default" as const, tom: "ok" as Tom, icon: Info },
};

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">{titulo}</h2>
        {descricao && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

function LinhaDimensao({ d }: { d: (typeof DIMENSOES)[number] }) {
  return (
    <div className={"border-b border-l-2 border-border/60 p-4 last:border-b-0 " + COR_BORDA[d.tom]}>
      <div className="grid gap-3 md:grid-cols-[13rem_9rem_minmax(0,1fr)] md:items-start md:gap-5">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{d.nome}</div>
          <div className="text-xs text-muted-foreground">peso {d.peso}</div>
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={"text-lg font-semibold tabular-nums " + COR_TEXTO[d.tom]}>{d.nota}%</span>
            {d.antes != null && d.antes !== d.nota && (
              <span className="text-[11px] font-medium tabular-nums text-success">+{d.nota - d.antes}</span>
            )}
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${d.nome}: ${d.nota} por cento`}
          >
            <div className={"h-full rounded-full " + COR_BARRA[d.tom]} style={{ width: `${d.nota}%` }} />
          </div>
        </div>
        <div className="min-w-0 text-sm">
          <p>{d.tem}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="font-medium">Falta:</span> {d.falta}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Aba ----------------------------- */

export function AbaAuditoria() {
  return (
    <div className="space-y-6">
      {/* Veredito */}
      <Card>
        <CardContent className="grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-7">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-semibold tabular-nums text-primary">{NOTA_GERAL}</span>
              <span className="text-xl font-semibold text-muted-foreground">%</span>
            </div>
            <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Prontidão ponderada
            </div>
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              <TrendingUp className="h-3 w-3" />
              {NOTA_GERAL - NOTA_ANTERIOR} pontos desde 20/08
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">É um produto maduro em produção, não um protótipo.</span> 54,4 mil linhas
              de código produtivo, 305 endpoints, 53 tabelas, 668 casos de teste, 122 decisões registradas e um pipeline
              que agora roda a suíte completa no commit exato antes de tocar no servidor.
            </p>
            <p className="text-muted-foreground">
              Duas travas caíram desde 20/08 e nenhuma era de código: a main ganhou regra de repositório (push direto
              agora é <span className="font-medium">recusado</span>) e o e-mail — que
              <span className="font-medium"> nunca tinha saído de produção</span> — passou a sair. O que resta é quase
              todo <span className="font-medium">cerco operacional</span>: vigia externo, ensaio de backup,
              homologação — e duas conferências de tela que ninguém fez no que já está no ar.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Aviso de que é documento datado */}
      <Card className="border-primary/30">
        <CardContent className="flex items-start gap-3 p-4">
          <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium">
              Auditoria de {DATA} · commit{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{COMMIT}</code>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Retrato carimbado, não painel ao vivo. Os números vêm de comandos rodados fora da aplicação — typecheck,
              lint, auditoria de dependências, conferidor de artefato, API do GitHub e chamadas à produção. As demais
              abas desta página é que mostram dado em tempo real.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sinais vitais */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {VITAIS.map((v) => (
          <Card key={v.rotulo}>
            <CardContent className={"border-l-2 p-4 " + COR_BORDA[v.tom]}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{v.rotulo}</div>
              <div className={"mt-0.5 text-lg font-semibold " + COR_TEXTO[v.tom]}>{v.valor}</div>
              <div className="text-xs text-muted-foreground">{v.nota}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Secao
        titulo="As dez dimensões"
        descricao="Cada nota tem um motivo verificável ao lado. O peso é o quanto a dimensão pesa na média — funcionalidade e segurança pesam mais que documentação porque é onde o estrago é maior."
      >
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {DIMENSOES.map((d) => (
            <LinhaDimensao key={d.nome} d={d} />
          ))}
        </div>
      </Secao>

      <Secao
        titulo="O que fechou desde 20/08"
        descricao="Seis travas, e a maior delas não era código: nenhum e-mail jamais tinha saído deste servidor."
      >
        <div className="space-y-2">
          {RESOLVIDAS.map((r) => (
            <Card key={r.titulo}>
              <CardContent className="flex items-start gap-3 border-l-2 border-l-success p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{r.titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{r.como}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Secao>

      <Secao titulo="O que o projeto tem" descricao={`Contado no repositório em ${COMMIT}, não estimado.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NUMEROS.map((x) => (
            <Card key={x.l}>
              <CardContent className="p-4">
                <div className="text-xl font-semibold tabular-nums text-primary">{x.n}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{x.l}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Quem pode chamar o quê"
        descricao="290 dos 305 endpoints exigem papel. Os 15 públicos são login, captura de lead, proposta e assinatura por token."
      >
        <Table>
          <THead>
            <TR>
              <TH>Guarda</TH>
              <TH className="text-right">Endpoints</TH>
              <TH className="text-right">Fatia</TH>
              <TH>Alcance</TH>
            </TR>
          </THead>
          <tbody>
            {GUARDAS.map((g) => (
              <TR key={g.guarda}>
                <TD className="font-mono text-xs">{g.guarda}</TD>
                <TD className="text-right font-medium tabular-nums">{g.qtd}</TD>
                <TD className="text-right tabular-nums text-muted-foreground">{g.pct}</TD>
                <TD className="text-muted-foreground">{g.alcance}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Secao>

      <Secao titulo="Registro de lacunas" descricao="Ordenado por quanto dói, não por quanto custa.">
        <div className="space-y-3">
          {LACUNAS.map((l) => {
            const s = SEVERIDADE[l.sev];
            const Icone = s.icon;
            return (
              <Card key={l.titulo}>
                <CardContent className={"border-l-2 p-4 " + COR_BORDA[s.tom]}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <Icone className={"mt-0.5 h-4 w-4 shrink-0 " + COR_TEXTO[s.tom]} />
                      <h3 className="text-sm font-semibold">{l.titulo}</h3>
                    </div>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{l.texto}</p>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">{l.meta}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Secao>

      <Secao
        titulo="Por onde começar"
        descricao="Ordenado por retorno sobre esforço. Os dois primeiros são conferência de tela no que já está em produção e somam meia hora — são a diferença entre achar que está certo e saber."
      >
        <Table>
          <THead>
            <TR>
              <TH className="w-10 text-right">#</TH>
              <TH>Ação</TH>
              <TH>Quem</TH>
              <TH>Esforço</TH>
              <TH>Destrava</TH>
            </TR>
          </THead>
          <tbody>
            {PLANO.map((p, i) => (
              <TR key={p.acao}>
                <TD className="text-right tabular-nums text-muted-foreground">{i + 1}</TD>
                <TD className="font-medium">{p.acao}</TD>
                <TD className="whitespace-nowrap text-muted-foreground">{p.quem}</TD>
                <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{p.esforco}</TD>
                <TD className="text-muted-foreground">{p.destrava}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Secao>

      <Secao
        titulo="O que não foi verificado"
        descricao="Está aqui para que nenhum número acima seja lido como mais firme do que é."
      >
        <Card>
          <CardContent className="space-y-2 p-4">
            {NAO_VERIFICADO.map((t) => (
              <div key={t} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                <span>{t}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Secao>
    </div>
  );
}
