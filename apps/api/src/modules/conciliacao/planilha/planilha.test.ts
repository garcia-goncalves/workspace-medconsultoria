import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodificarTexto, detectarSeparador, lerCsv } from "./csv.js";
import { lerTabelaHtml } from "./html.js";
import { detectarFormato } from "./formato.js";
import { ErroDePlanilha, lerGrade, localizarCabecalho, normalizarTexto } from "./index.js";
import { colunaDaReferencia, lerXlsx, serialParaTexto } from "./xlsx.js";

/**
 * As colunas reais do relatório de produção de consultas (print de 11/09/2026). Os dados são
 * SINTÉTICOS: CPF, telefone e e-mail inventados. Amostra de verdade nunca entra no repositório —
 * ver `docs/amostras/README.md`.
 */
const COLUNAS = [
  "Data da agenda",
  "Data do atendimento",
  "Paciente",
  "CPF do paciente",
  "Telefone do Paciente",
  "E-mail",
  "Tipo de atendimento",
  "Plano de convênio",
  "Profissional",
] as const;

describe("detectarFormato — pelo conteúdo, nunca pela extensão", () => {
  it("reconhece xlsx pela assinatura de zip", () => {
    expect(detectarFormato(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe("xlsx");
  });

  it("reconhece o .xls binário antigo pela assinatura OLE2", () => {
    expect(detectarFormato(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]))).toBe("xls-antigo");
  });

  it("reconhece tabela HTML mesmo com o nome .xls", () => {
    expect(detectarFormato(Buffer.from("<html><body><table><tr><td>x</td></tr></table>"))).toBe("html");
  });

  it("reconhece HTML depois de DOCTYPE e espaços", () => {
    expect(detectarFormato(Buffer.from("\n  <!DOCTYPE html>\n<table>"))).toBe("html");
  });

  it("texto puro é csv", () => {
    expect(detectarFormato(Buffer.from("Paciente;CPF\nAna;1"))).toBe("csv");
  });

  it("arquivo vazio é vazio, não csv de zero linhas", () => {
    expect(detectarFormato(Buffer.alloc(0))).toBe("vazio");
  });
});

describe("decodificarTexto — acento errado quebra o de-para de convênio", () => {
  it("lê UTF-8 com BOM sem deixar o BOM na primeira célula", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Paciente;Convênio", "utf8")]);
    expect(decodificarTexto(bytes)).toBe("Paciente;Convênio");
  });

  it("cai para latin-1 quando o arquivo não é UTF-8 válido (Excel brasileiro)", () => {
    // "PORTO SEGURO - BÁSICO" salvo pelo Excel em CSV vira latin-1.
    const bytes = Buffer.from("PORTO SEGURO - BÁSICO", "latin1");
    expect(decodificarTexto(bytes)).toBe("PORTO SEGURO - BÁSICO");
  });

  it("lê UTF-16 LE com BOM", () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Cortesia", "utf16le")]);
    expect(decodificarTexto(bytes)).toBe("Cortesia");
  });

  it("UTF-8 de verdade não é confundido com latin-1", () => {
    expect(decodificarTexto(Buffer.from("CIRURGIÃO", "utf8"))).toBe("CIRURGIÃO");
  });
});

describe("detectarSeparador", () => {
  it("acha o ponto e vírgula do Excel em português", () => {
    expect(detectarSeparador("Data;Paciente;Convênio\n01/08/2026;Ana;CABESP")).toBe(";");
  });

  it("acha a vírgula quando é esse o separador", () => {
    expect(detectarSeparador("Data,Paciente,Convenio\n01/08/2026,Ana,CABESP")).toBe(",");
  });

  it("acha o tab", () => {
    expect(detectarSeparador("Data\tPaciente\tConvenio")).toBe("\t");
  });

  it("não se deixa enganar por vírgula DENTRO de aspas", () => {
    // O caso real: telefone traz vários números separados por vírgula na mesma célula.
    const texto = 'Paciente;Telefone;Convenio\nAna;"(11) 96067-6368, (11) 99340-4760";CABESP';
    expect(detectarSeparador(texto)).toBe(";");
  });
});

