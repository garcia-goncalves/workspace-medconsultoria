# Auditoria de responsividade — páginas públicas (2026-09-11)

Escopo: `apps/web/src/features/publico/` (`/privacidade`), `apps/web/src/features/captura/`
(`/comecar`), `apps/web/src/features/assinaturas/` (assinar documento), `apps/web/src/features/propostas/`
(proposta pública), `apps/web/src/features/auth/` (login, esqueci senha, redefinir, definir senha,
primeiro acesso, "já conectado"). Só leitura — nenhum arquivo foi editado.

Achados de **layout/responsividade** primeiro (por gravidade), depois um achado de **cobertura de
teste** e um de **regra de negócio** separado no fim.

---

## MÉDIA

### 1. Lista de signatários sem `truncate`/`min-w-0`/`flex-wrap` pode estourar a 360px
**Arquivo:** `apps/web/src/features/assinaturas/AssinarPage.tsx:118-138`

```tsx
<div className="flex items-center gap-2 text-sm">
  {s.status === "ASSINADO" ? <CheckCircle2 .../> : <Circle .../>}
  <span className="font-medium">{s.nome}</span>
  <span className="text-xs text-muted-foreground">({s.papel === "CLIENTE" ? "Cliente" : "MedConsultoria"})</span>
  <span className="ml-auto text-xs text-muted-foreground">
    {s.status === "ASSINADO" && s.assinadoEm ? dataHora(s.assinadoEm) : "pendente"}
  </span>
</div>
```

É exatamente o padrão que já causou bug real neste projeto (ADR-129/143): `flex` sem
`flex-wrap`, sem `min-w-0` no container e sem `truncate` no nome — e `s.nome` é texto vindo do
banco (nome de médico/secretária), sem teto de tamanho conhecido pela tela. Com um nome longo +
"(MedConsultoria)" + a data à direita (`ml-auto`), a linha não tem margem em 360/390px: o item
mais à direita (a data) é o que sai empurrado para fora, sem barra de rolagem (o pai
`rounded-xl border` não tem `overflow-hidden`). Esta é a página que o médico assina **deslogado,
no celular** — é exatamente o público que a régua de responsividade deste projeto prioriza.

**Direção da correção:** envolver o nome em `min-w-0 flex-1` com `truncate` (o `title` já dá o
nome completo ao passar o mouse; no celular, o essencial — se já assinou — continua visível pelo
ícone), ou deixar a linha quebrar com `flex-wrap` e mover a data para uma segunda linha em telas
estreitas.

---

## BAIXA

### 2. Alvo de toque abaixo de 44px nos botões "Desenhar"/"Digitar" da assinatura
**Arquivo:** `apps/web/src/features/assinaturas/SignaturePad.tsx:66-90`

```tsx
<button ... className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium ...">
  <Pencil className="h-3.5 w-3.5" /> Desenhar
</button>
```

`py-1.5` (6px) + linha de texto ~20px dá em torno de 32-34px de altura — abaixo do
`ALVO_TOQUE_MIN_PX = 44` que o próprio projeto usa como régua em
`e2e/responsividade-total.spec.ts:37`. É alvo de toque numa tela assinada no celular, com o dedo,
não com mouse — o cenário que a régua de 44px foi criada para cobrir (ADR-143).

**Direção da correção:** subir para `py-2.5`/`py-3` (ou `min-h-11`) nos dois botões do seletor de
modo.

### 3. Sem achado relevante nas demais telas
`CapturaLeadPage`, `PrivacidadePage`, `PropostaPublicaPage`, `AuthShell` e as seis páginas de
`features/auth/` (`LoginPage`, `EsqueciSenhaPage`, `RedefinirSenhaPage`, `DefinirSenhaPage`,
`TrocarSenhaPrimeiroAcessoPage`, `JaConectadoPage`) já seguem o padrão correto: `flex-wrap`/`grid
sm:grid-cols-2` que empilha a 360px, `min-w-0` nos containers que precisam, sem largura fixa em
px, ícones posicionados com `absolute`/`pl-10` (padrão reaproveitado em toda a app), botões `lg`
= 44px de altura (`buttonVariants`, `h-11`), e textos longos sem overflow. O `DocumentoBranded`
(renderizado dentro de `AssinarPage` e `PropostaPublicaPage`) já resolve a largura fixa de A4 com
`zoom: Math.min(1, wrap.clientWidth / DOC_W)` — a mesma técnica da ADR-129 — então não vaza a
360px mesmo sendo uma folha de 793px de largura nativa.

