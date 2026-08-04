import preset from "@app/ui/tailwind-preset";
import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    // inclui componentes do design system compartilhado
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /**
       * Degraus de ALTURA de tela (o Tailwind só traz breakpoints de largura).
       * Servem à barra lateral, que precisa caber sem rolar em qualquer monitor (ADR-94).
       *
       * A ORDEM aqui importa e não é decorativa: as três regras têm a mesma especificidade,
       * então vence a última emitida. Declaradas do maior para o menor, a tela mais baixa
       * ganha — que é o que se quer. Escrever `[@media(max-height:…)]` direto na classe NÃO
       * funciona: o Tailwind emite essas em ordem crescente e a de 940px atropelava as outras.
       */
      screens: {
        alt: { raw: "(max-height: 940px)" },
        "alt-sm": { raw: "(max-height: 820px)" },
        "alt-xs": { raw: "(max-height: 740px)" },
      },
    },
  },
  plugins: [animate],
};