describe("lerCsv", () => {
  it("lê o cabeçalho real e uma linha", () => {
    const csv = `${COLUNAS.join(";")}\n31/08/2026;31/08/2026;WILMA SAVINI;029.978.978-07;(11) 96067-6368;;Consulta;PORTO SEGURO - BÁSICO;DR. LEONARDO GIGLIO DRAGONE`;
    const linhas = lerCsv(csv);
    expect(linhas[0]).toEqual([...COLUNAS]);
    expect(linhas[1]![2]).toBe("WILMA SAVINI");
    expect(linhas[1]![5]).toBe(""); // e-mail vazio é comum no arquivo real
    expect(linhas[1]![7]).toBe("PORTO SEGURO - BÁSICO");
  });

  it("mantém junto o telefone com vários números entre aspas", () => {
    const csv = 'Paciente;Telefone\nDORINDA;"(00) 98269-5583, (00) 2204-9854, (00) 98434-3383"';
    expect(lerCsv(csv)[1]![1]).toBe("(00) 98269-5583, (00) 2204-9854, (00) 98434-3383");
  });

  it("aceita quebra de linha dentro de um campo entre aspas", () => {
    const linhas = lerCsv('A;B\n"linha um\nlinha dois";fim');
    expect(linhas).toHaveLength(2);
    expect(linhas[1]![0]).toBe("linha um\nlinha dois");
  });

  it('desdobra a aspa escapada ("")', () => {
    expect(lerCsv('A\n"ele disse ""oi"""')[1]![0]).toBe('ele disse "oi"');
  });

  it("aguenta CRLF do Windows sem deixar \\r grudado na última célula", () => {
    const linhas = lerCsv("A;B\r\n1;2\r\n");
    expect(linhas).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("não inventa uma linha vazia por causa da quebra final", () => {
    expect(lerCsv("A;B\n1;2\n")).toHaveLength(2);
  });

  it("preserva a coluna vazia do meio — Data da agenda vem vazia quando é 'Sem vínculo'", () => {
    const linhas = lerCsv(";28/08/2026;CELIA OTA;;;;Sem vínculo com a agenda;Sul America - Semar;DRA. LAYS");
    expect(linhas[0]![0]).toBe("");
    expect(linhas[0]![6]).toBe("Sem vínculo com a agenda");
    expect(linhas[0]).toHaveLength(9);
  });
});

describe("lerTabelaHtml — o '.xls' que na verdade é HTML", () => {
  it("extrai linhas e células de uma tabela simples", () => {
    const html = `<html><body><table>
      <tr><th>Paciente</th><th>Convênio</th></tr>
      <tr><td>WILMA SAVINI</td><td>PORTO SEGURO - B&Aacute;SICO</td></tr>
    </table></body></html>`;
    expect(lerTabelaHtml(html)).toEqual([
      ["Paciente", "Convênio"],
      ["WILMA SAVINI", "PORTO SEGURO - BÁSICO"],
    ]);
  });

  it("resolve &nbsp; e entidade numérica, e colapsa espaço", () => {
    const html = "<table><tr><td>  A&nbsp;&nbsp;B  </td><td>&#38;&#x41;</td></tr></table>";
    expect(lerTabelaHtml(html)).toEqual([["A B", "&A"]]);
  });

  it("<br> vira espaço em vez de grudar as palavras", () => {
    expect(lerTabelaHtml("<table><tr><td>linha um<br>linha dois</td></tr></table>")).toEqual([["linha um linha dois"]]);
  });

  it("joga fora a marcação de dentro da célula", () => {
    expect(lerTabelaHtml("<table><tr><td><b>Cortesia</b></td></tr></table>")).toEqual([["Cortesia"]]);
  });

  it("ignora <tr> de layout que não tem célula nenhuma", () => {
    expect(lerTabelaHtml("<table><tr></tr><tr><td>x</td></tr></table>")).toEqual([["x"]]);
  });

  it("não confunde <table> com uma tag chamada 't'", () => {
    expect(lerTabelaHtml("<table><tr><td>ok</td></tr></table>")).toEqual([["ok"]]);
  });
});

describe("serialParaTexto — a armadilha da data em UTC", () => {
  it("converte o número de série SEM deslocar o dia pelo fuso", () => {
    // 46265 é 31/08/2026 no calendário do Excel. Convertido em horário de Brasília (UTC-3),
    // sairia 30/08 — e a competência inteira andaria um dia para trás, sem erro na tela.
    expect(serialParaTexto(46265)).toBe("31/08/2026");
    expect(serialParaTexto(46266)).toBe("01/09/2026");
  });

  it("mostra a hora quando a fração do dia existe", () => {
    // 0,5 = meio-dia.
    expect(serialParaTexto(46265.5)).toBe("31/08/2026 12:00");
  });

  it("respeita o calendário 1904 do Excel para Mac", () => {
    expect(serialParaTexto(46265 - 1462, true)).toBe("31/08/2026");
  });
});

describe("colunaDaReferencia", () => {
  it("traduz a letra da coluna para índice", () => {
    expect(colunaDaReferencia("A1")).toBe(0);
    expect(colunaDaReferencia("I7")).toBe(8);
    expect(colunaDaReferencia("AA1")).toBe(26);
    expect(colunaDaReferencia("BC12")).toBe(54);
  });
});

describe("lerXlsx — casos que só aparecem em XML escrito por outro sistema", () => {
  const envelope = (linhas: string) => montarXlsxDeTeste(`<sheetData>${linhas}</sheetData>`);

  it("célula OMITIDA não desloca as colunas seguintes", () => {
    // A linha tem A, C e D. Sem olhar o `r=`, o valor de C cairia na coluna B e o relatório
    // inteiro sairia torto, sem nenhum erro.
    const xml = envelope('<row r="1"><c r="A1" t="str"><v>a</v></c><c r="C1" t="str"><v>c</v></c><c r="D1" t="str"><v>d</v></c></row>');
    expect(lerXlsx(xml)).toEqual([["a", "", "c", "d"]]);
  });

  it("lê texto embutido (inlineStr), que muito sistema usa em vez de sharedStrings", () => {
    const xml = envelope('<row r="1"><c r="A1" t="inlineStr"><is><t>CONCEIÇÃO</t></is></c></row>');
    expect(lerXlsx(xml)).toEqual([["CONCEIÇÃO"]]);
  });

  it("desescapa entidade XML no conteúdo", () => {
    const xml = envelope('<row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B &lt;x&gt;</t></is></c></row>');
    expect(lerXlsx(xml)).toEqual([["A & B <x>"]]);
  });

  it("linha em branco pulada no XML não desalinha o número da linha", () => {
    const xml = envelope('<row r="1"><c r="A1" t="str"><v>topo</v></c></row><row r="3"><c r="A3" t="str"><v>fundo</v></c></row>');
    const linhas = lerXlsx(xml);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]![0]).toBe("topo");
    expect(linhas[1]![0]).toBe("");
    expect(linhas[2]![0]).toBe("fundo");
  });

  it("número sem formato de data continua número", () => {
    const xml = envelope('<row r="1"><c r="A1"><v>815.1</v></c></row>');
    expect(lerXlsx(xml)).toEqual([["815.1"]]);
  });

  it("recusa arquivo que não é zip, com recado em português", () => {
    expect(() => lerXlsx(Buffer.from("isto não é um zip"))).toThrow(/planilha/i);
  });

  // ⚠️ Estes dois casos nasceram de DEZ arquivos `.xlsx` reais de repasse, todos recusados com a
  // mensagem errada ("não reconheci este relatório"): o leitor devolvia zero linha porque o XML
  // deles prefixa TODA tag com `x:`, que é livre no OOXML. O arquivo estava certo; o leitor não.
  it("lê o XML com prefixo de espaço de nomes (`<x:row>`), que o Excel não usa e outros sistemas usam", () => {
    const xml = montarXlsxDeTeste(
      '<x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>Atend</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Vl Repasse</x:t></x:is></x:c></x:row>' +
        '<x:row r="2"><x:c r="A2" t="str"><x:v>19100842</x:v></x:c><x:c r="B2"><x:v>1500</x:v></x:c></x:row></x:sheetData>',
    );
    expect(lerXlsx(xml)).toEqual([
      ["Atend", "Vl Repasse"],
      ["19100842", "1500"],
    ]);
  });

  it("planilha sem nenhuma linha RECLAMA, em vez de voltar vazia e a culpa cair no arquivo da pessoa", () => {
    expect(() => lerXlsx(envelope(""))).toThrow(/nenhuma linha/i);
  });
});