`JaConectadoPage.tsx:23` (`<div className="mx-auto max-w-md py-10">`, sem `px-*` próprio) não é
um achado: essa rota (`/login` com sessão já aberta) roda **dentro do `AppLayout`**
(`apps/web/src/app/router.tsx:236-240`), cujo `<main>` já aplica `p-4 md:p-6` — confirmado em
`apps/web/src/components/layout/AppLayout.tsx:506,515`.

---

## COBERTURA DE TESTE (achado à parte, não é layout em si)

### 4. `e2e/responsividade-total.spec.ts` não cobre NENHUMA rota pública
**Arquivo:** `e2e/responsividade-total.spec.ts:59-92`

A "rede de proteção" de responsividade (30 rotas × 5 tamanhos, ADR-143) cobre só
`ROTAS_INTERNAS` (22 rotas da área logada) e `ROTAS_PORTAL` (6 rotas do Portal do cliente).
**Zero** rota de `/comecar`, `/login`, `/esqueci-senha`, `/definir-senha`, `/primeiro-acesso`
(trocar senha), `/redefinir-senha`, `/privacidade`, `/assinar/:token` ou `/proposta/:token` está
na lista — nem aqui, nem no `e2e/responsive.spec.ts` mais antigo (conferido, zero ocorrência).
Essas são justamente as telas vistas por gente de fora da empresa, sem sessão, muitas vezes pelo
celular — o público que a doutrina do projeto (CLAUDE.md, seção "páginas públicas") diz que
importa tanto quanto o Portal, mas a régua automática não as protege de regressão nenhuma hoje.

**Direção da correção:** acrescentar uma lista `ROTAS_PUBLICAS` (rotas estáticas: `/comecar`,
`/login`, `/esqueci-senha`, `/privacidade`; as de token — `/assinar/:token`, `/proposta/:token`,
`/definir-senha?token=`, `/redefinir-senha?token=` — pedem um token de teste válido, então talvez
peçam uma via própria de resolução, como as rotas dinâmicas internas já fazem via `idDe`) e rodar
as mesmas 5 verificações nelas. Fora do escopo desta auditoria (só leitura) implementar a
mudança.

---

## Achado de REGRA DE NEGÓCIO (não é layout — registrado à parte, conforme pedido)

Nenhum achado de regra de negócio nas páginas públicas nesta rodada. As telas conferidas (aceite
de proposta em duas etapas para evitar clique errado, expiração de link com as 3 frases distintas
de rede/expirado/inválido, honeypot anti-spam, frase incondicional pós-captura para não vazar se
um e-mail já é conhecido) já refletem decisões registradas nas ADR-132/133/137/141, e o código
lido corresponde ao que o `CLAUDE.md` descreve. Nada de novo a reportar aqui.

---

## Resumo

- **4 achados**: 1 MÉDIA (layout), 2 BAIXA (1 de layout + 1 de cobertura de teste), e um item de
  "nada a reportar" documentado por transparência.
- Os dois mais relevantes: **(1)** a lista de signatários do `AssinarPage` pode estourar a
  360/390px com nome de médico longo — mesmo padrão de bug (flex sem wrap/truncate/min-w-0) que
  já mordeu este projeto nas ADR-129/143; **(4)** a rede de proteção automática de responsividade
  não cobre nenhuma rota pública, então uma regressão futura nessas telas — as mais vistas por
  gente de fora da empresa — não seria pega pela CI.
- O restante das páginas públicas (captura de lead, privacidade, proposta pública, e as 6 telas
  de autenticação) já está no padrão correto e não precisa de correção.
