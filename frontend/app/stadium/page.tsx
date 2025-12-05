import Link from "next/link";

const games = [
  {
    slug: "speed-match",
    title: "Speed Match",
    description: "Find the target icon faster than the bot in a 30s sprint.",
    pill: "+10 / -5 scoring",
  },
  {
    slug: "memory-duel",
    title: "Memory Duel",
    description: "Flip pairs, remember what you saw, outmatch the bot’s memory.",
    pill: "Pairs race",
  },
  {
    slug: "tactics-lite",
    title: "Tactics Lite",
    description: "5x5 grid skirmish, move + strike with a 3-unit squad.",
    pill: "Turn-based",
  },
  {
    slug: "connect-3",
    title: "Connect-3 Duel",
    description: "Swap gems to clear lines; bot gains score over time.",
    pill: "60s timer",
  },
  {
    slug: "rps-plus",
    title: "RPS+",
    description: "5-move rock–paper–scissors with light bot adaptation.",
    pill: "Bo5",
  },
];

export default function StadiumPage() {
  return (
    <div className="space-y-10">
      <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
        <p className="text-xs uppercase tracking-[0.35em] text-white/60">Mochi Stadium</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">Pick a mini-game, battle the bot.</h1>
        <p className="mt-3 max-w-3xl text-sm text-white/70">
          Local-only prototypes of the upcoming 1v1 arena. No wallet required yet—just click play, and each game runs a bot opponent.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <div
            key={game.slug}
            className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.4)] transition hover:-translate-y-1 hover:border-white/30"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">{game.title}</p>
                <p className="mt-2 text-sm text-white/75">{game.description}</p>
              </div>
              <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70">
                {game.pill}
              </span>
            </div>
            <Link
              href={`/stadium/${game.slug}`}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition group-hover:bg-white group-hover:text-black"
            >
              Play vs Bot <span aria-hidden>↗</span>
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}