describe("localizarCabecalho", () => {
  it("acha o cabeçalho mesmo com título e linha em branco antes", () => {
    const linhas = [
      ["Relatório de produção de consultas", "", ""],
      ["Período: 01/08/2026 a 31/08/2026", "", ""],
      ["", "", ""],
      [...COLUNAS],
      ["31/08/2026", "31/08/2026", "WILMA"],
    ];
    const c = localizarCabecalho(linhas, COLUNAS);
    expect(c?.indice).toBe(3);
    expect(c?.colunas.get("Paciente")).toBe(2);
    expect(c?.colunas.get("Profissional")).toBe(8);
  });

  it("casa sem depender de acento nem de caixa", () => {
    const linhas = [["DATA DA AGENDA", "PLANO DE CONVENIO"]];
    const c = localizarCabecalho(linhas, ["Data da agenda", "Plano de convênio"]);
    expect(c?.colunas.get("Plano de convênio")).toBe(1);
  });

  it("'Data do atendimento' não é roubada por uma coluna 'Data' que vem antes", () => {
    const linhas = [["Data", "Data do atendimento"]];
    const c = localizarCabecalho(linhas, ["Data do atendimento"]);
    expect(c?.colunas.get("Data do atendimento")).toBe(1);
  });

  it("devolve null quando falta coluna — melhor recusar que importar torto", () => {
    expect(localizarCabecalho([["Paciente", "CPF"]], COLUNAS)).toBeNull();
  });

  it("normalizarTexto tira acento, caixa e espaço repetido", () => {
    expect(normalizarTexto("  Plano   de   CONVÊNIO ")).toBe("plano de convenio");
  });
});

