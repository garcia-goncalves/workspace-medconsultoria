import { describe, it, expect, afterAll } from "vitest";
import { sep } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, utimes, rm, readdir } from "node:fs/promises";
import { TAMANHO_MAX } from "../lib/storage.js";
import {
  pastaTemp,
  caminhoTemp,
  anexoTempVencido,
  limparAnexosTempOrfaos,
  cabeMaisUmAnexoTemp,
  usoPastaTemp,
  PRAZO_ANEXO_TEMP_MS,
  COTA_ANEXO_TEMP_BYTES,
} from "./email-anexo.js";

describe("caminhoTemp (defesa contra travessia de caminho)", () => {
  const userId = "cku1abc123xyz";
  const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

  it("aceita um UUID válido e devolve caminho dentro da pasta temp do usuário", () => {
    const caminho = caminhoTemp(userId, uuid);
    expect(caminho.startsWith(pastaTemp(userId) + sep)).toBe(true);
    expect(caminho.endsWith(uuid)).toBe(true);
  });

  it("aceita UUID em maiúsculas (o formato de UUID gerado por randomUUID é sempre minúsculo, mas o formato em si não é sensível a caixa)", () => {
    expect(() => caminhoTemp(userId, uuid.toUpperCase())).not.toThrow();
  });

  it("recusa id vazio", () => {
    expect(() => caminhoTemp(userId, "")).toThrow(/inválido/i);
  });

  it("recusa travessia de caminho (../../etc/passwd)", () => {
    expect(() => caminhoTemp(userId, "../../../../etc/passwd")).toThrow(/inválido/i);
  });

  it("recusa id com barra", () => {
    expect(() => caminhoTemp(userId, "../outro-usuario/segredo")).toThrow(/inválido/i);
  });

  it("recusa id com ponto (não é hex nem hífen)", () => {
    expect(() => caminhoTemp(userId, "3fa85f64-5717-4562-b3fc-2c963f66afa.")).toThrow(/inválido/i);
  });

  it("recusa id curto demais ou longo demais", () => {
    expect(() => caminhoTemp(userId, "abc")).toThrow(/inválido/i);
    expect(() => caminhoTemp(userId, uuid + "a")).toThrow(/inválido/i);
  });

  it("o caminho resolvido nunca escapa da pasta temp do usuário, mesmo com id válido", () => {
    // Defesa em profundidade: mesmo que o regex de formato mude no futuro, o prefixo
    // resolvido tem de ficar sempre dentro de `pastaTemp(userId)`.
    const caminho = caminhoTemp(userId, uuid);
    const raiz = pastaTemp(userId);
    expect(caminho === raiz || caminho.startsWith(raiz + sep)).toBe(true);
  });
});

// Achado A da rodada de correção 1: anexo removido da lista / compose cancelado / aba fechada
// não passam pelo `finally` de `enviarMensagem` — só a varredura por mtime limpa esses casos.
describe("anexoTempVencido (decide sem relógio real)", () => {
  it("arquivo mais novo que o prazo não venceu", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - 1_000, agora, PRAZO_ANEXO_TEMP_MS)).toBe(false);
  });

  it("arquivo mais velho que o prazo venceu", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS - 1, agora, PRAZO_ANEXO_TEMP_MS)).toBe(true);
  });

  it("arquivo exatamente no limite do prazo ainda não venceu (limite exclusivo)", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS, agora, PRAZO_ANEXO_TEMP_MS)).toBe(false);
  });

  it("usa 24h como prazo padrão quando não informado", () => {
    expect(PRAZO_ANEXO_TEMP_MS).toBe(24 * 60 * 60 * 1000);
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - 1_000, agora)).toBe(false);
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS - 1_000, agora)).toBe(true);
  });
});

