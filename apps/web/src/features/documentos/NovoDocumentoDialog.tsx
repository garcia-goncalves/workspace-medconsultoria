import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Loader2, FileSignature, CalendarClock, ClipboardList, Eye, FileSignature as FileSign, HeartHandshake, FileText, Receipt } from "lucide-react";
import { cn } from "@app/ui";
import { extrairVariaveis, DOC_INTERACAO, TIPO_MODELO_LABEL, type CelulaGrade, type TipoModelo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";
import { MoneyInput } from "../../components/ui/money-input";
import { PropostaServicosPicker, type PropostaSel } from "./PropostaServicosPicker";
import { CredenciamentoPicker, type OperadoraEscolhida } from "./CredenciamentoPicker";
import { ConveniosPicker } from "./ConveniosPicker";
import { PlanoAcaoFields, type AcaoLinha } from "./PlanoAcaoFields";
import { PautaPostagemFields, type PostLinha, REDES as POST_REDES, FORMATOS as POST_FORMATOS } from "./PautaPostagemFields";
import { SmartCampos } from "./SmartCampos";
import { AudioTranscricao } from "./AudioTranscricao";
import { DocumentoBranded, previewModelo } from "./DocumentoBranded";
import { formatBRL, valorPorExtenso } from "../../lib/masks";
import { useAuth } from "../../lib/auth-context";

const FORMAS_PAGAMENTO = ["PIX", "Dinheiro", "Cartão de crédito", "Cartão de débito", "Transferência", "Boleto"] as const;

/** O que o documento faz na prática (matriz de interação) — chip na prévia. */
function papelModelo(tipo: TipoModelo): { texto: string; Icon: typeof FileText } {
  const i = DOC_INTERACAO[tipo];
  if (i === "assinatura") return { texto: "O cliente assina", Icon: FileSign };
  if (i === "aceite") return { texto: "O cliente aceita ou recusa", Icon: HeartHandshake };
  if (tipo === "BRIEFING") return { texto: "O cliente preenche", Icon: ClipboardList };
  return { texto: "Leitura / entrega", Icon: FileText };
}

/** Concatena o texto transcrito ao valor atual do campo (uma linha em branco entre trechos). */
const anexar = (atual: string, novo: string) => (atual.trim() ? atual.trimEnd() + "\n\n" : "") + novo;

type Modo = "PROPOSTA" | "CONTRATO" | "ATA" | "PAUTA" | "RECIBO" | "PLANO" | "PAUTA_POST" | "GENERICO";

/** Texto de vigência para a prévia do contrato (o backend gera o definitivo). */
function textoVigencia(meses: number): string {
  const extenso: Record<number, string> = { 6: "seis", 12: "doze", 24: "vinte e quatro", 36: "trinta e seis" };
  const ext = extenso[meses] ? ` (${extenso[meses]})` : "";
  return `Vigência de ${meses}${ext} ${meses === 1 ? "mês" : "meses"} a contar da assinatura, renovável automaticamente por iguais períodos, salvo manifestação em contrário com 30 (trinta) dias de antecedência.`;
}
const VIGENCIAS = [6, 12, 24, 36] as const;

/** Sugestão de valor para um campo genérico, inferida pelo NOME + contexto do cliente. */
function sugerirCampo(nome: string, ctx: { servicos: string; referente: string; valor: number }): string | null {
  const n = nome.toLowerCase();
  if (/objeto|escopo|servi|entregav|atividade/.test(n)) return ctx.servicos || null;
  if (/valor|mensal|investiment|honorari|mensalidade/.test(n)) return ctx.valor > 0 ? formatBRL(ctx.valor) : null;
  if (/referente|descri/.test(n)) return ctx.referente || null;
  return null;
}

/**
 * Novo documento INTELIGENTE — um só ponto de criação. Ao escolher o modelo, o formulário
 * se adapta ao tipo: Proposta abre o construtor de serviços; Ata resume anotações com IA;
 * Pauta gera a pauta com IA (contexto do cliente); os demais preenchem campos ou geram com IA.
 */
export function NovoDocumentoDialog({
  open,
  onClose,
  clienteFixo,
}: {
  open: boolean;
  onClose: () => void;
  /** Quando gerado a partir da ficha do cliente: já vem escolhido e o campo Cliente some. */
  clienteFixo?: string;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // Quem está emitindo assina a proposta de credenciamento como consultora responsável.
  const { user: usuario } = useAuth();
  const modelos = trpc.documentos.modelos.list.useQuery(undefined, { enabled: open });
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: open && !clienteFixo });
  const ia = trpc.ia.disponivel.useQuery(undefined, { enabled: open });
  const servicosAtivos = trpc.servicos.ativos.useQuery(undefined, { enabled: open });

  const [modeloId, setModeloId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [titulo, setTitulo] = useState("");
  // Genérico (preencher campos × IA)
  const [modoGen, setModoGen] = useState<"MANUAL" | "IA">("MANUAL");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [instrucoes, setInstrucoes] = useState("");
  // Proposta comercial / Contrato (catálogo de serviços)
  const [sel, setSel] = useState<Record<string, PropostaSel>>({});
  const [vigenciaMeses, setVigenciaMeses] = useState(12);
  const [prazo, setPrazo] = useState("");
  const [condicoes, setCondicoes] = useState("");
  // A condição de pagamento é PRÉ-PREENCHIDA pelos serviços escolhidos (ADR-125), mas proposta
  // se negocia: assim que alguém digita ali, o preenchimento automático para de mexer.
  const condicoesTocadas = useRef(false);
  const [observacoes, setObservacoes] = useState("");
  const [usarIA, setUsarIA] = useState(false);
  // Proposta de credenciamento: a grade médico × operadora (ADR-104) e, para o cliente sem
  // médico cadastrado, o formato antigo por operadora.
  const [celulasGrade, setCelulasGrade] = useState<CelulaGrade[]>([]);
  const [modoGrade, setModoGrade] = useState(false);
  // UMA operadora por proposta de credenciamento (ADR-126).
  const [operadoraProposta, setOperadoraProposta] = useState<OperadoraEscolhida>(null);
  const [valorOperadora, setValorOperadora] = useState(0);
  // Proposta de FATURAMENTO (ADR-126): os convênios atendidos e o faturamento médio mensal.
  // O faturamento é a MESMA base que a Qualificação do funil pergunta — corrigi-lo aqui
  // corrige o lead, um número só andando para frente.
  const [conveniosSel, setConveniosSel] = useState<string[]>([]);
  const [faturamentoMensal, setFaturamentoMensal] = useState(0);
  const faturamentoTocado = useRef(false);
  // Ata / Pauta
  const [anotacoes, setAnotacoes] = useState("");
  const [topicos, setTopicos] = useState("");
  // Recibo
  const [reciboValor, setReciboValor] = useState(0);
  const [reciboReferente, setReciboReferente] = useState("");
  const [reciboForma, setReciboForma] = useState<string>(FORMAS_PAGAMENTO[0]);
  // Plano de ação
  const [planoObjetivo, setPlanoObjetivo] = useState("");
  const [planoAcoes, setPlanoAcoes] = useState<AcaoLinha[]>([{ acao: "", resp: "", prazo: "" }]);
  const [planoIndicadores, setPlanoIndicadores] = useState("");
  // Pauta de postagem
  const novoPost = (): PostLinha => ({ data: "", rede: POST_REDES[0]!, formato: POST_FORMATOS[0]!, tema: "" });
  const [postPeriodo, setPostPeriodo] = useState("");
  const [postagens, setPostagens] = useState<PostLinha[]>([novoPost()]);
  const [postObs, setPostObs] = useState("");

  useEffect(() => {
    if (!open) return;
    setModeloId("");
    setClienteId(clienteFixo ?? "");
    setTitulo("");
    setModoGen("MANUAL");
    setVars({});
    setInstrucoes("");
    setSel({});
    setVigenciaMeses(12);
    appliedKey.current = "";
    setPrazo("");
    setCondicoes("");
    condicoesTocadas.current = false;
    setObservacoes("");
    setUsarIA(false);
    setOperadoraProposta(null);
    setValorOperadora(0);
    setConveniosSel([]);
    setFaturamentoMensal(0);
    faturamentoTocado.current = false;
    setCelulasGrade([]);
    setModoGrade(false);
    setAnotacoes("");
    setTopicos("");
    setReciboValor(0);
    setReciboReferente("");
    setReciboForma(FORMAS_PAGAMENTO[0]);
    setPlanoObjetivo("");
    setPlanoAcoes([{ acao: "", resp: "", prazo: "" }]);
    setPlanoIndicadores("");
    setPostPeriodo("");
    setPostagens([novoPost()]);
    setPostObs("");
  }, [open, clienteFixo]);

  // Trocar de cliente zera a grade: as células guardam ids de médicos DAQUELE cliente, e levá-las
  // para outro montaria uma proposta com o médico errado (o servidor recusa, mas a tela mentiria
  // até o envio).
  useEffect(() => {
    setCelulasGrade([]);
    setOperadoraProposta(null);
  }, [clienteId]);

  const modelo = modelos.data?.find((m) => m.id === modeloId);
  const modo: Modo | null = !modelo
    ? null
    : modelo.tipo === "PROPOSTA"
      ? "PROPOSTA"
      : modelo.tipo === "CONTRATO"
        ? "CONTRATO"
        : modelo.tipo === "ATA"
        ? "ATA"
        : modelo.tipo === "PAUTA_REUNIAO"
          ? "PAUTA"
          : modelo.tipo === "RECIBO"
            ? "RECIBO"
            : modelo.tipo === "PLANO_ACAO"
              ? "PLANO"
              : modelo.tipo === "PAUTA_POSTAGEM"
                ? "PAUTA_POST"
                : "GENERICO";

  const variaveis = useMemo(
    () => (modelo ? extrairVariaveis(modelo.corpo).filter((v) => !v.startsWith("cliente.") && v !== "data") : []),
    [modelo],
  );

  /**
   * A condição de pagamento vem do CADASTRO do serviço, não da memória de quem digita.
   *
   * O caso que originou (ADR-125): o Faturamento de contas médicas tem sempre a mesma condição
   * — o repasse é após o crédito na conta da clínica — e ela dependia de alguém lembrar de
   * escrevê-la, igual, em toda proposta. Proposta muda sobre quando se paga vira discussão
   * depois, e some do documento se ninguém digitar.
   *
   * Dois cuidados: só preenche enquanto ninguém tocou no campo (proposta se negocia), e junta
   * as condições de TODOS os serviços escolhidos, sem repetir — no caso misturado o cliente
   * precisa ler as duas.
   */
  const idsSelecionados = Object.keys(sel).sort().join(",");
  useEffect(() => {
    if (condicoesTocadas.current) return;
    const escolhidos = new Set(idsSelecionados ? idsSelecionados.split(",") : []);
    const frases: string[] = [];
    for (const sv of servicosAtivos.data ?? []) {
      if (!escolhidos.has(sv.id)) continue;
      const frase = sv.condicaoPagamento?.trim();
      if (frase && !frases.includes(frase)) frases.push(frase);
    }
    setCondicoes(frases.join(" "));
  }, [idsSelecionados, servicosAtivos.data]);

  // Contexto do cliente (serviços contratados, investimento, proposta aceita) → auto-preenchimento.
  const contexto = trpc.documentos.contextoCliente.useQuery(
    { clienteId, tipo: modelo?.tipo ?? "CONTRATO" },
    { enabled: open && !!clienteId && !!modelo },
  );
  // Aplica o auto-preenchimento UMA vez por (cliente × modelo) — sem sobrescrever edições do usuário.
  const appliedKey = useRef("");
  useEffect(() => {
    const ctx = contexto.data;
    if (!ctx || !modelo) return;
    const key = `${clienteId}:${modeloId}`;
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    if (modo === "CONTRATO") {
      const next: Record<string, PropostaSel> = {};
      for (const it of ctx.itens) {
        next[it.servicoId] = {
          valor: it.valor ?? 0,
          qtd: it.quantidade ?? 1,
          recorrencia: it.recorrencia,
          percentual: it.percentual ?? null,
          categoria: it.categoria ?? null,
        };
      }
      setSel(next);
    } else if (modo === "PROPOSTA") {
      // A proposta de faturamento NASCE com o que o funil já sabe (ADR-126): o faturamento
      // mensal informado na Qualificação e os convênios já registrados. Quem já respondeu não
      // responde de novo — e corrigir aqui devolve o número corrigido ao lead.
      const doFunil = ctx.faturamentoMensal ?? 0;
      if (!faturamentoTocado.current && doFunil > 0) setFaturamentoMensal(doFunil);
      if (ctx.conveniosAtuais.length) setConveniosSel((v) => (v.length ? v : ctx.conveniosAtuais));
    } else if (modo === "RECIBO") {
      // Recibo: sugere o valor (mensal/à vista) e o "referente a" (serviços) — sem sobrescrever.
      if (ctx.sugestoes.valor > 0) setReciboValor((v) => (v > 0 ? v : ctx.sugestoes.valor));
      if (ctx.sugestoes.referente) setReciboReferente((v) => (v.trim() ? v : ctx.sugestoes.referente));
    } else if (modo === "GENERICO") {
      // Demais documentos: pré-preenche os campos óbvios (objeto/escopo/valor/referente) por inferência.
      setVars((prev) => {
        const next = { ...prev };
        for (const campo of variaveis) {
          if (next[campo]?.trim()) continue;
          const s = sugerirCampo(campo, ctx.sugestoes);
          if (s) next[campo] = s;
        }
        return next;
      });
    }
  }, [contexto.data, modo, modeloId, clienteId, modelo, variaveis]);

  // Tabela Markdown das ações do plano (a partir das linhas preenchidas) → injeta em {{acoes}}.
  const acoesTabela = () => {
    const linhas = planoAcoes.filter((a) => a.acao.trim() || a.resp.trim() || a.prazo.trim());
    const usar = linhas.length ? linhas : [{ acao: "", resp: "", prazo: "" }];
    const rows = usar.map((a) => `| ${a.acao.trim() || "—"} | ${a.resp.trim() || "—"} | ${a.prazo.trim() || "—"} | A fazer |`);
    return `| Ação | Responsável | Prazo | Status |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
  };

  // Tabela Markdown do calendário de postagens → injeta em {{postagens}}.
  const postagensTabela = () => {
    const linhas = postagens.filter((p) => p.data.trim() || p.tema.trim());
    const usar = linhas.length ? linhas : [{ data: "", rede: "", formato: "", tema: "" }];
    const rows = usar.map((p) => `| ${p.data.trim() || "—"} | ${p.rede || "—"} | ${p.formato || "—"} | ${p.tema.trim() || "—"} | A produzir |`);
    return `| Data | Rede | Formato | Tema / Legenda | Status |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}`;
  };

  // Proposta de credenciamento = modelo cujo corpo declara {{operadoras}} → usa o formulário
  // de OPERADORAS (não o catálogo de serviços da proposta comercial).
  const ehCredenciamento = modo === "PROPOSTA" && !!modelo?.corpo.includes("{{operadoras}}");

  // Proposta de FATURAMENTO = modelo cujo corpo declara {{convenios}} (ADR-126). Mesma lógica
  // de detecção do credenciamento: quem manda é o MODELO, não o nome do serviço nem a categoria.
  const ehFaturamento = modo === "PROPOSTA" && !!modelo?.corpo.includes("{{convenios}}");
  // O percentual somado dos serviços escolhidos — é o que a proposta cobra por mês.
  const percentualDaProposta = Object.values(sel).reduce((t, i) => t + (i.percentual ?? 0), 0);
  const valorEstimadoDoFaturamento =
    faturamentoMensal > 0 && percentualDaProposta > 0
      ? Math.round(((faturamentoMensal * percentualDaProposta) / 100 + Number.EPSILON) * 100) / 100
      : 0;

  // Os médicos e as operadoras do cliente — a mesma consulta que o CredenciamentoPicker faz
  // (o cache do TanStack Query resolve uma vez só). A prévia precisa dos NOMES para desenhar
  // a grade igual ao que o servidor vai gerar.
  const gradeCtx = trpc.credenciamento.grade.useQuery(
    { clienteId },
    { enabled: open && ehCredenciamento && !!clienteId },
  );

  // Os NOMES dos convênios para a prévia (o mesmo cache que o ConveniosPicker usa).
  const catalogoConvenios = trpc.documentos.operadoras.list.useQuery(
    { uso: "FATURAMENTO" },
    { enabled: open && ehFaturamento },
  );

  // Preview ao vivo: injeta os valores já preenchidos no corpo antes de exibir.
  const conteudoPreview = () => {
    if (!modelo) return "";
    let corpo = modelo.corpo;
    // PROPOSTA DE CREDENCIAMENTO: preenche {{operadoras}}, {{profissionais}} e {{servicos}},
    // espelhando o servidor — a prévia tem de mostrar a proposta que vai sair, não um esboço.
    if (ehCredenciamento) {
      const extras = [
        prazo.trim() ? `**Prazo estimado:** ${prazo.trim()}` : "",
        condicoes.trim() ? `**Condições de pagamento:** ${condicoes.trim()}` : "",
      ].filter(Boolean);

      let nomesOperadoras: string[];
      let profissionaisTxt = "";
      let nomesTxt = "";
      let total = 0;
      const bloco: string[] = [];

      if (modoGrade && celulasGrade.length > 0) {
        const profDe = (id: string) => gradeCtx.data?.profissionais.find((p) => p.id === id);
        const opDe = (id: string) => gradeCtx.data?.operadoras.find((o) => o.id === id);
        total = celulasGrade.reduce((s, c) => s + (c.valor || 0), 0);
        const linhas = celulasGrade.map((c) => {
          const p = profDe(c.profissionalId);
          const quem = p?.especialidade ? `**${p.nome}** — ${p.especialidade}` : `**${p?.nome ?? "Profissional"}**`;
          return `| ${quem} | ${opDe(c.operadoraId)?.nome ?? "—"} | ${c.valor > 0 ? formatBRL(c.valor) : "a combinar"} |`;
        });
        const tabela = [
          "| Profissional | Operadora | Investimento |",
          "| --- | --- | --- |",
          ...linhas,
          `| | **Total** | **${total > 0 ? formatBRL(total) : "a combinar"}** |`,
        ].join("\n");
        bloco.push(`## Investimento\n\n${tabela}`);
        if (total > 0) bloco.push(`Investimento total: **${formatBRL(total)}** (${valorPorExtenso(total)}).`);
        nomesOperadoras = [
          ...new Set(celulasGrade.map((c) => opDe(c.operadoraId)?.nome).filter((n): n is string => !!n)),
        ];
        const usados = [...new Set(celulasGrade.map((c) => c.profissionalId))]
          .map(profDe)
          .filter((p): p is NonNullable<typeof p> => !!p);
        const juntar = (partes: string[]) =>
          partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join("; ")} e ${partes[partes.length - 1]}`;
        profissionaisTxt = juntar(usados.map((p) => (p.especialidade ? `${p.nome}, ${p.especialidade}` : p.nome)));
        nomesTxt = juntar(usados.map((p) => p.nome));
      } else {
        // Uma proposta, uma operadora (ADR-126).
        const fee = valorOperadora || 0;
        total = fee;
        bloco.push(
          `## Investimento\n\n${
            fee > 0
              ? `**${formatBRL(fee)}** para o credenciamento junto à operadora **${operadoraProposta?.nome ?? ""}**.`
              : "Investimento a combinar."
          }`,
        );
        nomesOperadoras = operadoraProposta ? [operadoraProposta.nome] : [];
      }

      if (extras.length) bloco.push(extras.join("  \n"));
      if (observacoes.trim()) bloco.push(observacoes.trim());

      corpo = corpo
        .replace(
          /\{\{\s*operadoras\s*\}\}/g,
          nomesOperadoras.length ? nomesOperadoras.map((o) => `- **${o}**`).join("\n") : "_(selecione as operadoras ao lado)_",
        )
        .replace(/\{\{\s*profissionais\s*\}\}/g, profissionaisTxt || "_(a definir com você)_")
        .replace(/\{\{\s*profissionais_nomes\s*\}\}/g, nomesTxt || "_(a definir com você)_")
        // O número é reservado no momento em que o documento é criado — mostrar um aqui seria
        // prometer um que outra emissão simultânea pode levar.
        .replace(/\{\{\s*numero\s*\}\}/g, "_(gerado ao criar)_")
        .replace(/\{\{\s*consultora\s*\}\}/g, usuario.nome || "MedConsultoria")
        .replace(/\{\{\s*valor\s*\}\}/g, total > 0 ? formatBRL(total) : "_(a combinar)_")
        .replace(/\{\{\s*valor_extenso\s*\}\}/g, total > 0 ? valorPorExtenso(total) : "_(a combinar)_")
        .replace(/\{\{\s*servicos\s*\}\}/g, bloco.join("\n\n"));
    }
    // PROPOSTA COMERCIAL: espelha o servidor (montarServicos) — tabela de serviços + investimento +
    // prazo/condições/observações + apresentação. Assim a prévia mostra a proposta COMPLETA em tempo real.
    if (modo === "PROPOSTA" && !ehCredenciamento) {
      const servDe = (id: string) => servicosAtivos.data?.find((s) => s.id === id);
      const ids = Object.keys(sel);
      let av = 0;
      let me = 0;
      const pcts: string[] = [];
      const linhas = Object.entries(sel).map(([id, i]) => {
        const qtd = i.qtd || 1;
        const sub = (i.valor || 0) * qtd;
        if (i.recorrencia === "MENSAL") me += sub;
        else av += sub;
        const partes: string[] = [];
        if (sub > 0) {
          const base = qtd > 1 ? `${qtd} × ${formatBRL(i.valor || 0)} = ${formatBRL(sub)}` : formatBRL(sub);
          partes.push(base + (i.recorrencia === "MENSAL" ? "/mês" : ""));
        }
        if (i.percentual != null && i.percentual > 0) {
          partes.push(`${i.percentual}% do faturamento/mês`);
          pcts.push(`${i.percentual}% do faturamento (${servDe(id)?.nome ?? "serviço"})`);
        }
        const preco = partes.length ? partes.join(" + ") : "a combinar";
        const desc = servDe(id)?.descricao ? ` — ${servDe(id)?.descricao}` : "";
        return `| **${servDe(id)?.nome ?? "Serviço"}**${desc} | ${preco} |`;
      });
      const tabela = ids.length
        ? `| Serviço | Investimento |\n| --- | --- |\n${linhas.join("\n")}`
        : "_(selecione os serviços ao lado para vê-los aqui)_";
      const inv: string[] = [];
      if (av > 0) inv.push(`- **À vista (1x):** ${formatBRL(av)}`);
      if (me > 0) inv.push(`- **Mensal:** ${formatBRL(me)}/mês`);
      for (const p of pcts) inv.push(`- **${p}** — por mês`);
      if (!inv.length) inv.push("- A combinar");
      const extras = [
        prazo.trim() ? `**Prazo estimado:** ${prazo.trim()}` : "",
        condicoes.trim() ? `**Condições de pagamento:** ${condicoes.trim()}` : "",
      ].filter(Boolean);
      const bloco = [`## Serviços propostos\n\n${tabela}`, `## Investimento\n\n${inv.join("\n")}`];
      // Espelha o servidor: com o faturamento informado, o papel mostra a CONTA feita, não só
      // o percentual solto (ADR-126).
      if (ehFaturamento && faturamentoMensal > 0 && percentualDaProposta > 0) {
        bloco.push(
          `**Faturamento mensal médio informado:** ${formatBRL(faturamentoMensal)}  \n` +
            `**Valor estimado do serviço:** ${formatBRL(valorEstimadoDoFaturamento)}/mês (${percentualDaProposta}% de ${formatBRL(faturamentoMensal)}).  \n` +
            `_Valor de referência: a cobrança acompanha o faturamento efetivamente apurado no mês._`,
        );
      }
      if (extras.length) bloco.push(extras.join("  \n"));
      if (observacoes.trim()) bloco.push(observacoes.trim());
      const apresentacao =
        (usarIA ? "*(A IA vai personalizar esta apresentação ao gerar.)* " : "") +
        "A MedConsultoria cuida de todos os processos da sua clínica para lhe dar mais tempo e tranquilidade " +
        "para fazer o que mais importa: cuidar de vidas. Apresentamos a seguir a proposta pensada para as suas necessidades.";
      corpo = corpo
        .replace(/\{\{\s*servicos\s*\}\}/g, bloco.join("\n\n"))
        .replace(
          /\{\{\s*convenios\s*\}\}/g,
          conveniosSel.length
            ? conveniosSel
                .map((id) => catalogoConvenios.data?.find((o) => o.id === id)?.nome)
                .filter(Boolean)
                .map((n) => `- **${n}**`)
                .join("\n")
            : "_(selecione os convênios ao lado)_",
        )
        .replace(
          /\{\{\s*faturamento_mensal\s*\}\}/g,
          faturamentoMensal > 0 ? formatBRL(faturamentoMensal) : "_(a informar)_",
        )
        .replace(/\{\{\s*percentual\s*\}\}/g, percentualDaProposta > 0 ? `${percentualDaProposta}%` : "_(a combinar)_")
        .replace(/\{\{\s*numero\s*\}\}/g, "_(gerado ao criar)_")
        .replace(/\{\{\s*consultora\s*\}\}/g, usuario.nome || "MedConsultoria")
        .replace(/\{\{\s*apresentacao\s*\}\}/g, apresentacao);
    }
    if (modo === "CONTRATO") {
      const nomeDe = (id: string) => servicosAtivos.data?.find((s) => s.id === id)?.nome ?? "Serviço";
      const ids = Object.keys(sel);
      const objeto = ids.length ? ids.map((id) => `- **${nomeDe(id)}**`).join("\n") : "_______";
      const clausulas = ids.length
        ? ids.map((id) => `### ${nomeDe(id)}\n\n_(cláusula específica do serviço — entra ao gerar)_`).join("\n\n")
        : "_______";
      let av = 0;
      let me = 0;
      const pcts: string[] = [];
      for (const [id, i] of Object.entries(sel)) {
        const sub = (i.valor || 0) * (i.qtd || 1);
        if (i.recorrencia === "MENSAL") me += sub;
        else av += sub;
        if (i.percentual != null && i.percentual > 0) pcts.push(`- **${i.percentual}% do faturamento (${nomeDe(id)})** — por mês`);
      }
      const inv: string[] = [];
      if (av > 0) inv.push(`- **À vista (1x):** ${formatBRL(av)}`);
      if (me > 0) inv.push(`- **Mensal:** ${formatBRL(me)}/mês`);
      inv.push(...pcts);
      corpo = corpo
        .replace(/\{\{\s*objeto\s*\}\}/g, objeto)
        .replace(/\{\{\s*clausulas_servicos\s*\}\}/g, clausulas)
        .replace(/\{\{\s*valor\s*\}\}/g, inv.length ? inv.join("\n") : "_______")
        .replace(/\{\{\s*prazo\s*\}\}/g, textoVigencia(vigenciaMeses))
        .replace(/\{\{\s*foro\s*\}\}/g, "da comarca do domicílio da CONTRATANTE");
    }
    if (modo === "RECIBO") {
      corpo = corpo
        .replace(/\{\{\s*valor\s*\}\}/g, reciboValor > 0 ? formatBRL(reciboValor) : "_______")
        .replace(/\{\{\s*valor_extenso\s*\}\}/g, valorPorExtenso(reciboValor) || "_______")
        .replace(/\{\{\s*referente\s*\}\}/g, reciboReferente.trim() || "_______")
        .replace(/\{\{\s*forma_pagamento\s*\}\}/g, reciboForma);
    }
    if (modo === "PLANO") {
      corpo = corpo
        .replace(/\{\{\s*objetivo\s*\}\}/g, planoObjetivo.trim() || "_______")
        .replace(/\{\{\s*acoes\s*\}\}/g, acoesTabela())
        .replace(/\{\{\s*indicadores\s*\}\}/g, planoIndicadores.trim() || "_______");
    }
    if (modo === "PAUTA_POST") {
      corpo = corpo
        .replace(/\{\{\s*periodo\s*\}\}/g, postPeriodo.trim() || "_______")
        .replace(/\{\{\s*postagens\s*\}\}/g, postagensTabela())
        .replace(/\{\{\s*observacoes\s*\}\}/g, postObs.trim() || "—");
    }
    if (modo === "GENERICO" && modoGen === "MANUAL") {
      for (const [k, v] of Object.entries(vars)) {
        if (v.trim()) {
          const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          corpo = corpo.replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, "g"), v);
        }
      }
    }
    return previewModelo(corpo);
  };

  const onSuccess = (doc: { id: string }) => {
    utils.documentos.list.invalidate();
    utils.clientes.relacionados.invalidate();
    // A proposta de credenciamento GRAVA a grade médico × operadora ao ser gerada — a ficha
    // do cliente precisa mostrar os cruzamentos novos sem esperar um refetch espontâneo.
    utils.credenciamento.grade.invalidate();
    onClose();
    navigate({ to: "/documentos/$documentoId", params: { documentoId: doc.id } });
  };
  const create = trpc.documentos.create.useMutation({ onSuccess });
  const gerarIA = trpc.documentos.gerarComIA.useMutation({ onSuccess });
  const criarProposta = trpc.documentos.criarProposta.useMutation({ onSuccess });
  const criarContrato = trpc.documentos.criarContrato.useMutation({ onSuccess });
  const resumir = trpc.documentos.resumirReuniao.useMutation({ onSuccess });
  const gerarPauta = trpc.documentos.gerarPauta.useMutation({ onSuccess });
  const pending =
    create.isPending || gerarIA.isPending || criarProposta.isPending || criarContrato.isPending || resumir.isPending || gerarPauta.isPending;
  const erro =
    create.error?.message ??
    gerarIA.error?.message ??
    criarProposta.error?.message ??
    criarContrato.error?.message ??
    resumir.error?.message ??
    gerarPauta.error?.message;

  const clienteArg = clienteId || undefined;
  const tituloArg = titulo.trim() || undefined;

  const executar = () => {
    if (modo === "PROPOSTA") {
      criarProposta.mutate({
        clienteId: clienteArg,
        modeloId,
        titulo: tituloArg,
        // Credenciamento envia a GRADE (médico × operadora) ou, sem médico cadastrado, as
        // operadoras soltas; a proposta comercial envia os serviços do catálogo.
        ...(ehCredenciamento
          ? modoGrade
            ? { grade: celulasGrade }
            : {
                operadoras: operadoraProposta ? [operadoraProposta.nome] : [],
                valorPorOperadora: valorOperadora || undefined,
              }
          : {
              itens: Object.entries(sel).map(([servicoId, i]) => ({
                servicoId,
                valor: i.valor,
                quantidade: i.qtd,
                recorrencia: i.recorrencia,
                percentual: i.percentual,
              })),
              // Faturamento (ADR-126): os convênios e a base do cálculo. O servidor grava os
              // convênios dentro do item para eles atravessarem o aceite, e devolve o
              // faturamento ao lead.
              ...(ehFaturamento
                ? { conveniosIds: conveniosSel, faturamentoMensal: faturamentoMensal || 0 }
                : {}),
            }),
        prazo: prazo || undefined,
        condicoes: condicoes || undefined,
        observacoes: observacoes || undefined,
        usarIA,
      });
    } else if (modo === "CONTRATO") {
      criarContrato.mutate({
        clienteId: clienteId,
        modeloId,
        titulo: tituloArg,
        vigenciaMeses,
        observacoes: observacoes || undefined,
        itens: Object.entries(sel).map(([servicoId, i]) => ({
          servicoId,
          valor: i.valor,
          quantidade: i.qtd,
          recorrencia: i.recorrencia,
          percentual: i.percentual,
        })),
      });
    } else if (modo === "ATA") {
      resumir.mutate({ anotacoes, clienteId: clienteArg, titulo: tituloArg });
    } else if (modo === "PAUTA") {
      gerarPauta.mutate({ topicos, clienteId: clienteArg, titulo: tituloArg });
    } else if (modo === "RECIBO") {
      create.mutate({
        modeloId,
        clienteId: clienteArg,
        titulo: tituloArg,
        variaveis: {
          valor: formatBRL(reciboValor),
          valor_extenso: valorPorExtenso(reciboValor),
          referente: reciboReferente.trim(),
          forma_pagamento: reciboForma,
        },
      });
    } else if (modo === "PLANO") {
      create.mutate({
        modeloId,
        clienteId: clienteArg,
        titulo: tituloArg,
        variaveis: { objetivo: planoObjetivo.trim(), acoes: acoesTabela(), indicadores: planoIndicadores.trim() },
      });
    } else if (modo === "PAUTA_POST") {
      create.mutate({
        modeloId,
        clienteId: clienteArg,
        titulo: tituloArg,
        variaveis: { periodo: postPeriodo.trim(), postagens: postagensTabela(), observacoes: postObs.trim() },
      });
    } else if (modoGen === "IA") {
      gerarIA.mutate({ modeloId, clienteId: clienteArg, titulo: tituloArg, instrucoes });
    } else {
      create.mutate({ modeloId, clienteId: clienteArg, titulo: tituloArg, variaveis: vars });
    }
  };

  const acaoLabel =
    modo === "PROPOSTA"
      ? "Gerar proposta"
      : modo === "CONTRATO"
      ? "Gerar contrato"
      : modo === "ATA"
        ? "Gerar ata"
        : modo === "PAUTA"
          ? "Gerar pauta"
          : modo === "RECIBO"
            ? "Gerar recibo"
            : modo === "PLANO"
              ? "Gerar plano"
              : modo === "PAUTA_POST"
                ? "Gerar calendário"
                : modoGen === "IA"
                  ? "Gerar com IA"
                  : "Gerar documento";
  const AcaoIcon =
    modo === "PROPOSTA" || modo === "CONTRATO"
      ? FileSignature
      : modo === "RECIBO"
        ? Receipt
        : modo === "ATA" || modo === "PAUTA" || modoGen === "IA"
          ? Sparkles
          : null;
  const desabilitado =
    !modelo ||
    pending ||
    (modo === "PROPOSTA"
      ? ehCredenciamento
        ? !operadoraProposta || (modoGrade && celulasGrade.length === 0)
        : Object.keys(sel).length === 0
      : modo === "CONTRATO"
      ? !clienteId || Object.keys(sel).length === 0
      : modo === "ATA"
        ? !anotacoes.trim()
        : modo === "PAUTA"
          ? !topicos.trim()
          : modo === "RECIBO"
            ? reciboValor <= 0 || !reciboReferente.trim()
            : modo === "PLANO"
              ? !planoObjetivo.trim() || !planoAcoes.some((a) => a.acao.trim())
              : modo === "PAUTA_POST"
                ? !postagens.some((p) => p.tema.trim() || p.data.trim())
                : modoGen === "IA"
                  ? !instrucoes.trim()
                  : false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo documento"
      size={modelo ? "2xl" : "md"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button disabled={desabilitado} onClick={executar}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : AcaoIcon ? (
              <AcaoIcon className="h-4 w-4" />
            ) : null}
            {acaoLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className={cn("grid grid-cols-1 gap-3", !clienteFixo && "sm:grid-cols-2")}>
          <div className="space-y-1.5">
            <Label htmlFor="modelo" hint="Escolha o tipo de documento — proposta, contrato, recibo, ata, plano de ação, etc.">O que criar? *</Label>
            <Combobox
              id="modelo"
              value={modeloId}
              onChange={setModeloId}
              options={(modelos.data ?? []).map((m) => ({ value: m.id, label: m.nome }))}
              placeholder="Escolha o tipo de documento…"
              emptyText="Nenhum modelo."
            />
          </div>
          {!clienteFixo && (
            <div className="space-y-1.5">
              <Label htmlFor="cliente">Cliente</Label>
              <Combobox
                id="cliente"
                value={clienteId}
                onChange={setClienteId}
                options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Buscar cliente…"
                emptyText="Nenhum cliente encontrado."
              />
            </div>
          )}
        </div>

        {!modelo ? (
          <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
            Escolha acima o que você quer criar — o formulário se ajusta ao tipo (proposta, ata, pauta…).
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              {modo === "PROPOSTA" ? (
          <>
            {ehCredenciamento ? (
              <CredenciamentoPicker
                clienteId={clienteId}
                celulas={celulasGrade}
                setCelulas={setCelulasGrade}
                operadora={operadoraProposta}
                setOperadora={setOperadoraProposta}
                valorOperadora={valorOperadora}
                setValorOperadora={setValorOperadora}
                onModoGrade={setModoGrade}
              />
            ) : (
              <>
                <PropostaServicosPicker sel={sel} setSel={setSel} />
                {ehFaturamento && (
                  <>
                    <ConveniosPicker selecionados={conveniosSel} setSelecionados={setConveniosSel} />
                    <div className="space-y-1">
                      <Label
                        htmlFor="prop-faturamento"
                        hint="Quanto a clínica fatura por mês, em média. É a mesma informação da Qualificação no funil — corrigir aqui corrige lá."
                      >
                        Faturamento mensal médio da clínica
                      </Label>
                      <MoneyInput
                        id="prop-faturamento"
                        value={faturamentoMensal}
                        onChange={(v) => {
                          faturamentoTocado.current = true;
                          setFaturamentoMensal(v ?? 0);
                        }}
                        className="h-9"
                      />
                      {valorEstimadoDoFaturamento > 0 ? (
                        <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                          Valor do negócio:{" "}
                          <strong className="text-foreground">{formatBRL(valorEstimadoDoFaturamento)}/mês</strong> (
                          {percentualDaProposta}% de {formatBRL(faturamentoMensal)}). Este número também atualiza o
                          card do lead no funil.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sem valor fixo: a cobrança é o percentual sobre o que a clínica fatura, todo mês.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="prop-prazo">Prazo estimado</Label>
                <Input id="prop-prazo" value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="Ex.: 60 dias" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="prop-cond">Condições de pagamento</Label>
                <Input
                  id="prop-cond"
                  value={condicoes}
                  onChange={(e) => {
                    condicoesTocadas.current = true;
                    setCondicoes(e.target.value);
                  }}
                  placeholder="Ex.: 30% + 2x"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prop-obs">Observações</Label>
              <Textarea id="prop-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>
            {ia.data?.disponivel && modelo.corpo.includes("{{apresentacao}}") && (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <input type="checkbox" checked={usarIA} onChange={(e) => setUsarIA(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Deixar a IA escrever a apresentação da proposta</span>
              </label>
            )}
          </>
        ) : modo === "CONTRATO" ? (
          <>
            {!clienteId ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                <FileSignature className="h-4 w-4" /> Escolha o cliente acima — o contrato puxa sozinho os serviços que ele já contratou.
              </p>
            ) : (
              <>
                {/* De onde vieram os serviços pré-marcados (transparência). */}
                {contexto.data && (
                  <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    {contexto.data.origem === "CONTRATADO"
                      ? "✓ Serviços puxados do que este cliente já tem contratado (valores reais). Ajuste se precisar."
                      : contexto.data.origem === "LEAD"
                      ? "Serviços sugeridos pela negociação em andamento (preços de referência). Confira os valores."
                      : "Este cliente ainda não tem serviços contratados — escolha abaixo o que entra no contrato."}
                  </p>
                )}
                <PropostaServicosPicker sel={sel} setSel={setSel} titulo="Serviços do contrato" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="cont-vig" hint="Duração do contrato; renova automaticamente ao final, salvo aviso prévio.">Vigência</Label>
                    <Select id="cont-vig" value={String(vigenciaMeses)} onChange={(e) => setVigenciaMeses(Number(e.target.value))}>
                      {VIGENCIAS.map((v) => (
                        <option key={v} value={v}>
                          {v} meses
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="cont-obs"
                    hint="As cláusulas de cada serviço entram automaticamente no contrato ao gerar. Nasce como rascunho para revisão."
                  >
                    Observações (cláusulas extras, condições)
                  </Label>
                  <Textarea id="cont-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
                </div>
              </>
            )}
          </>
        ) : modo === "ATA" ? (
          <div className="space-y-1.5">
            <Label htmlFor="ata-anot" className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Anotações da reunião (a IA resume em ata) *
            </Label>
            <Textarea
              id="ata-anot"
              value={anotacoes}
              onChange={(e) => setAnotacoes(e.target.value)}
              placeholder="Cole aqui suas anotações, tópicos e decisões — ou grave/envie o áudio da reunião. A IA organiza em ata (pauta, decisões, próximos passos)."
              className="min-h-40"
            />
            {ia.data?.disponivel && <AudioTranscricao onTexto={(t) => setAnotacoes((a) => anexar(a, t))} />}
          </div>
        ) : modo === "PAUTA" ? (
          <div className="space-y-1.5">
            <Label
              htmlFor="pauta-top"
              className="flex items-center gap-1.5"
              hint="A IA monta a pauta usando o contexto do cliente (serviços, etapa no funil)."
            >
              <CalendarClock className="h-4 w-4 text-primary" /> O que você quer tratar na reunião? *
            </Label>
            <Textarea
              id="pauta-top"
              value={topicos}
              onChange={(e) => setTopicos(e.target.value)}
              placeholder="Ex.: apresentar resultados do mês, renovar contrato, alinhar campanha de agosto… (ou dite por áudio)"
              className="min-h-32"
            />
            {ia.data?.disponivel && <AudioTranscricao onTexto={(t) => setTopicos((a) => anexar(a, t))} />}
          </div>
        ) : modo === "RECIBO" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rec-valor">Valor recebido *</Label>
                <MoneyInput id="rec-valor" value={reciboValor} onChange={(v) => setReciboValor(v ?? 0)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rec-forma">Forma de pagamento</Label>
                <Select id="rec-forma" value={reciboForma} onChange={(e) => setReciboForma(e.target.value)}>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {reciboValor > 0 && (
              <p className="rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Por extenso: <span className="font-medium text-foreground">{valorPorExtenso(reciboValor)}</span>
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="rec-ref" hint="Descreva o serviço ou período a que este recibo se refere.">Referente a *</Label>
              <Input
                id="rec-ref"
                value={reciboReferente}
                onChange={(e) => setReciboReferente(e.target.value)}
                placeholder="Ex.: serviços de consultoria de julho/2026"
              />
            </div>
          </div>
        ) : modo === "PLANO" ? (
          <PlanoAcaoFields
            objetivo={planoObjetivo}
            setObjetivo={setPlanoObjetivo}
            acoes={planoAcoes}
            setAcoes={setPlanoAcoes}
            indicadores={planoIndicadores}
            setIndicadores={setPlanoIndicadores}
          />
        ) : modo === "PAUTA_POST" ? (
          <PautaPostagemFields
            periodo={postPeriodo}
            setPeriodo={setPostPeriodo}
            posts={postagens}
            setPosts={setPostagens}
            observacoes={postObs}
            setObservacoes={setPostObs}
          />
        ) : (
          <>
            {ia.data?.disponivel && (
              <div className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
                {(["MANUAL", "IA"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setModoGen(m)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                      modoGen === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "IA" && <Sparkles className="h-3.5 w-3.5" />}
                    {m === "MANUAL" ? "Preencher campos" : "Gerar com IA"}
                  </button>
                ))}
              </div>
            )}
            {modoGen === "MANUAL" ? (
              variaveis.length > 0 ? (
                <SmartCampos campos={variaveis} vars={vars} setVars={setVars} />
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ClipboardList className="h-4 w-4" /> Este modelo não tem campos — é só gerar.
                </p>
              )
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="instrucoes" hint="A IA gera um rascunho — você revisa e aprova antes de enviar.">
                  O que a IA deve gerar?
                </Label>
                <Textarea
                  id="instrucoes"
                  autoComplete="off"
                  value={instrucoes}
                  onChange={(e) => setInstrucoes(e.target.value)}
                  placeholder="Ex.: relatório do mês de julho com foco em glosas recuperadas, tom formal. (ou dite por áudio)"
                  className="min-h-24"
                />
                <AudioTranscricao onTexto={(t) => setInstrucoes((a) => anexar(a, t))} />
              </div>
            )}
          </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="titulo">Título</Label>
                <Input id="titulo" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Gerado automaticamente se vazio" />
              </div>

              {erro && <p className="text-sm text-destructive">{erro}</p>}
            </div>

            {/* Prévia A4 do modelo — comercial × credenciamento ficam visivelmente diferentes aqui. */}
            <div className="space-y-2 lg:sticky lg:top-0">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" /> Prévia do documento
                </span>
                {(() => {
                  const P = papelModelo(modelo.tipo);
                  return (
                    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      <P.Icon className="h-3 w-3" /> {P.texto}
                    </span>
                  );
                })()}
              </div>
              <div className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/30 p-3">
                <DocumentoBranded
                  tipo={TIPO_MODELO_LABEL[modelo.tipo]}
                  titulo={titulo.trim() || modelo.nome}
                  clienteNome={clientes.data?.find((c) => c.id === clienteId)?.nome ?? null}
                  conteudoMarkdown={conteudoPreview()}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                É assim que o documento vai ficar. Os campos entre colchetes e os serviços entram ao gerar.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