describe("lerGrade — a mesma saída para todo formato", () => {
  const LINHA = [
    "31/08/2026",
    "31/08/2026",
    "WILMA SAVINI",
    "029.978.978-07",
    "(11) 96067-6368",
    "",
    "Consulta",
    "PORTO SEGURO - BÁSICO",
    "DR. LEONARDO GIGLIO DRAGONE",
  ];

  it("lê CSV", async () => {
    const csv = `${COLUNAS.join(";")}\n${LINHA.join(";")}`;
    const grade = await lerGrade(Buffer.from(csv, "utf8"));
    expect(grade.formato).toBe("csv");
    expect(grade.linhas[1]).toEqual(LINHA);
  });

  it("lê a fixture .xlsx REAL, com data de verdade e coluna vazia", async () => {
    // Arquivo gerado por biblioteca de Excel de verdade e versionado (dados sintéticos). É a
    // prova de que o leitor próprio entende o que outro programa escreveu — teste contra XML
    // que eu mesmo montei provaria só que sei ler a minha própria escrita.
    const caminho = fileURLToPath(new URL("../../../test/fixtures/producao-consultas.xlsx", import.meta.url));
    const grade = await lerGrade(readFileSync(caminho));

    expect(grade.formato).toBe("xlsx");
    const cab = localizarCabecalho(grade.linhas, COLUNAS);
    expect(cab?.indice).toBe(3); // título + período + linha em branco antes do cabeçalho

    const primeira = grade.linhas[cab!.indice + 1]!;
    // A data tem de sair dd/mm/aaaa, não o número de série nem o dia anterior.
    expect(primeira[cab!.colunas.get("Data do atendimento")!]).toBe("31/08/2026");
    expect(primeira[cab!.colunas.get("Paciente")!]).toBe("WILMA SAVINI");
    expect(primeira[cab!.colunas.get("E-mail")!]).toBe("");
    expect(primeira[cab!.colunas.get("Plano de convênio")!]).toBe("PORTO SEGURO - BÁSICO");

    // "Sem vínculo com a agenda" vem com a Data da agenda VAZIA — o caso real do print.
    const segunda = grade.linhas[cab!.indice + 2]!;
    expect(segunda[cab!.colunas.get("Data da agenda")!]).toBe("");
    expect(segunda[cab!.colunas.get("Tipo de atendimento")!]).toBe("Sem vínculo com a agenda");

    // Agenda e atendimento divergem de verdade (25/08 → 28/08).
    const terceira = grade.linhas[cab!.indice + 3]!;
    expect(terceira[cab!.colunas.get("Data da agenda")!]).toBe("25/08/2026");
    expect(terceira[cab!.colunas.get("Data do atendimento")!]).toBe("28/08/2026");
  });

  it("lê o HTML disfarçado de .xls e chega no MESMO resultado do CSV", async () => {
    const html = `<table><tr>${COLUNAS.map((c) => `<th>${c}</th>`).join("")}</tr><tr>${LINHA.map((c) => `<td>${c}</td>`).join("")}</tr></table>`;
    const grade = await lerGrade(Buffer.from(html, "utf8"));
    expect(grade.formato).toBe("html");
    expect(grade.linhas[0]).toEqual([...COLUNAS]);
    expect(grade.linhas[1]).toEqual(LINHA);
  });

  it("recusa o .xls binário com a saída pronta, em vez de 'arquivo corrompido'", async () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    await expect(lerGrade(ole2)).rejects.toThrow(ErroDePlanilha);
    await expect(lerGrade(ole2)).rejects.toThrow(/Salvar como/i);
  });

  it("recusa arquivo vazio", async () => {
    await expect(lerGrade(Buffer.alloc(0))).rejects.toThrow(/vazio/i);
  });

  it("recusa xlsx danificado sem vazar o erro cru da biblioteca", async () => {
    // Assinatura de zip, conteúdo lixo — é o que chega quando o upload é truncado.
    const falso = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("lixo lixo lixo")]);
    await expect(lerGrade(falso)).rejects.toThrow(/planilha/i);
  });
});

