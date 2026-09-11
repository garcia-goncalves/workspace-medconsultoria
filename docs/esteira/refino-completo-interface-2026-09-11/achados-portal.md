# Auditoria de layout/responsividade — Portal do cliente (2026-09-11)

Escopo: `apps/web/src/features/portal/` inteiro (5 seções + Equipe/Perfil no menu do avatar,
ADR-139/131). Só leitura — nenhum arquivo foi editado. Cobre os componentes de "casca"
(`PortalLayout.tsx`, `PortalTabBar.tsx`, `FaixaDeSuporte.tsx`, `secoes.ts`, `navegar.ts`,
`permissoes.ts`), as 6 páginas em `paginas/` e os componentes de conteúdo
(`PortalMeusDocumentos.tsx`, `PortalCredenciamento.tsx`, `PortalServicos.tsx`, `PortalSuporte.tsx`,
`SuporteChat.tsx`, `PortalMinhaEquipe.tsx`, `PessoasDoPortal.tsx`, `ExigenciasPendentes.tsx`,
`BriefingDialog.tsx`, `PortalDocumentoModal.tsx`, `GuiaPortal.tsx`).

**Achado geral:** este é o código mais defensivo do repositório em matéria de responsividade —
praticamente todo padrão que já causou bug real aqui (ADR-129/130/136/139/143) tem comentário
próprio explicando por que a régua existe e o que a quebraria. A maioria dos "suspeitos"
(`min-w-0`, `flex-wrap`, `shrink-0`, `min-h-11`, `truncate`) está correta. Achei **1 defeito real**
de layout (mesma família do que a ADR-143 já corrigiu em outro lugar), 1 achado menor da mesma
família em severidade mais baixa, e 2 observações que não são bug de código.

---

## ALTA — vai estourar a tela no celular com texto real

### 1. `PortalSuporte.tsx:137-140` — linha do chamado sem `min-w-0`: `truncate` não trunca

```tsx
<div className="min-w-0 flex-1">
  <div className="flex items-center gap-2">
    <span className="truncate text-sm font-medium">{c.assunto ?? "Chamado"}</span>
    <span className="text-xs text-muted-foreground">#{c.numero}</span>
    {c.status && <Badge variant={statusBadge[c.status]}>{CHAMADO_STATUS_LABEL[c.status]}</Badge>}
  </div>
  <div className="truncate text-xs text-muted-foreground">{c.ultimaMensagem?.conteudo ?? "Sem mensagens"} · {data(c.updatedAt)}</div>
</div>
```

O `<div className="min-w-0 flex-1">` externo está certo — ele limita a LINHA (bloco) à largura do
card. O problema é a linha interna: `<div className="flex items-center gap-2">` é um contêiner
flex **sem `flex-wrap`**, e o `<span className="truncate ...">` é um **item flex** dentro dele,
sem `min-w-0` nem `flex-1` no próprio span.

`.truncate` do Tailwind é `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. O
`white-space:nowrap` faz o *min-content width* do span ser a largura do texto inteiro (sem
quebra) — e o padrão CSS de item flex é `min-width:auto`, que usa esse min-content como piso.
Resultado: o span **não consegue encolher abaixo da largura do texto**, mesmo estando marcado
`truncate`. Com um assunto de chamado realista ("Dúvida sobre nota fiscal de outubro e
comprovante de pagamento" — o campo "Assunto" do modal "Abrir chamado", linha 192, não tem
`maxLength`) mais o `#numero` e o selo de status ao lado, a linha estoura a largura do card a
360px: ou o texto vaza para fora do cartão (overflow horizontal da página) ou empurra o selo de
status para fora da vista, dependendo do que os testes de overflow capturarem primeiro.

