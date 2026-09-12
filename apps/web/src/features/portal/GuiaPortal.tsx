import {
  HandHeart,
  Hourglass,
  FileSignature,
  FileUp,
  Stethoscope,
  Layers,
  Briefcase,
  Sparkles,
  MessageSquare,
  Mail,
  Users,
  ShieldCheck,
} from "lucide-react";
import { GuiaModal, type Passo } from "../../components/GuiaTour";
import { usePortalCaminho } from "./navegar";

/**
 * O GUIA "?" DO PORTAL — um por seção, não um só para tudo.
 *
 * Antes o Portal era uma página só, e o guia também: cinco passos que falavam de tudo um pouco.
 * Com as seções, o cliente abre a ajuda **dentro** de um assunto, e o guia genérico passaria
 * quatro quintos do tempo falando do que ele não está olhando.
 *
 * Reusa o `GuiaModal` da equipe (o visual é desacoplado do roteador interno). ⚠️ **Mas os guias
 * do Portal NÃO entram no catálogo `OUTRAS` do `GuiaTour`**: aquele filtra passo por papel
 * INTERNO, que o cliente não tem, e o teste-guarda dele cruza a lista com `app/router.tsx`.
 * São dois catálogos, para dois aplicativos.
 */

const GUIA_INICIO: Passo[] = [
  {
    icon: HandHeart,
    logo: true,
    titulo: "Bem-vindo ao seu Portal",
    descricao:
      "Aqui você acompanha seu atendimento — serviços, documentos, reuniões e suporte — num só lugar. Use a barra de baixo para trocar de assunto.",
  },
  {
    icon: Hourglass,
    titulo: "Esta tela é a sua fila",
    descricao:
      "O Início mostra só o que precisa de você: propostas para responder, documentos para assinar e o que a nossa equipe está esperando. Quando não há nada aqui, está tudo em dia.",
  },
];

const GUIA_DOCUMENTOS: Passo[] = [
  {
    icon: FileSignature,
    titulo: "O que preparamos para você",
    descricao:
      "Propostas, contratos e atas que preparamos ficam no primeiro bloco. Para assinar, é só clicar, revisar e confirmar pela tela — com validade jurídica.",
  },
  {
    icon: FileUp,
    titulo: "O que você envia para nós",
    descricao:
      "No segundo bloco ficam os seus documentos — RG, alvará, CRM, comprovantes. São seus: você envia e pode remover. Os nossos, do bloco de cima, você lê e assina, mas não apaga.",
  },
];

const GUIA_CONVENIOS: Passo[] = [
  {
    icon: Stethoscope,
    titulo: "A papelada de cada médico",
    descricao:
      "Cada convênio pede uma lista de documentos, e essa lista se repete para cada médico da clínica. Por isso cada profissional tem o próprio bloco aqui: assim dá para ver de quem falta o quê, sem confundir um diploma com outro.",
  },
  {
    icon: Layers,
    titulo: "Frente e verso contam separado",
    descricao:
      "Documento que tem os dois lados aparece com duas vagas, e a barra de progresso conta cada uma. Dois médicos com metade da papelada mostram 50%, e não 100% — é o número que diz de verdade quanto falta para protocolar.",
  },
];

const GUIA_SERVICOS: Passo[] = [
  {
    icon: Briefcase,
    titulo: "Seus serviços contratados",
    descricao:
      "Cada serviço mostra o preço combinado, os convênios que atendemos por ele e o que ainda falta você enviar. O que estiver pendente aparece marcado em âmbar, com o botão de envio ao lado.",
  },
  {
    icon: Sparkles,
    titulo: "Precisa de mais alguma coisa?",
    descricao:
      "Logo abaixo fica o que ainda podemos fazer por você. Escolha os serviços, conte o que precisa se quiser, e a nossa equipe prepara a proposta — sem telefonema e sem esperar horário comercial.",
  },
];

const GUIA_SUPORTE: Passo[] = [
  {
    icon: MessageSquare,
    titulo: "Fale direto com a equipe",
    descricao:
      "Abra um chamado e converse por aqui. Cada chamado tem um número, guarda o histórico da conversa e avisa você quando alguém responder — nada se perde num grupo de mensagens.",
  },
  {
    icon: Mail,
    titulo: "Tudo que enviamos por e-mail",
    descricao:
      "No fim da tela fica a lista dos e-mails que mandamos para você, com assunto e data. Serve para conferir se algo chegou, mesmo que a mensagem tenha se perdido na sua caixa.",
  },
];

const GUIA_EQUIPE: Passo[] = [
  {
    icon: Users,
    titulo: "Cada pessoa com o próprio acesso",
    descricao:
      "Convide os médicos e as secretárias da clínica: cada um entra com o próprio e-mail e a própria senha. Ninguém precisa dividir acesso, e o histórico passa a dizer quem fez o quê.",
  },
  {
    icon: ShieldCheck,
    titulo: "Quem fala pela clínica",
    descricao:
      "Quem é Responsável aceita proposta, contrata e cancela serviço. Quem é Equipe cuida do dia a dia — mas vê tudo do mesmo jeito. A clínica nunca fica sem alguém que possa assinar.",
  },
];

interface GuiaDaSecao {
  prefixo: string;
  titulo: string;
  passos: Passo[];
}

/**
 * ⚠️ A ORDEM IMPORTA, e `/portal` vem POR ÚLTIMO.
 *
 * A resolução é por prefixo e para no primeiro que casar. `/portal` é prefixo de todos os
 * outros: em primeiro lugar, ele capturaria as cinco seções e todas abririam o guia do Início.
 * É exatamente a armadilha que o teste-guarda existe para pegar — a mesma que já mordeu
 * `/emails` × `/emails-enviados` no aplicativo da equipe.
 */
export const GUIAS_DO_PORTAL: GuiaDaSecao[] = [
  { prefixo: "/portal/documentos", titulo: "Documentos", passos: GUIA_DOCUMENTOS },
  { prefixo: "/portal/credenciamento", titulo: "Credenciamento nos convênios", passos: GUIA_CONVENIOS },
  { prefixo: "/portal/servicos", titulo: "Meus serviços", passos: GUIA_SERVICOS },
  { prefixo: "/portal/suporte", titulo: "Suporte", passos: GUIA_SUPORTE },
  { prefixo: "/portal/equipe", titulo: "Equipe da clínica", passos: GUIA_EQUIPE },
  { prefixo: "/portal", titulo: "Seu Portal", passos: GUIA_INICIO },
];

/** Prefixos na ordem — exportado para o teste-guarda conferir cobertura e ordem. */
export const PREFIXOS_GUIA_PORTAL = GUIAS_DO_PORTAL.map((g) => g.prefixo);

/** O guia da seção aberta. Fora do Portal (não deveria acontecer), cai no do Início. */
export function guiaDoPortal(caminho: string): GuiaDaSecao {
  return GUIAS_DO_PORTAL.find((g) => caminho.startsWith(g.prefixo)) ?? GUIAS_DO_PORTAL[GUIAS_DO_PORTAL.length - 1]!;
}

export function GuiaPortal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const caminho = usePortalCaminho();
  const guia = guiaDoPortal(caminho);
  // `resetKey` com o caminho faz o carrossel voltar ao passo 1 a cada troca de seção — sem
  // isso, quem viu o passo 2 de Documentos abriria Suporte já no passo 2.
  return <GuiaModal open={open} onClose={onClose} titulo={guia.titulo} passos={guia.passos} resetKey={caminho} />;
}
