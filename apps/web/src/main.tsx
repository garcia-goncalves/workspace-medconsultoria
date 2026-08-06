import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "./lib/trpc";
import { App } from "./App";
import { Toaster, toast } from "./components/ui/toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SeloAmbienteLocal } from "./components/SeloAmbienteLocal";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  // Rede de segurança: qualquer mutação que NÃO trate o próprio erro mostra um toast,
  // em vez de falhar em silêncio (ex.: mover card, remover, converter, concluir passo).
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return; // a mutação já dá feedback próprio
      toast(err instanceof Error ? err.message : "Não foi possível concluir a ação. Tente novamente.");
    },
  }),
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      transformer: superjson,
      // Divide lotes grandes em vários GETs em vez de estourar o limite de URL (evita 414).
      maxURLLength: 2048,
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
          <Toaster />
          {/* Fora do <App> de propósito: aparece também no login e no Portal, e não
              depende de haver sessão para avisar que a máquina é a de ensaio. */}
          <SeloAmbienteLocal />
        </QueryClientProvider>
      </trpc.Provider>
    </ErrorBoundary>
  </React.StrictMode>,
);