// Achado B1 da revisão de segurança: `POST /email-anexo` gravava até 20 MB por requisição sem
// somar NADA antes. Dentro do rate limit global (300 req/min), uma sessão de funcionário enche o
// disco muito antes de a varredura de órfãos (24 h de prazo, de hora em hora) tocar em algo — e,
// em hospedagem compartilhada, disco cheio derruba a app inteira, não só o e-mail.
describe("cota de disco dos anexos temporários, por pessoa", () => {
  const userId = `teste-cota-anexos-${randomUUID()}`;

  afterAll(async () => {
    await rm(pastaTemp(userId), { recursive: true, force: true });
  });

  it("deixa passar quem ainda não tem nada gravado", () => {
    expect(cabeMaisUmAnexoTemp(0)).toBe(true);
  });

  it("recusa mais um anexo quando o que já está gravado não deixa espaço para outro arquivo do tamanho máximo", () => {
    // Pessimista de propósito: o tamanho do arquivo que está chegando só seria conhecido DEPOIS
    // de gravá-lo — que é exatamente o que a cota existe para evitar.
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES - TAMANHO_MAX)).toBe(true);
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES - TAMANHO_MAX + 1)).toBe(false);
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES)).toBe(false);
  });

  it("a cota é por pessoa e cabe folgadamente um envio inteiro (25 MB do teto agregado)", () => {
    expect(COTA_ANEXO_TEMP_BYTES).toBe(200 * 1024 * 1024);
    expect(cabeMaisUmAnexoTemp(25 * 1024 * 1024)).toBe(true);
  });

  it("usoPastaTemp devolve 0 quando a pessoa nunca anexou nada (pasta inexistente)", async () => {
    await expect(usoPastaTemp(`nunca-existiu-${randomUUID()}`)).resolves.toBe(0);
  });

  it("usoPastaTemp soma o tamanho real dos anexos já gravados da própria pessoa", async () => {
    await mkdir(pastaTemp(userId), { recursive: true });
    await writeFile(caminhoTemp(userId, randomUUID()), Buffer.alloc(3_000));
    await writeFile(caminhoTemp(userId, randomUUID()), Buffer.alloc(1_000));
    await expect(usoPastaTemp(userId)).resolves.toBe(4_000);
  });

  it("o upload seguinte é recusado quando a soma do que já está em disco estoura a cota", async () => {
    // Regressão do defeito em si, com os limites parametrizados para não escrever 200 MB no
    // disco só para provar a soma: 4 KB gravados, teto de 1 KB por arquivo, cota de 4 KB.
    const usados = await usoPastaTemp(userId);
    expect(usados).toBe(4_000);
    expect(cabeMaisUmAnexoTemp(usados, 1_000, 4_000)).toBe(false);
    expect(cabeMaisUmAnexoTemp(usados, 1_000, 8_000)).toBe(true);
  });
});

describe("limparAnexosTempOrfaos (varredura real em disco, por mtime)", () => {
  const userId = `teste-limpeza-anexos-${randomUUID()}`;

  afterAll(async () => {
    await rm(pastaTemp(userId), { recursive: true, force: true });
  });

  it("não lança quando a pasta email-tmp ainda não existe (instalação sem nenhum anexo)", async () => {
    await expect(limparAnexosTempOrfaos()).resolves.toBeUndefined();
  });

  it("apaga só o anexo mais velho que o prazo, mantendo o recente e ignorando nome fora do formato", async () => {
    const velhoId = randomUUID();
    const novoId = randomUUID();
    await mkdir(pastaTemp(userId), { recursive: true });
    await writeFile(caminhoTemp(userId, velhoId), "conteudo velho");
    await writeFile(caminhoTemp(userId, novoId), "conteudo novo");
    // Nome que não é UUID: a varredura tem de ignorar (não é um anexo temporário nosso).
    await writeFile(`${pastaTemp(userId)}${sep}nao-e-um-anexo.txt`, "estranho");

    // Backdata o mtime do "velho" para além do prazo, sem precisar mockar o relógio.
    const passado = new Date(Date.now() - PRAZO_ANEXO_TEMP_MS - 60_000);
    await utimes(caminhoTemp(userId, velhoId), passado, passado);

    await limparAnexosTempOrfaos();

    const restantes = await readdir(pastaTemp(userId));
    expect(restantes).toContain(novoId);
    expect(restantes).toContain("nao-e-um-anexo.txt");
    expect(restantes).not.toContain(velhoId);
  });
});
