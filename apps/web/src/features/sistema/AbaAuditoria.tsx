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
 * devolvesse "84%" seria fingir precisão que a conta não tem. A data e o commit estão no
 * topo justamente para o leitor saber de quando é — auditoria que se apresenta como
 * atualizada sem ser é pior do que auditoria velha e datada.
 *
 * Para atualizar: rodar os comandos de novo e reescrever as constantes deste arquivo.
 */

const DATA = "20 de agosto de 2026";
const COMMIT = "6cd29f9";
const NOTA_GERAL = 87;
const NOTA_ANTERIOR = 84;

/* ----------------------------- Dados da auditoria ----------------------------- */

type Tom = "ok" | "alerta" | "ruim";

const DIMENSOES: { nome: string; peso: number; nota: number; antes?: number; tom: Tom; tem: string; falta: string }[] = [
  {
    nome: "Funcionalidade",
    peso: 20,
    nota: 96,
    antes: 95,
    tom: "ok",
    tem: "As 10 fases do roadmap fechadas, mais a evolução pós-MVP, o credenciamento inteligente e esta aba. O menu lateral deixou de rolar em tela baixa — defeito achado por print do dono, que a suíte não pegava porque só testava até 720px de altura.",
    falta: "Briefings online (o cliente responder na tela), timeline consolidada na ficha e o modo escuro — os tokens existem no CSS, o botão não.",
  },
  {
    nome: "Segurança da aplicação",
    peso: 15,
    nota: 90,
    antes: 90,
    tom: "ok",
    tem: "285 dos 300 endpoints atrás de guarda de papel. Argon2id, helmet, freio de 300 req/min, cookie assinado httpOnly, upload com allowlist e checagem de posse, senha de caixa cifrada em AES-GCM.",
    falta: "Proteção CSRF explícita (hoje só SameSite + origem) e as três pendências que só o dono executa. Nada mudou aqui desde 19/08.",
  },
  {
    nome: "Testes",
    peso: 15,
    nota: 85,
    antes: 80,
    tom: "alerta",
    tem: "664 casos de unidade/integração e 63 de ponta a ponta. Duas coisas mudaram: 144 testes que existiam e NUNCA rodavam voltaram a rodar (9 suítes morriam ao carregar sem .env), e agora há medição de cobertura — `pnpm cobertura`.",
    falta: "A medição revelou o tamanho do buraco: 19,18% na API, 9,24% no web, com 17 módulos a 0,0% de unidade. Sem piso na CI, de propósito, até haver o que defender.",
  },
  {
    nome: "Qualidade de código",
    peso: 10,
    nota: 95,
    antes: 92,
    tom: "ok",
    tem: "Typecheck limpo nos 5 pacotes e saída de lint ZERADA, com `--max-warnings 0` ligado: aviso novo reprova. Em 53 mil linhas: 6 ocorrências de ': any', 2 supressões do TypeScript e zero TODO.",
    falta: "A regra `react-refresh/only-export-components` foi desligada para chegar a zero — decisão ratificada, com o porquê e a condição de religar escritos no eslint.config.mjs.",
  },
  {
    nome: "CI / CD",
    peso: 10,
    nota: 88,
    antes: 85,
    tom: "alerta",
    tem: "3 jobs e cinco portões (audit de produção, artefato conferido, zero teste pulado, migrações, e agora zero aviso de lint). Publicar deixou de depender só do GitHub: o `deploy.sh` foi posto em paridade e ganhou trava de concorrência própria.",
    falta: "A main continua SEM proteção de ramo. E o `deploy.sh` ainda não rodou ponta a ponta — falta instalar a chave pública no servidor. Homologação segue inexistente.",
  },
  {
    nome: "Operação e observabilidade",
    peso: 10,
    nota: 75,
    antes: 75,
    tom: "alerta",
    tem: "Telemetria no processo (atraso do event loop, GC, RED por endpoint), motor de alertas com histerese que abre incidente com MTTR, health-check por cron, backup diário e aviso por e-mail ao ROOT.",
    falta: "Nada mudou aqui. A restauração do backup segue sem ensaio — depende do mesmo acesso SSH — e não há vigia externo: se a hospedagem cair, o cron cai junto.",
  },
  {
    nome: "Documentação",
    peso: 5,
    nota: 95,
    antes: 95,
    tom: "ok",
    tem: "120 ADRs e 21 documentos explicando o porquê de cada escolha, inclusive dos erros. É o ativo mais forte do projeto depois do código.",
    falta: "Três documentos na raiz já superados continuam ali; quem chegar novo lê o retrato errado antes de achar o certo.",
  },
  {
    nome: "Desempenho",
    peso: 5,
    nota: 80,
    antes: 65,
    tom: "alerta",
    tem: "O pacote principal caiu de 905 kB para 672 no primeiro acesso (gzip 268 → 207), e biblioteca ficou separada da app: uma publicação nova rebaixa 103 kB em vez de 268. O aviso do Vite sumiu.",
    falta: "Ainda são 672 kB, e o primeiro acesso frio na TineHost levou 9,2 s (mornas, 0,8–1,4 s). O próximo ganho é fatiar o que sobrou no pedaço da app.",
  },
  {
    nome: "Ambiente de desenvolvimento",
    peso: 5,
    nota: 75,
    antes: 55,
    tom: "alerta",
    tem: "A suíte agora roda em clone limpo, sem .env — era o defeito que fazia 5 falhas falsas aparecerem para quem acabou de clonar.",
    falta: "`prisma migrate` ainda não enxerga o .env da raiz (precisa de DATABASE_URL exportada na mão) e o `pnpm --filter @app/db exec prisma` falha no Windows mesmo com o binário presente.",
  },
  {
    nome: "Prontidão comercial",
    peso: 5,
    nota: 70,
    antes: 70,
    tom: "alerta",
    tem: "O sistema faz tudo: proposta, aceite online, assinatura eletrônica, cobrança no sucesso do credenciamento.",
    falta: "Razão social, CNPJ, endereço e foro continuam nulos — o contrato imprime '[A PREENCHER: CNPJ]'. Nenhum contrato sai pronto para assinar. Nada mudou desde 19/08.",
  },
];

