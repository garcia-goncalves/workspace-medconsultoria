import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Portas configuráveis para permitir uma 2ª instância isolada (E2E em banco próprio)
// rodando em paralelo com o dev de sempre. Sem env, o comportamento é o de antes.
const WEB_PORT = Number(process.env.WEB_PORT ?? 4310);
const API_ALVO = `http://localhost:${process.env.API_PORT ?? 4319}`;

export default defineConfig({
  plugins: [react()],
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
