import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, XCircle } from "lucide-react";
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

const DATA = "19 de agosto de 2026";
const COMMIT = "0326d1a";
const NOTA_GERAL = 84;

/* ----------------------------- Dados da auditoria ----------------------------- */

type Tom = "ok" | "alerta" | "ruim";

const DIMENSOES: { nome: string; peso: number; nota: number; tom: Tom; tem: string; falta: string }[] = [
  {
    nome: "Funcionalidade",
    peso: 20,
    nota: 95,
    tom: "ok",
    tem: "As 10 fases do roadmap fechadas, mais a evolução pós-MVP e o credenciamento inteligente. 70 itens marcados, 3 pendentes.",
    falta: "Briefings online (o cliente responder na tela), timeline consolidada na ficha e o modo escuro — os tokens existem no CSS, o botão não.",
  },
  {
    nome: "Segurança da aplicação",
    peso: 15,
    nota: 90,
    tom: "ok",
    tem: "285 dos 300 endpoints atrás de guarda de papel. Argon2id, helmet, freio de 300 req/min, cookie assinado httpOnly, upload com allowlist e checagem de posse, senha de caixa cifrada em AES-GCM.",
    falta: "Proteção CSRF explícita (hoje só SameSite + origem) e as três pendências que só o dono executa.",
  },
  {
    nome: "Testes",
    peso: 15,
    nota: 80,
    tom: "alerta",
    tem: "687 casos declarados: 621 de unidade/integração e 66 de ponta a ponta, incluindo varredura axe de acessibilidade e RBAC provado por chamada direta à API.",
    falta: "Ninguém mede cobertura — não há v8 nem istanbul configurado. Então 80% é contagem de casos, não de linhas cobertas.",
  },
  {
    nome: "Qualidade de código",
    peso: 10,
    nota: 92,
    tom: "ok",
    tem: "Typecheck limpo nos 5 pacotes. Em 52.592 linhas: 6 ocorrências de ': any', 2 supressões do TypeScript e zero TODO ou FIXME.",
    falta: "49 avisos de lint pendurados (variáveis não usadas, fast-refresh) — cosméticos, mas viram ruído que esconde aviso novo.",
  },
  {
    nome: "CI / CD",
    peso: 10,
    nota: 85,
    tom: "alerta",
    tem: "3 jobs e quatro portões reais: audit de produção, artefato conferido, zero teste pulado e migrações aplicadas. Publicação por botão com concurrency e rollback por snapshot.",
    falta: "A main não tem proteção de ramo nenhuma — o fluxo 'nunca commitar direto' é disciplina, não regra. E não existe homologação de pé.",
  },
  {
    nome: "Operação e observabilidade",
    peso: 10,
    nota: 75,
    tom: "alerta",
    tem: "Telemetria no processo (atraso do event loop, GC, RED por endpoint), motor de alertas com histerese que abre incidente com MTTR, health-check por cron, backup diário e aviso por e-mail ao ROOT.",
    falta: "A restauração do backup nunca foi ensaiada — backup que ninguém restaurou é hipótese. E não há vigia externo: se o servidor cair inteiro, o cron cai junto.",
  },
  {
    nome: "Documentação",
    peso: 5,
    nota: 95,
    tom: "ok",
    tem: "7.572 linhas em 21 documentos, com 117 ADRs que explicam o porquê de cada escolha — inclusive dos erros.",
    falta: "Três documentos na raiz já superados continuam ali; quem chegar novo lê o retrato errado antes de achar o certo.",
  },
  {
    nome: "Desempenho",
    peso: 5,
    nota: 65,
    tom: "alerta",
    tem: "Produção responde em 0,8–1,4 s morna. As telas já vêm em pedaços separados (o maior tem 45 kB).",
    falta: "O pedaço principal tem 905 kB (268 kB comprimido) e o Vite avisa a cada build — ninguém configurou manualChunks. O primeiro acesso frio levou 9,2 s.",
  },
  {
    nome: "Ambiente de desenvolvimento",
    peso: 5,
    nota: 55,
    tom: "ruim",
    tem: "Sobe com um comando quando a máquina está provisionada, e há ferramentas próprias (doutor, acessos, verificar:bootstrap).",
    falta: "9 suítes da API não carregam sem .env completo, porque config.ts chama process.exit(1) no import. Teste de unidade não deveria exigir banco.",
  },
  {
    nome: "Prontidão comercial",
    peso: 5,
    nota: 70,
    tom: "alerta",
    tem: "O sistema faz tudo: proposta, aceite online, assinatura eletrônica, cobrança no sucesso do credenciamento.",
    falta: "Razão social, CNPJ, endereço e foro continuam nulos — o contrato imprime '[A PREENCHER: CNPJ]'. Nenhum contrato sai pronto para assinar.",
  },
];

const VITAIS: { rotulo: string; valor: string; nota: string; tom: Tom }[] = [
  { rotulo: "Produção", valor: "200 OK", nota: "/health, / e /credenciamentos", tom: "ok" },
  { rotulo: "Typecheck", valor: "0 erros", nota: "5 pacotes, tsc --noEmit", tom: "ok" },
  { rotulo: "Lint", valor: "0 erros", nota: "49 avisos, nenhum bloqueante", tom: "ok" },
  { rotulo: "Audit produção", valor: "0 falhas", nota: "pnpm audit --prod, sem corte", tom: "ok" },
  { rotulo: "Artefato", valor: "12/12", nota: "261 pacotes travados", tom: "ok" },
  { rotulo: "Proteção da main", valor: "Ausente", nota: "a API do GitHub responde 404", tom: "ruim" },
];

