import { cn } from "@app/ui";
import { useAuth } from "../../lib/auth-context";
import { trpc } from "../../lib/trpc";
import { montarSecoes, type ChaveDeContador, type SecaoDoPortal } from "./secoes";
import { usePortalCaminho, usePortalNavegar } from "./navegar";

/**
 * A BARRA DE SEÇÕES DO PORTAL — barra inferior no celular, fileira de abas no computador.
 *
 * Um componente só desenha as duas formas porque a LISTA é a mesma (`montarSecoes`): duas
 * cópias divergiriam no dia em que uma candidata nova entrasse na vaga, e o cliente veria
 * cinco seções no celular e quatro no computador.
 *
 * ⚠️ **A largura dos itens é calculada, nunca fixa.** `gridTemplateColumns` sai do número de
 * seções: com quatro, cada item fica mais largo; com cinco, mais estreito. Um `flex` com
 * largura fixa deixaria um vão à direita quando a vaga não é preenchida — e um item invisível
 * ocupando lugar é a mesma coisa com outro nome. Nunca há buraco na barra.
 */

/** Ícone + rótulo sempre visíveis (ordem do dono). Ícone sozinho vira adivinhação. */
function ItemDaBarra({
  secao,
  ativo,
  contagem,
  onIr,
  variante,
}: {
  secao: SecaoDoPortal;
  ativo: boolean;
  contagem: number;
  onIr: () => void;
  variante: "barra" | "aba";
}) {
  const Icone = secao.icone;
  // O número exato vai sempre no rótulo acessível; a pílula encurta para caber, o leitor de
  // tela não. "9+" numa pílula é legibilidade; "9+" para quem não enxerga é informação perdida.
  const rotulo =
    contagem > 0
      ? `${secao.rotulo}, ${contagem} ${contagem === 1 ? "pendência" : "pendências"}`
      : secao.rotulo;

  return (
    <a
      href={secao.rota}
      aria-label={rotulo}
      aria-current={ativo ? "page" : undefined}
      onClick={(e) => {
        // Continua sendo um link de verdade: abrir em nova aba, meio do mouse e "copiar
        // endereço" seguem funcionando. Só o clique comum é interceptado, para navegar sem
        // recarregar a página.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onIr();
      }}
      className={cn(
        "relative flex min-w-0 select-none flex-col items-center justify-center gap-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        variante === "barra" ? "h-full px-1 pb-[env(safe-area-inset-bottom)]" : "px-3 py-2.5",
        ativo ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {/* A marca do item ativo: 3px no TOPO do item, nos dois formatos — é a borda que
          encosta no conteúdo, e por isso liga visualmente a aba à seção aberta. */}
      {ativo && <span aria-hidden className="absolute inset-x-2 top-0 h-[3px] rounded-full bg-primary" />}
      <span className="relative">
        <Icone className={variante === "barra" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
        {contagem > 0 && (
          <span
            aria-hidden
            className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold leading-none text-warning-foreground"
          >
            {contagem > 9 ? "9+" : contagem}
          </span>
        )}
      </span>
      <span className={cn("max-w-full truncate", variante === "barra" ? "text-[11px]" : "text-xs font-medium")}>
        {secao.rotulo}
      </span>
    </a>
  );
}

export function PortalTabBar() {
  const { user } = useAuth();
  const caminho = usePortalCaminho();
  const navegar = usePortalNavegar();

  /*
   * As três consultas do contador são AS MESMAS que as seções usam por dentro — mesma chave
   * de cache do TanStack Query, uma ida só ao servidor. Foi isto que permitiu tirar
   * `portal.servicosDisponiveis` (11,9 s em produção) e `portal.emails` do carregamento
   * inicial: nenhuma das duas alimenta contador, então cada uma carrega só na sua seção.
   */
  const credenciamento = trpc.portal.credenciamento.useQuery();
  const servicos = trpc.portal.meusServicos.useQuery();
  const chamados = trpc.portal.suporte.listChamados.useQuery();

  const contagens: Record<ChaveDeContador, number> = {
    convenios: credenciamento.data?.progresso.faltam ?? 0,
    servicos: (servicos.data ?? []).reduce((soma, s) => soma + s.pendentes, 0),
    suporte: (chamados.data ?? []).reduce((soma, c) => soma + c.naoLidas, 0),
  };

  // Enquanto a consulta do credenciamento não respondeu, `temCredenciamento` é falso e a barra
  // mostra quatro itens. Aparecer um quinto item depois é menos ruim que mostrar um item que
  // some — e o caso comum é justamente não ter credenciamento.
  const secoes = montarSecoes({ temCredenciamento: !!credenciamento.data });

  const ehAtiva = (rota: string) =>
    rota === "/portal" ? caminho === "/portal" || caminho === "/" : caminho.startsWith(rota);

  const grade = { gridTemplateColumns: `repeat(${secoes.length}, minmax(0, 1fr))` };
  // Em sessão de suporte a borda vira âmbar, igual à faixa do topo: quem está no painel de
  // outra pessoa tem o lembrete nas duas extremidades da tela, não só numa.
  const emSuporte = !!user.operador;

  const item = (secao: SecaoDoPortal, variante: "barra" | "aba") => (
    <ItemDaBarra
      key={secao.chave}
      secao={secao}
      ativo={ehAtiva(secao.rota)}
      contagem={secao.contador ? contagens[secao.contador] : 0}
      onIr={() => navegar(secao.rota)}
      variante={variante}
    />
  );

  return (
    <>
      {/* COMPUTADOR — abas grudadas logo abaixo do cabeçalho, dentro da mesma largura do corpo. */}
      <div
        className={cn(
          "sticky z-20 hidden border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:block",
          emSuporte && "border-b-warning/50",
        )}
        style={{ top: "calc(var(--portal-faixa-h) + 4rem)" }}
      >
        <nav aria-label="Seções do Portal" className="mx-auto grid max-w-4xl px-4" style={grade}>
          {secoes.map((s) => item(s, "aba"))}
        </nav>
      </div>

      {/* CELULAR — barra fixa no rodapé. `z-40` é a extremidade oposta do cabeçalho (`z-30`) e
          fica abaixo dos modais (`z-50`), então nunca cobre um pop-up. */}
      <nav
        aria-label="Seções do Portal"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 grid border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden print:hidden",
          emSuporte && "border-t-2 border-t-warning/60",
        )}
        style={{ ...grade, height: "calc(var(--portal-tabbar-h) + env(safe-area-inset-bottom))" }}
      >
        {secoes.map((s) => item(s, "barra"))}
      </nav>
    </>
  );
}
