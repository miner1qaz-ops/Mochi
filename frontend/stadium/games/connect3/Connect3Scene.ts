import * as Phaser from "phaser";
import { Connect3Result } from "../types";
import { Connect3Options } from "./types";

type Gem = {
  color: number;
  icon: string;
  texture: string;
};

const GEMS: Gem[] = [
  { color: 0xf97316, icon: "🔥", texture: "charmander" },
  { color: 0x38bdf8, icon: "💧", texture: "squirtle" },
  { color: 0xfacc15, icon: "⚡", texture: "pikachu" },
  { color: 0x22c55e, icon: "🍃", texture: "bulbasaur" },
  { color: 0xa855f7, icon: "🌙", texture: "gengar" },
  { color: 0x60a5fa, icon: "❄️", texture: "mew" },
];

const BOARD_SIZE = 8;
const TILE_SIZE = 64;
const TILE_GAP = 6;
const DEFAULT_TIMER_MS = 60_000;

export class Connect3Scene extends Phaser.Scene {
  private sceneConfig: { onRoundEnd?: (result: Connect3Result) => void; timerMs: number };
  private board: Gem[][] = [];
  private selected: { x: number; y: number } | null = null;
  private score = 0;
  private botScore = 0;
  private remainingMs = DEFAULT_TIMER_MS;
  private roundActive = false;
  private movesMade = 0;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private botScoreText!: Phaser.GameObjects.Text;
  private startTime = 0;
  private botTimer?: Phaser.Time.TimerEvent;

  constructor(options?: Connect3Options) {
    super("Connect3Scene");
    this.sceneConfig = {
      onRoundEnd: options?.onRoundEnd,
      timerMs: options?.timerMs ?? DEFAULT_TIMER_MS,
    };
  }

  preload() {
    GEMS.forEach((g) => {
      if (!this.textures.exists(g.texture)) {
        this.load.image(g.texture, `/img/pokemon/${g.texture}.png`);
      }
    });
    this.createSparkTexture();
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060d");
    this.addTitle();
    this.initBoard();
    this.drawBoard();
    this.startRound();
  }

  update(_time: number, delta: number) {
    if (!this.roundActive) return;
    this.remainingMs = Math.max(0, this.remainingMs - delta);
    this.updateHud();
    if (this.remainingMs <= 0) {
      this.finishRound();
    }
  }

