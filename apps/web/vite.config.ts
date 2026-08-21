import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Portas configuráveis para permitir uma 2ª instância isolada (E2E em banco próprio)
// rodando em paralelo com o dev de sempre. Sem env, o comportamento é o de antes.
const WEB_PORT = Number(process.env.WEB_PORT ?? 4310);
const API_ALVO = `http://localhost:${process.env.API_PORT ?? 4319}`;

/**
 * Separa BIBLIOTECA de CÓDIGO DA APP nos pedaços do build.
 *
 * Não reduz o total baixado no primeiro acesso — reduz o das VEZES SEGUINTES, que é o que
 * importa aqui: este é um sistema interno que a mesma pessoa abre todo dia, e publicamos com
 * frequência. Sem esta divisão, cada publicação trocava o hash de um pedaço único de ~690 kB e
 * o navegador rebaixava tudo, inclusive React e roteador, que não mudaram. Com ela, a
 * publicação invalida só o pedaço da app.
 *
 * Agrupado por RITMO DE MUDANÇA, não por tamanho: o que quase nunca muda fica junto.
 */
function pedacoDeBiblioteca(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  // Sem regex de propósito: escapar barra dentro de classe de caractere já rendeu erro de lint
  // aqui. O caminho vem com barra invertida no Windows, então normaliza antes de comparar.
  const caminho = id.split("\\").join("/");
  if (caminho.includes("/react/") || caminho.includes("/react-dom/") || caminho.includes("/scheduler/")) return "react";
  if (id.includes("@tanstack")) return "tanstack";
  if (id.includes("@trpc") || id.includes("superjson")) return "trpc";
  // Todo o RESTO fica com o Rollup. Agrupar mais que isto PIOROU o primeiro acesso: medido em
  // 19/08/2026, um agrupamento amplo (formulários, ícones, um "biblioteca" genérico) içou para o
  // carregamento inicial código que o Rollup mantinha dentro das páginas sob demanda — 690 kB
  // viraram 776 kB. Estes três são diferentes: são sempre necessários E quase nunca mudam.
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: pedacoDeBiblioteca } },
  },
  server: {
    port: WEB_PORT,
    // Proxy do tRPC e Socket.IO para a API em dev (evita CORS e mantém cookie same-origin).
    proxy: {
      "/trpc": { target: API_ALVO, changeOrigin: true },
      "/socket.io": { target: API_ALVO, ws: true, changeOrigin: true },
      "/upload": { target: API_ALVO, changeOrigin: true },
      "/avatar": { target: API_ALVO, changeOrigin: true },
      "/transcrever": { target: API_ALVO, changeOrigin: true },
      "/arquivos": { target: API_ALVO, changeOrigin: true },
      "/email-corpo": { target: API_ALVO, changeOrigin: true },
      "/email-anexo": { target: API_ALVO, changeOrigin: true },
    },
  },
});