const RESOLVIDAS: { titulo: string; como: string }[] = [
  {
    titulo: "Teste de unidade exigia configuração de boot",
    como: "9 suítes morriam ao carregar sem .env, e o placar mostrava 5 falhas que não eram defeito. A causa estava toda no vitest.config.ts. A suíte da API foi de 241 para 385 testes — 144 existiam e nunca rodavam.",
  },
  {
    titulo: "Ninguém media cobertura de teste",
    como: "`@vitest/coverage-v8` instalado e `pnpm cobertura` fixado. Sem piso na CI, como o plano previa. O mapa mostrou 17 módulos da API a 0,0% de unidade.",
  },
  {
    titulo: "Pacote principal do navegador com 905 kB",
    como: "Medi antes de fatiar e achei duas coisas que não deviam estar ali: o socket.io indo para produção (onde está desligado) e o Portal do cliente sendo baixado por todo funcionário. 905 → 672 kB.",
  },
  {
    titulo: "49 avisos de lint acumulados",
    como: "Quatro eram lixo real e saíram; os 46 restantes eram uma regra brigando com o idioma da base, desligada com ratificação. Saída zerada e `--max-warnings 0` ligado — o portão pegou 5 erros meus no mesmo dia.",
  },
  {
    titulo: "O menu lateral rolava e escondia o Sistema",
    como: "Não estava na lista de 19/08 — apareceu por print do dono. Em 620px o menu pedia 505px e tinha 493. O teste só ia até 720px de altura; agora cobre 660, 620 e 580.",
  },
];

const VITAIS: { rotulo: string; valor: string; nota: string; tom: Tom }[] = [
  { rotulo: "Produção", valor: "200 OK", nota: "/health, / e /credenciamentos", tom: "ok" },
  { rotulo: "Typecheck", valor: "0 erros", nota: "5 pacotes, tsc --noEmit", tom: "ok" },
  { rotulo: "Lint", valor: "0 avisos", nota: "--max-warnings 0 ligado", tom: "ok" },
  { rotulo: "Audit produção", valor: "0 falhas", nota: "pnpm audit --prod, sem corte", tom: "ok" },
  { rotulo: "Primeiro acesso", valor: "672 kB", nota: "era 905 kB · gzip 207", tom: "ok" },
  { rotulo: "Proteção da main", valor: "Ausente", nota: "a API do GitHub responde 404", tom: "ruim" },
];

const NUMEROS: { n: string; l: string }[] = [
  { n: "53.352", l: "linhas de código produtivo" },
  { n: "727", l: "casos de teste (664 + 63 e2e)" },
  { n: "300", l: "endpoints em 28 routers" },
  { n: "53", l: "tabelas · 26 enums" },
  { n: "64", l: "migrações aplicadas" },
  { n: "19%", l: "cobertura de unidade da API" },
  { n: "120", l: "decisões registradas (ADR)" },
  { n: "107", l: "PRs mesclados" },
];