É exatamente o modo de falha que a ADR-143 documentou e corrigiu em outras telas ("`min-w-0`
que falta em GRID/FLEX vaza no celular") — só que aqui é um `flex` comum, não grid, e é o item
que precisa do `min-w-0`, não o contêiner (que já está certo).

**Direção da correção:** acrescentar `min-w-0` ao `<span className="truncate ...">` (e,
idealmente, `flex-1` para ele ocupar o espaço disponível e empurrar `#numero`/Badge para o fim —
hoje sem `flex-1` em ninguém da linha, o span some crescer só pelo texto e os dois `shrink-0`
implícitos ficam colados nele). Ex.: `className="min-w-0 flex-1 truncate text-sm font-medium"`.

---

## BAIXA — mesma família, mas edge case improvável e mitigada por `flex-wrap`

### 2. `PessoasDoPortal.tsx:94-96` — nome da pessoa em `flex-wrap` sem `min-w-0` no span

```tsx
<div className="flex flex-wrap items-center gap-2">
  <span className="truncate text-sm font-medium">{pessoa.nome}</span>
  {souEu && <span className="text-xs text-muted-foreground">(você)</span>}
  <Badge variant={pessoa.papel === "EQUIPE" ? "default" : "primary"}>...</Badge>
  <Badge variant={selo.variant}>{selo.texto}</Badge>
</div>
```

Mesmo padrão do achado 1 (span `truncate` sem `min-w-0`, então não trunca de verdade), mas aqui o
contêiner tem `flex-wrap` — se o nome for muito comprido, o item some quebrar para a própria linha
em vez de forçar overflow horizontal na maioria dos casos, o que reduz bastante a chance de vazar
a tela. Ainda assim, um nome muito longo digitado no campo "Nome" do convite (`ConvidarModal`,
sem `maxLength`, placeholder "Ex.: Dra. Helena Martins Prado") pode, sozinho numa linha da largura
do card, ultrapassar 360px e estourar a página (a checagem de overflow horizontal do e2e pegaria
isso). Baixa prioridade porque exige um nome de pessoa incomumente longo, mas a correção é a
mesma e é barata: `min-w-0` no `<span className="truncate ...">` da linha 95.

---

## Observações (não são bug de código)

### 3. Cobertura do e2e é real, mas com um único cliente fixo — a 5ª seção pode nunca ser exercida a 360px

`e2e/responsividade-total.spec.ts:86-91` cobre as 6 rotas do Portal
(`/portal`, `/portal/documentos`, `/portal/credenciamento`, `/portal/servicos`, `/portal/suporte`,
`/portal/equipe`) nos 5 tamanhos de viewport, com checagem de alvo de toque e texto cortado
específicas para o Portal (`verificarAlvosDeToque`/`verificarTextoNaoCortado`, linhas 272-278).
Isso é bom e cobre exatamente a vaga da barra (`secoes.ts`) e o achado 1 acima — desde que o
cliente semeado (`cliente@medconsultoria.com.br`, `e2e/auth.setup.ts:14`) tenha um processo de
credenciamento em curso quando o teste roda, e desde que o e2e-fixtures ou o seed geral popule um
chamado de suporte com assunto comprido o bastante para acionar o achado 1. Não confirmei nos
scripts de seed se isso é garantido — vale conferir antes de assumir que "a suíte teria pego" o
achado 1 sozinha.

### 4. `PortalDocumentosPage.tsx:85` — título do documento sem `truncate`, mas isso é intencional e correto

`<div className="font-medium">{d.titulo}</div>` dentro de `min-w-0 flex-1` não trunca — mas por
ser um `<div>` normal (não item flex), ele só QUEBRA a linha em vez de estourar horizontalmente.
Não é bug; registrado aqui só para descartar explicitamente, já que "texto sem truncate" estava
na lista de padrões a procurar.

---

## Resumo

- **2 achados de layout**, os dois da mesma família (`truncate` que não trunca porque falta
  `min-w-0` no próprio item flex, dentro — não fora — do contêiner flex):
  1. **ALTA** — `PortalSuporte.tsx:138` (linha do chamado): sem `flex-wrap` no contêiner, o mais
     provável de estourar a tela de verdade a 360px com um assunto de chamado real.
  2. **BAIXA** — `PessoasDoPortal.tsx:95` (nome na lista "Quem da clínica entra aqui"): mesmo
     defeito, mitigado por `flex-wrap` no contêiner, exige nome incomumente longo para vazar.
- **0 achados de regra de negócio** — nada do que li parecia trava de permissão, preço ou fluxo
  incorreto; os componentes já citam explicitamente as ADRs que fixaram essas regras.
- **Cobertura de teste:** as 6 rotas do Portal estão cobertas pelo `responsividade-total.spec.ts`
  nos 5 tamanhos, com checagem própria de alvo de toque e texto cortado — mas depende de dado de
  seed (chamado com assunto comprido, cliente com credenciamento ativo) que não confirmei estar
  garantido, então a suíte pode estar passando sem ter exercido o achado 1 de verdade.