describe("entidades acentuadas — nome de paciente e convênio dependem disto", () => {
  it("resolve as entidades nomeadas da faixa Latin-1", () => {
    const html = "<table><tr><td>CONCEI&Ccedil;&Atilde;O</td><td>&aacute;&eacute;&iacute;&oacute;&uacute;</td></tr></table>";
    expect(lerTabelaHtml(html)).toEqual([["CONCEIÇÃO", "áéíóú"]]);
  });

  it("respeita a CAIXA da entidade — &Aacute; é Á, não á", () => {
    expect(lerTabelaHtml("<table><tr><td>&Aacute;&aacute;</td></tr></table>")).toEqual([["Áá"]]);
  });

  it("entidade desconhecida volta crua em vez de sumir com o texto", () => {
    expect(lerTabelaHtml("<table><tr><td>a&naoexiste;b</td></tr></table>")).toEqual([["a&naoexiste;b"]]);
  });
});

/**
 * Monta um `.xlsx` mínimo em memória: um zip com uma única aba, guardada SEM compressão
 * (método 0), que é o suficiente para exercitar o leitor. Existe para testar os casos que uma
 * biblioteca de Excel não produz de propósito — célula omitida, `inlineStr`, linha pulada —
 * sem trazer dependência nenhuma para o projeto. O arquivo REAL é a fixture versionada.
 */
function montarXlsxDeTeste(sheetData: string): Buffer {
  const nome = "xl/worksheets/sheet1.xml";
  const conteudo = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetData}</worksheet>`,
    "utf8",
  );
  const nomeBytes = Buffer.from(nome, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // versão necessária
  local.writeUInt16LE(0, 8); // método 0 = guardado
  local.writeUInt32LE(0, 14); // CRC — o leitor não confere, e aqui não precisa
  local.writeUInt32LE(conteudo.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10); // método
  central.writeUInt32LE(0, 16); // CRC
  central.writeUInt32LE(conteudo.length, 20);
  central.writeUInt32LE(conteudo.length, 24);
  central.writeUInt16LE(nomeBytes.length, 28);
  central.writeUInt32LE(0, 42); // deslocamento do cabeçalho local

  const inicioCentral = local.length + nomeBytes.length + conteudo.length;
  const tamanhoCentral = central.length + nomeBytes.length;

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8); // entradas neste disco
  fim.writeUInt16LE(1, 10); // entradas no total
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(inicioCentral, 16);

  return Buffer.concat([local, nomeBytes, conteudo, central, nomeBytes, fim]);
}