const GUARDAS: { guarda: string; qtd: number; pct: string; alcance: string }[] = [
  { guarda: "funcionarioProcedure", qtd: 162, pct: "54%", alcance: "Equipe interna" },
  { guarda: "adminProcedure", qtd: 64, pct: "21%", alcance: "ADMIN e ROOT — inclui todo o Financeiro" },
  { guarda: "rootProcedure", qtd: 29, pct: "10%", alcance: "Só ROOT — aba Sistema e operação" },
  { guarda: "portalProcedure", qtd: 21, pct: "7%", alcance: "Cliente, com clienteId da sessão" },
  { guarda: "publicProcedure", qtd: 15, pct: "5%", alcance: "Login, captura, proposta e assinatura" },
  { guarda: "protectedProcedure", qtd: 9, pct: "3%", alcance: "Qualquer sessão válida" },
];

const LACUNAS: { titulo: string; sev: "bloqueante" | "grave" | "atencao"; texto: string; meta: string }[] = [
  {
    titulo: "Dados jurídicos vazios bloqueiam qualquer contrato",
    sev: "bloqueante",
    texto:
      "Razão social, CNPJ, endereço e foro continuam nulos. O contrato gerado imprime '[A PREENCHER: CNPJ]' no lugar. O sistema faz proposta, aceite e assinatura de ponta a ponta — e para no último metro.",
    meta: "Só o dono · Ajustes → Dados da empresa · 15 min · ADR-85",
  },
  {
    titulo: "A main não tem proteção de ramo",
    sev: "bloqueante",
    texto:
      "A API do GitHub responde 404 para as regras de proteção: qualquer push direto entra, sem CI, sem revisão. Três portões caros de CI podem ser contornados por engano num único git push.",
    meta: "Dono do repositório · 5 min · exigir PR + CI verde",
  },
  {
    titulo: "Backup nunca foi restaurado",
    sev: "grave",
    texto:
      "O dump diário roda por cron e a documentação traz o comando, mas ninguém nunca o executou. Só o ensaio prova que o arquivo abre, que o schema bate com as 62 migrações e quanto tempo o sistema fica fora.",
    meta: "Meia tarde · restaurar num banco descartável e subir a app contra ele",
  },
  {
    titulo: "Não existe homologação de pé",
    sev: "grave",
    texto:
      "O HOMOLOGACAO.md descreve o ambiente inteiro, mas os quatro passos são todos 'só você tem acesso' e nenhum foi feito. Na prática, produção é o primeiro lugar onde qualquer mudança roda de verdade — foi assim que a publicação de 18/08 deixou o servidor sem node_modules.",
    meta: "Dono (painel DirectAdmin) · 1 dia · DEPLOY.md §12",
  },
  {
    titulo: "Sem vigia externo do ar",
    sev: "grave",
    texto:
      "O health-check e o motor de alertas rodam dentro do mesmo servidor que vigiam. Se a hospedagem cair, o cron cai junto e ninguém é avisado.",
    meta: "20 min · qualquer monitor externo batendo em /health",
  },
  {
    titulo: "Três pendências de segredo, só o dono executa",
    sev: "atencao",
    texto:
      "Rotacionar a chave da OpenAI e a senha do SMTP no .env do servidor, e conferir se as 4 contas semeadas ainda aceitam a senha de desenvolvimento que vazou — o root@ primordial é o candidato, porque ninguém o usa para entrar.",
    meta: "Só o dono · 30 min · ADR-98",
  },
  {
    titulo: "A saída de emergência do deploy nunca foi exercitada",
    sev: "grave",
    texto:
      "O deploy.sh foi posto em paridade com o workflow e ganhou trava de concorrência própria, mas não rodou ponta a ponta: falta instalar a chave pública no servidor. Enquanto isso o GitHub segue sendo ponto único de publicação — e em 19/08 ele caiu por 8 minutos, por cobrança da conta.",
    meta: "Dono do servidor · 5 min no DirectAdmin · depois ./deploy.sh --ensaio",
  },
  {
    titulo: "17 módulos da API sem um único teste de unidade",
    sev: "grave",
    texto:
      "Agora medido, não suposto: sistema (544 linhas), mensagens (421), clientes (409), dashboard (302) e portal (259) estão a 0,0%. Os maiores em risco por tamanho são servicos (1.649 linhas a 7%) e leads (1.206 a 2,5%). Vários são exercitados por e2e — mas e2e não diz qual ramo do código nunca rodou.",
    meta: "Contínuo · comece pelos que mexem em dinheiro · pnpm cobertura",
  },
  {
    titulo: "CSRF sem defesa explícita",
    sev: "atencao",
    texto:
      "A mitigação hoje é SameSite=lax mais checagem de origem, razoável para um sistema interno de domínio único. Está documentado como decisão consciente, não como esquecimento — por isso é atenção e não grave.",
    meta: "Meio dia se decidirem fechar · risco baixo hoje",
  },
  {
    titulo: "Documentos superados ainda na raiz",
    sev: "atencao",
    texto:
      "STATUS_GERAL_APLICACAO.md, AUDITORIA_INICIAL_PROJETO.md e AUDITORIA_FUNCIONAL_COMPLETA.md descrevem um estado pré-produção. Só o primeiro avisa que está superado.",
    meta: "10 min · mover para docs/historico/",
  },
];

