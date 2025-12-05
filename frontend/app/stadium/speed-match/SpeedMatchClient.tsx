"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { SpeedMatchResult } from "../../../stadium/games/types";

const LazyCreateGame = async (parent: HTMLElement, onRoundEnd: (r: SpeedMatchResult) => void) => {
  const mod = await import("../../../stadium/games/speedMatch/createSpeedMatchGame");
  const game = mod.default({
    parent,
    width: 800,
    height: 600,
    onRoundEnd,
  });
  return game;
};

export default function SpeedMatchClient() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [result, setResult] = useState<SpeedMatchResult | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    let destroyed = false;
    LazyCreateGame(containerRef.current, (r) => setResult(r)).then((game) => {
      if (destroyed) {
        game.destroy(true);
        return;
      }
      gameRef.current = game;
    });
    return () => {
      destroyed = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-white/60">Stadium | Bot match</p>
          <h1 className="text-3xl font-semibold text-white">Speed Match</h1>
          <p className="mt-2 text-sm text-white/70">Find target icons. You vs bot. +10 hit, -5 miss. 30s timer.</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm text-white">
          <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70">Connected as 0xDEMO…</span>
          <Link href="/stadium" className="rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] hover:bg-white hover:text-black">
            Back to Mochi Stadium
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
          <div className="mx-auto w-full max-w-[840px] rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-2">
            <div className="aspect-[4/3] w-full rounded-xl bg-black/60">
              <div ref={containerRef} className="h-full w-full overflow-hidden rounded-xl" />
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-white/60">
            Phaser canvas is capped near 800x600 and scales inside the frame.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/40 p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-white/50">Round result</p>
              <h3 className="text-xl font-semibold">Latest score</h3>
            </div>
            <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70">
              +10 hit / -5 miss | 30s
            </span>
          </div>

          {result ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-3xl font-semibold text-white">{result.summary ?? ""}</div>
              <div className="text-sm text-white/70">You {result.playerScore} — Bot {result.botScore}</div>
              <div className="text-xs text-white/60">
                Hits {result.correctClicks} · Misses {result.wrongClicks} · {result.durationMs / 1000}s
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-white/60">
              Play a round to see the outcome.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