const NUMEROS: { n: string; l: string }[] = [
  { n: "52.592", l: "linhas de código produtivo" },
  { n: "11.120", l: "linhas de código de teste" },
  { n: "300", l: "endpoints em 28 routers" },
  { n: "53", l: "tabelas · 26 enums" },
  { n: "62", l: "migrações aplicadas" },
  { n: "687", l: "casos de teste declarados" },
  { n: "117", l: "decisões registradas (ADR)" },
  { n: "100", l: "PRs mesclados" },
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
    titulo: "Ninguém mede cobertura de teste",
    sev: "grave",
    texto:
      "687 casos e nenhum provedor de cobertura instalado. Sem isso não dá para responder qual dos 26 módulos está descoberto. O histórico já avisou: os três bugs mais graves não foram achados por teste.",
    meta: "1 hora para instalar e medir · depois decidir um piso",
  },
  {
    titulo: "Teste de unidade exige configuração de boot",
    sev: "grave",
    texto:
      "9 das 34 suítes da API não carregam sem .env completo, porque config.ts:46 chama process.exit(1) durante o import. Quem clonar o repositório vê 5 falhas vermelhas que não são defeito — e passa a desconfiar da suíte inteira.",
    meta: "2 horas · modo teste com padrões, ou lançar erro em vez de matar o processo",
  },
  {
    titulo: "Sem vigia externo do ar",
    sev: "grave",
    texto:
      "O health-check e o motor de alertas rodam dentro do mesmo servidor que vigiam. Se a hospedagem cair, o cron cai junto e ninguém é avisado.",
    meta: "20 min · qualquer monitor externo batendo em /health",
  },
  {
    titulo: "Pacote principal do navegador com 905 kB",
    sev: "grave",
    texto:
      "O Vite avisa a cada build e o aviso está sendo ignorado. As telas já vêm separadas — o peso está no núcleo comum, nunca fatiado com manualChunks. São 268 kB comprimidos antes de qualquer tela aparecer.",
    meta: "2 horas · 905,30 kB · gzip 267,89 kB",
  },
  {
    titulo: "Três pendências de segredo, só o dono executa",
    sev: "atencao",
    texto:
      "Rotacionar a chave da OpenAI e a senha do SMTP no .env do servidor, e conferir se as 4 contas semeadas ainda aceitam a senha de desenvolvimento que vazou — o root@ primordial é o candidato, porque ninguém o usa para entrar.",
    meta: "Só o dono · 30 min · ADR-98",
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
  {
    titulo: "49 avisos de lint acumulados",
    sev: "atencao",
    texto:
      "Nenhum é defeito. O problema é o volume: com 49 avisos permanentes na saída, o aviso número 50 — que pode ser real — passa despercebido.",
    meta: "1 hora · depois --max-warnings 0 na CI",
  },
];

const PLANO: { acao: string; quem: string; esforco: string; destrava: string }[] = [
  { acao: "Preencher os dados jurídicos em Ajustes → Dados da empresa", quem: "Dono", esforco: "15 min", destrava: "Contratos assináveis" },
  { acao: "Ligar proteção de ramo na main: exigir PR e CI verde", quem: "Dono", esforco: "5 min", destrava: "Torna regra o que é disciplina" },
  { acao: "Apontar um monitor externo para /health", quem: "Dono", esforco: "20 min", destrava: "Aviso de queda mesmo com o servidor fora" },
  { acao: "Rotacionar chave OpenAI e senha SMTP; conferir as 4 contas semeadas", quem: "Dono", esforco: "30 min", destrava: "Fecha a dívida do vazamento (ADR-98)" },
  { acao: "Instalar cobertura e medir uma vez, sem impor piso ainda", quem: "Dev", esforco: "1 h", destrava: "Mostra qual módulo está descoberto" },
  { acao: "Desacoplar config.ts do teste de unidade", quem: "Dev", esforco: "2 h", destrava: "Suíte roda em clone limpo" },
  { acao: "Fatiar o pacote principal com manualChunks", quem: "Dev", esforco: "2 h", destrava: "Primeira tela mais rápida todo dia" },
  { acao: "Ensaiar a restauração do backup num banco descartável", quem: "Dev", esforco: "meia tarde", destrava: "Backup deixa de ser hipótese" },
  { acao: "Subir o ambiente de homologação (DEPLOY.md §12)", quem: "Dono + Dev", esforco: "1 dia", destrava: "Produção deixa de ser o primeiro ensaio" },
  { acao: "Zerar os 49 avisos e ligar --max-warnings 0", quem: "Dev", esforco: "1 h", destrava: "Aviso novo volta a ser visível" },
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
          <div className={"text-lg font-semibold tabular-nums " + COR_TEXTO[d.tom]}>{d.nota}%</div>
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
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">É um produto maduro em produção, não um protótipo.</span> 52,6 mil linhas
              de código produtivo, 300 endpoints, 53 tabelas, 687 casos de teste, 117 decisões registradas e um pipeline
              de publicação com portões que já reprovaram falhas de verdade.
            </p>
            <p className="text-muted-foreground">
              Os 16% que faltam não são funcionalidade — são cerco operacional: nada impede um commit direto na{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">main</code>, a restauração de backup nunca
              foi ensaiada, não existe homologação de pé e o pacote do navegador passou de 900 kB. Mais os dados
              jurídicos, que só o dono preenche e que hoje bloqueiam assinar contrato.
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
