import { useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Type } from "lucide-react";
import { cn } from "@app/ui";

export interface AssinaturaValor {
  metodo: "DESENHO" | "DIGITADO";
  imagem?: string;
  nomeDigitado?: string;
}

/** Captura de assinatura: desenhar no canvas OU digitar o nome. */
export function SignaturePad({ onChange }: { onChange: (v: AssinaturaValor) => void }) {
  const [modo, setModo] = useState<"DESENHO" | "DIGITADO">("DESENHO");
  const [nome, setNome] = useState("");
  const [temTraco, setTemTraco] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f2540";
  }, [modo]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };

  const inicio = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current!.getContext("2d")!;
    desenhando.current = true;
    const p = ponto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = ponto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!temTraco) setTemTraco(true);
  };
  const fim = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    onChange({ metodo: "DESENHO", imagem: canvasRef.current!.toDataURL("image/png") });
  };
  const limpar = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setTemTraco(false);
    onChange({ metodo: "DESENHO", imagem: undefined });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => setModo("DESENHO")}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors",
            modo === "DESENHO" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Pencil className="h-3.5 w-3.5" /> Desenhar
        </button>
        <button
          type="button"
          onClick={() => {
            setModo("DIGITADO");
            onChange({ metodo: "DIGITADO", nomeDigitado: nome });
          }}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors",
            modo === "DIGITADO" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Type className="h-3.5 w-3.5" /> Digitar
        </button>
      </div>

      {modo === "DESENHO" ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={520}
            height={180}
            onPointerDown={inicio}
            onPointerMove={mover}
            onPointerUp={fim}
            onPointerLeave={fim}
            className="w-full touch-none rounded-lg border bg-white"
            style={{ height: 180 }}
          />
          {!temTraco && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Assine aqui com o dedo ou o mouse
            </span>
          )}
          {temTraco && (
            <button
              type="button"
              onClick={limpar}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Eraser className="h-3.5 w-3.5" /> Limpar
            </button>
          )}
        </div>
      ) : (
        <div>
          <input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              onChange({ metodo: "DIGITADO", nomeDigitado: e.target.value });
            }}
            placeholder="Digite seu nome completo"
            className="h-11 w-full rounded-lg border bg-white px-3 text-2xl outline-none focus:border-primary"
            style={{ fontFamily: "'Segoe Script', 'Bradley Hand', cursive" }}
          />
          <p className="mt-1 text-xs text-muted-foreground">Sua assinatura será registrada com este nome.</p>
        </div>
      )}
    </div>
  );
}