  private addTitle() {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, 18, "Connect-3 Duel", {
        fontSize: "26px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.add
      .text(centerX, 50, "Swap gems to make 3+. Bot accrues score over time.", {
        fontSize: "14px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#dbeafe",
      })
      .setOrigin(0.5, 0);

    this.scoreText = this.add.text(24, 20, "You: 0", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    });
    this.botScoreText = this.add.text(24, 46, "Bot: 0", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#cbd5e1",
    });
    this.timerText = this.add.text(this.scale.width - 24, 20, "Time: 60.0s", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    }).setOrigin(1, 0);
  }

  private initBoard() {
    this.board = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
      const row: Gem[] = [];
      for (let x = 0; x < BOARD_SIZE; x++) {
        row.push(this.randomGem());
      }
      this.board.push(row);
    }
  }

  private drawBoard() {
    // clear old
    this.children.list
      .filter((o: any) => o.getData && o.getData("gem"))
      .forEach((o: any) => o.destroy());

    const gridW = BOARD_SIZE * TILE_SIZE + (BOARD_SIZE - 1) * TILE_GAP;
    const gridH = BOARD_SIZE * TILE_SIZE + (BOARD_SIZE - 1) * TILE_GAP;
    const startX = this.scale.width / 2 - gridW / 2 + TILE_SIZE / 2;
    const startY = 140 + TILE_SIZE / 2;

    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const gem = this.board[y][x];
        const px = startX + x * (TILE_SIZE + TILE_GAP);
        const py = startY + y * (TILE_SIZE + TILE_GAP);
        const rect = this.add
          .rectangle(px, py, TILE_SIZE, TILE_SIZE, gem.color, 0.9)
          .setOrigin(0.5)
          .setStrokeStyle(2, this.isSelected(x, y) ? 0xffffff : 0x0f172a)
          .setInteractive({ useHandCursor: true })
          .setData("gem", true);
        this.add
          .image(px, py, gem.texture)
          .setDisplaySize(TILE_SIZE * 0.7, TILE_SIZE * 0.7)
          .setOrigin(0.5)
          .setData("gem", true);

        rect.on("pointerdown", () => this.handleGemClick(x, y));
      }
    }
  }

  private handleGemClick(x: number, y: number) {
    if (!this.roundActive) return;
    if (!this.selected) {
      this.selected = { x, y };
      this.drawBoard();
      return;
    }
    const { x: sx, y: sy } = this.selected;
    const isAdjacent = Math.abs(sx - x) + Math.abs(sy - y) === 1;
    if (!isAdjacent) {
      this.selected = { x, y };
      this.drawBoard();
      return;
    }
    this.movesMade += 1;
    this.swap(sx, sy, x, y);
    this.selected = null;
    this.resolveMatches(() => this.drawBoard(), { revertIfNoMatch: true, a: { x: sx, y: sy }, b: { x, y } });
  }

  private swap(ax: number, ay: number, bx: number, by: number) {
    const temp = this.board[ay][ax];
    this.board[ay][ax] = this.board[by][bx];
    this.board[by][bx] = temp;
  }

  private resolveMatches(onComplete?: () => void, opts?: { revertIfNoMatch?: boolean; a?: { x: number; y: number }; b?: { x: number; y: number } }) {
    const matches = this.findMatches();
    if (matches.length === 0) {
      if (opts?.revertIfNoMatch && opts.a && opts.b) {
        this.swap(opts.a.x, opts.a.y, opts.b.x, opts.b.y);
      }
      onComplete?.();
      return;
    }
    matches.forEach(({ x, y }) => {
      const { px, py } = this.cellToWorld(x, y);
      const emitterManager: any = this.add.particles(0, 0, "hit-spark");
      const emitter = emitterManager.createEmitter({
        speed: { min: 120, max: 200 },
        angle: { min: 0, max: 360 },
        lifespan: 400,
        quantity: 10,
        scale: { start: 0.7, end: 0 },
        tint: 0xfacc15,
        blendMode: "ADD",
        gravityY: 200,
      });
      emitter.explode(12, px, py);
      this.time.delayedCall(420, () => emitterManager.destroy());
      this.board[y][x] = null as any;
      this.score += 10;
    });
    this.applyGravity();
    this.time.delayedCall(120, () => this.resolveMatches(onComplete));
    this.updateHud();
  }

  private findMatches() {
    const hits: { x: number; y: number }[] = [];
    // rows
    for (let y = 0; y < BOARD_SIZE; y++) {
      let run = 1;
      for (let x = 1; x <= BOARD_SIZE; x++) {
        const same =
          x < BOARD_SIZE &&
          this.board[y][x] &&
          this.board[y][x - 1] &&
          this.board[y][x].icon === this.board[y][x - 1].icon;
        if (same) {
          run += 1;
        } else {
          if (run >= 3) {
            for (let k = x - run; k < x; k++) hits.push({ x: k, y });
          }
          run = 1;
        }
      }
    }
    // cols
    for (let x = 0; x < BOARD_SIZE; x++) {
      let run = 1;
      for (let y = 1; y <= BOARD_SIZE; y++) {
        const same =
          y < BOARD_SIZE &&
          this.board[y][x] &&
          this.board[y - 1][x] &&
          this.board[y][x].icon === this.board[y - 1][x].icon;
        if (same) run += 1;
        else {
          if (run >= 3) {
            for (let k = y - run; k < y; k++) hits.push({ x, y: k });
          }
          run = 1;
        }
      }
    }
    return hits;
  }

  private applyGravity() {
    for (let x = 0; x < BOARD_SIZE; x++) {
      for (let y = BOARD_SIZE - 1; y >= 0; y--) {
        if (!this.board[y][x]) {
          // find above
          for (let k = y - 1; k >= 0; k--) {
            if (this.board[k][x]) {
              this.board[y][x] = this.board[k][x];
              this.board[k][x] = null as any;
              break;
            }
          }
          if (!this.board[y][x]) {
            this.board[y][x] = this.randomGem();
          }
        }
      }
    }
  }

  private isSelected(x: number, y: number) {
    return this.selected && this.selected.x === x && this.selected.y === y;
  }

  private randomGem(): Gem {
    return Phaser.Utils.Array.GetRandom(GEMS);
  }

  private cellToWorld(x: number, y: number) {
    const gridW = BOARD_SIZE * TILE_SIZE + (BOARD_SIZE - 1) * TILE_GAP;
    const startX = this.scale.width / 2 - gridW / 2 + TILE_SIZE / 2;
    const startY = 140 + TILE_SIZE / 2;
    const px = startX + x * (TILE_SIZE + TILE_GAP);
    const py = startY + y * (TILE_SIZE + TILE_GAP);
    return { px, py };
  }

  private startRound() {
    this.roundActive = true;
    this.score = 0;
    this.botScore = 0;
    this.remainingMs = this.sceneConfig.timerMs;
    this.movesMade = 0;
    this.startTime = this.time.now;
    this.selected = null;
    this.updateHud();
    // Clear any accidental pre-matches before play begins.
    this.resolveMatches(() => this.drawBoard());
    this.startBot();
  }

  private startBot() {
    this.botTimer?.remove(false);
    this.botTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.roundActive) return;
        const gain = Phaser.Math.Between(8, 18);
        this.botScore += gain;
        this.updateHud();
      },
    });
  }

  private updateHud() {
    this.scoreText.setText(`You: ${this.score}`);
    this.botScoreText.setText(`Bot: ${this.botScore}`);
    this.timerText.setText(`Time: ${(this.remainingMs / 1000).toFixed(1)}s`);
  }

  private finishRound() {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.botTimer?.remove(false);
    let winner: Connect3Result["winner"] = "draw";
    if (this.score > this.botScore) winner = "player";
    else if (this.botScore > this.score) winner = "bot";

    const result: Connect3Result = {
      finalScore: this.score,
      durationMs: this.sceneConfig.timerMs,
      winner,
      summary: winner === "draw" ? "Draw" : winner === "player" ? "You outscored the bot" : "Bot wins on score",
      playerScore: this.score,
      botScore: this.botScore,
      movesMade: this.movesMade,
    };
    this.sceneConfig.onRoundEnd?.(result);
    this.showEndPanel(result);
  }

  private showEndPanel(result: Connect3Result) {
    const panelWidth = 460;
    const panelHeight = 220;
    const panel = this.add.container(this.scale.width / 2, this.scale.height / 2 + 10);
    const bg = this.add
      .rectangle(0, 0, panelWidth, panelHeight, 0x0b1222, 0.95)
      .setStrokeStyle(2, 0x38bdf8)
      .setOrigin(0.5);
    const title = this.add
      .text(0, -panelHeight / 2 + 24, "Round Complete", {
        fontSize: "20px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);

    const summary = this.add
      .text(0, -6, result.summary ?? "Finished", {
        fontSize: "17px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#e0f2fe",
      })
      .setOrigin(0.5);

    const scoreLine = this.add
      .text(0, 26, `You ${result.playerScore} — Bot ${result.botScore}`, {
        fontSize: "16px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#cbd5e1",
      })
      .setOrigin(0.5);

    const buttonY = panelHeight / 2 - 46;
    const button = this.add
      .rectangle(0, buttonY, 170, 48, 0x38bdf8, 1)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive({ useHandCursor: true });
    const buttonLabel = this.add
      .text(0, buttonY, "Play Again", {
        fontSize: "17px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#0b1222",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    button.on("pointerdown", () => {
      panel.destroy();
      this.initBoard();
      this.drawBoard();
      this.startRound();
    });

    panel.add([bg, title, summary, scoreLine, button, buttonLabel]);
  }

  private createSparkTexture() {
    if (this.textures.exists("hit-spark")) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture("hit-spark", 16, 16);
    g.destroy();
  }
}