const PLANO: { acao: string; quem: string; esforco: string; destrava: string }[] = [
  { acao: "Preencher os dados jurídicos em Ajustes → Dados da empresa", quem: "Dono", esforco: "15 min", destrava: "Contratos assináveis" },
  { acao: "Ligar proteção de ramo na main: exigir PR e CI verde", quem: "Dono", esforco: "5 min", destrava: "Torna regra o que é disciplina" },
  { acao: "Instalar a chave pública de deploy no servidor (DirectAdmin)", quem: "Dono", esforco: "5 min", destrava: "Publicar sem depender do GitHub" },
  { acao: "Apontar um monitor externo para /health", quem: "Dono", esforco: "20 min", destrava: "Aviso de queda mesmo com o servidor fora" },
  { acao: "Rotacionar chave OpenAI e senha SMTP; conferir as 4 contas semeadas", quem: "Dono", esforco: "30 min", destrava: "Fecha a dívida do vazamento (ADR-98)" },
  { acao: "Ensaiar a restauração do backup num banco descartável", quem: "Dev", esforco: "meia tarde", destrava: "Backup deixa de ser hipótese" },
  { acao: "Cobrir de unidade os módulos que mexem em dinheiro", quem: "Dev", esforco: "contínuo", destrava: "Tira servicos e leads do escuro" },
  { acao: "Subir o ambiente de homologação (DEPLOY.md §12)", quem: "Dono + Dev", esforco: "1 dia", destrava: "Produção deixa de ser o primeiro ensaio" },
  { acao: "Mover os 3 documentos superados para docs/historico/", quem: "Dev", esforco: "10 min", destrava: "Quem chega novo lê o retrato certo" },
];

const NAO_VERIFICADO = [
  "Suíte E2E (66 casos) — precisa de MySQL, seed e Playwright; o verde é o da CI de 19/08, não execução própria.",
  "Testes de integração da API (66 casos) — mandam e-mail de verdade; não foram executados.",
  "9 suítes de unidade da API — não carregaram por falta de .env na máquina da auditoria.",
  "Os 12 bugs do tracker: lidos, não reproduzidos um a um.",
  "O isolamento do Portal: está no teste de RBAC, que não foi executado nesta auditoria.",
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
              {NOTA_GERAL - NOTA_ANTERIOR} pontos desde 19/08
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">É um produto maduro em produção, não um protótipo.</span> 53,4 mil linhas
              de código produtivo, 300 endpoints, 53 tabelas, 727 casos de teste, 120 decisões registradas e um pipeline
              de publicação com cinco portões que já reprovaram falhas de verdade.
            </p>
            <p className="text-muted-foreground">
              Cinco lacunas fecharam desde a primeira medição — e a que mais rendeu não estava na lista: 144 testes
              existiam no repositório e <span className="font-medium">nunca eram executados</span>. O que resta é quase
              todo <span className="font-medium">cerco operacional</span>, e boa parte depende de quem tem a senha:
              proteção de ramo, chave de deploy, monitor externo e os dados jurídicos que hoje impedem assinar contrato.
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
        titulo="O que fechou desde 19/08"
        descricao="Cinco lacunas resolvidas. A quinta não estava na lista — apareceu por um print do dono, e a suíte não a pegava."
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
        descricao="285 dos 300 endpoints exigem papel. Os 15 públicos são login, captura de lead, proposta e assinatura por token."
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
        descricao="Ordenado por retorno sobre esforço. Os quatro primeiros somam menos de um dia e tiram o projeto de 84% para perto de 90%."
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
