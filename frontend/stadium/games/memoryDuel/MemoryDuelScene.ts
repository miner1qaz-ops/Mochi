import * as Phaser from "phaser";
import { MemoryDuelResult } from "../types";
import { MemoryDuelOptions } from "./types";

interface MemoryCard {
  id: number;
  icon: string;
  matched: boolean;
  revealed: boolean;
  owner?: "player" | "bot";
  rect?: Phaser.GameObjects.Rectangle;
  label?: Phaser.GameObjects.Text;
  backImg?: Phaser.GameObjects.Image;
  frontImg?: Phaser.GameObjects.Image;
  rectScaleX?: number;
  backScaleX?: number;
  frontScaleX?: number;
}

const ICONS = [
  "bulbasaur",
  "charmander",
  "squirtle",
  "pikachu",
  "eevee",
  "gengar",
  "mew",
  "dragonite",
];

export class MemoryDuelScene extends Phaser.Scene {
  private sceneConfig: {
    cols: number;
    rows: number;
    flipDelayMs: number;
    onRoundEnd?: (result: MemoryDuelResult) => void;
  };

  private cards: MemoryCard[] = [];
  private revealedIndices: number[] = [];
  private currentTurn: "player" | "bot" = "player";
  private playerPairs = 0;
  private botPairs = 0;
  private roundActive = false;
  private startTime = 0;
  private botMemory = new Map<string, number[]>();
  private turnText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  private flipSfx =
    "data:audio/wav;base64,UklGRhQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQgAAAABAQEBAgICAwMDAwMDAQEBAQEBAQE="; // tiny click
  private matchSfx =
    "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQwAAAABAQECAwMEBAQEBAMDAgIB"; // short blip

  constructor(options?: MemoryDuelOptions) {
    super("MemoryDuelScene");
    const rows = options?.rows && options.rows > 1 ? options.rows : 4;
    const cols = options?.cols && options.cols > 1 ? options.cols : 4;
    const flipDelayMs = options?.flipDelayMs ?? 650;
    this.sceneConfig = {
      cols,
      rows,
      flipDelayMs,
      onRoundEnd: options?.onRoundEnd,
    };
  }

  preload() {
    ICONS.forEach((key) => {
      if (!this.textures.exists(key)) {
        this.load.image(key, `/img/pokemon/${key}.png`);
      }
    });
    this.load.image("card-back", "/card_back.png");
    this.createSparkTexture();
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060d");
    this.addTitle();
    this.setupBoard();
    this.startRound();
  }

  private addTitle() {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, 12, "Memory Duel", {
        fontSize: "26px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.add
      .text(centerX, 42, "Flip pairs. Match to score. Bot remembers seen cards.", {
        fontSize: "14px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#dbeafe",
      })
      .setOrigin(0.5, 0);

    this.turnText = this.add.text(24, 20, "Turn: You", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    });
    this.scoreText = this.add.text(this.scale.width - 24, 20, "You 0 | Bot 0", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    }).setOrigin(1, 0);
  }

  private setupBoard() {
    const totalCards = this.sceneConfig.cols * this.sceneConfig.rows;
    const pairsNeeded = totalCards / 2;
    const palette = Phaser.Utils.Array.Shuffle([...ICONS]).slice(0, pairsNeeded);
    const deck: MemoryCard[] = [];
    palette.forEach((icon, idx) => {
      deck.push({ id: idx * 2, icon, matched: false, revealed: false });
      deck.push({ id: idx * 2 + 1, icon, matched: false, revealed: false });
    });
    Phaser.Utils.Array.Shuffle(deck);
    this.cards = deck;

    const cardW = 96;
    const cardH = 120;
    const gap = 14;
    const gridW = this.sceneConfig.cols * cardW + (this.sceneConfig.cols - 1) * gap;
    const gridH = this.sceneConfig.rows * cardH + (this.sceneConfig.rows - 1) * gap;
    const startX = this.scale.width / 2 - gridW / 2 + cardW / 2;
    const startY = 130 + cardH / 2;

    this.cards.forEach((card, index) => {
      const col = index % this.sceneConfig.cols;
      const row = Math.floor(index / this.sceneConfig.cols);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);

      const rect = this.add
        .rectangle(x, y, cardW, cardH, 0x0b1222, 1)
        .setStrokeStyle(2, 0x1f2937)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      const back = this.add
        .image(x, y, "card-back")
        .setDisplaySize(cardW, cardH)
        .setOrigin(0.5);

      const front = this.add
        .image(x, y, card.icon)
        .setDisplaySize(cardW * 0.55, cardH * 0.55)
        .setOrigin(0.5)
        .setAlpha(0);

      rect.on("pointerdown", () => this.handleCardClick(index));
      card.rect = rect;
      card.backImg = back;
      card.frontImg = front;
      card.rectScaleX = rect.scaleX;
      card.backScaleX = back.scaleX;
      card.frontScaleX = front.scaleX;
      back.setData("card-back", true);
      front.setData("card-front", true);
    });
  }

  private startRound() {
    this.roundActive = true;
    this.playerPairs = 0;
    this.botPairs = 0;
    this.currentTurn = "player";
    this.revealedIndices = [];
    this.botMemory.clear();
    this.startTime = this.time.now;
    this.turnText.setText("Turn: You");
    this.scoreText.setText("You 0 | Bot 0");
  }

  private handleCardClick(index: number) {
    if (!this.roundActive || this.currentTurn !== "player") return;
    this.revealCard(index, "player");
    this.evaluateAfterReveal();
  }

  private revealCard(index: number, owner: "player" | "bot") {
    const card = this.cards[index];
    if (card.matched || card.revealed) return;
    card.revealed = true;
    card.owner = owner;
    this.tweens.add({
      targets: [card.rect, card.frontImg, card.backImg],
      scaleX: 0,
      duration: 110,
      ease: "Quad.easeIn",
      onComplete: () => {
        card.rect?.setFillStyle(0x1f2937).setStrokeStyle(2, owner === "player" ? 0x38bdf8 : 0xf97316);
        card.frontImg?.setAlpha(1);
        card.backImg?.setAlpha(0);
        this.tweens.add({
          targets: [card.rect, card.frontImg],
          scaleX: (target: any) => {
            if (target === card.rect) return card.rectScaleX ?? 1;
            if (target === card.frontImg) return card.frontScaleX ?? 1;
            return 1;
          },
          duration: 140,
          ease: "Quad.easeOut",
        });
      },
    });
    this.playFlipSfx();

    const seen = this.botMemory.get(card.icon) ?? [];
    if (!seen.includes(index)) {
      this.botMemory.set(card.icon, [...seen, index]);
    }

    this.revealedIndices.push(index);
  }

  private concealCards(indices: number[]) {
    indices.forEach((idx) => {
      const card = this.cards[idx];
      if (card.matched) return;
      card.revealed = false;
      card.owner = undefined;
      this.tweens.add({
        targets: [card.rect, card.frontImg, card.backImg],
        scaleX: 0,
        duration: 90,
        ease: "Quad.easeIn",
        onComplete: () => {
          card.rect?.setFillStyle(0x0f172a).setStrokeStyle(2, 0x1f2937);
          card.frontImg?.setAlpha(0);
          card.backImg?.setAlpha(1);
          this.tweens.add({
            targets: [card.rect, card.frontImg, card.backImg],
            scaleX: (target: any) => {
              if (target === card.rect) return card.rectScaleX ?? 1;
              if (target === card.frontImg) return card.frontScaleX ?? 1;
              if (target === card.backImg) return card.backScaleX ?? 1;
              return 1;
            },
            duration: 110,
            ease: "Quad.easeOut",
          });
        },
      });
    });
  }

  private evaluateAfterReveal() {
    if (this.revealedIndices.length < 2) return;
    const [aIdx, bIdx] = this.revealedIndices.slice(-2);
    const a = this.cards[aIdx];
    const b = this.cards[bIdx];
    const isMatch = a.icon === b.icon;

    if (isMatch) {
      a.matched = true;
      b.matched = true;
      if (this.currentTurn === "player") this.playerPairs += 1;
      else this.botPairs += 1;
      this.popMatch([aIdx, bIdx]);
      this.scoreText.setText(`You ${this.playerPairs} | Bot ${this.botPairs}`);
      if (this.allMatched()) {
        this.finishRound();
        return;
      }
      // Same turn continues
      this.revealedIndices = [];
      if (this.currentTurn === "bot") {
        this.time.delayedCall(350, () => this.botTakeTurn());
      }
    } else {
      this.roundActive = false; // prevent extra clicks during flip-back
      this.time.delayedCall(this.sceneConfig.flipDelayMs, () => {
        this.concealCards([aIdx, bIdx]);
        this.revealedIndices = [];
        this.switchTurn();
        this.roundActive = true;
        if (this.currentTurn === "bot") {
          this.botTakeTurn();
        }
      });
    }
  }

  private switchTurn() {
    this.currentTurn = this.currentTurn === "player" ? "bot" : "player";
    this.turnText.setText(this.currentTurn === "player" ? "Turn: You" : "Turn: Bot");
  }

  private allMatched() {
    return this.cards.every((c) => c.matched);
  }

  private botTakeTurn() {
    if (!this.roundActive || !this.roundActive && this.allMatched()) return;
    if (this.currentTurn !== "bot") return;

    const choosePair = (): number[] | null => {
      const entries = Array.from(this.botMemory.entries());
      for (const [icon, indices] of entries) {
        const unmatched = indices.filter((i) => !this.cards[i].matched && !this.cards[i].revealed);
        if (unmatched.length >= 2) {
          return unmatched.slice(0, 2);
        }
      }
      return null;
    };

    const chooseRandomUnknown = () => {
      const unknown = this.cards
        .map((c, idx) => ({ c, idx }))
        .filter(({ c }) => !c.matched && !c.revealed);
      Phaser.Utils.Array.Shuffle(unknown);
      return unknown.slice(0, 2).map((u) => u.idx);
    };

    const picks = choosePair() ?? chooseRandomUnknown();
    if (picks.length >= 1) {
      this.time.delayedCall(400, () => {
        this.revealCard(picks[0], "bot");
        this.evaluateAfterReveal();
      });
    }
    if (picks.length >= 2) {
      this.time.delayedCall(900, () => {
        this.revealCard(picks[1], "bot");
        this.evaluateAfterReveal();
      });
    }
  }

  private finishRound() {
    this.roundActive = false;
    const totalPairs = this.cards.length / 2;
    let winner: MemoryDuelResult["winner"] = "draw";
    if (this.playerPairs > this.botPairs) winner = "player";
    else if (this.botPairs > this.playerPairs) winner = "bot";

    const durationMs = this.time.now - this.startTime;
    const result: MemoryDuelResult = {
      finalScore: this.playerPairs,
      durationMs,
      winner,
      summary: winner === "draw" ? "Draw" : winner === "player" ? "You won the duel" : "Bot took more pairs",
      playerPairs: this.playerPairs,
      botPairs: this.botPairs,
      totalPairs,
    };

    this.sceneConfig.onRoundEnd?.(result);
    this.showEndPanel(result);
  }

  private showEndPanel(result: MemoryDuelResult) {
    const panelWidth = 460;
    const panelHeight = 220;
    const panel = this.add.container(this.scale.width / 2, this.scale.height / 2 + 10);
    const bg = this.add
      .rectangle(0, 0, panelWidth, panelHeight, 0x0b1222, 0.95)
      .setStrokeStyle(2, 0x38bdf8)
      .setOrigin(0.5);
    const title = this.add
      .text(0, -panelHeight / 2 + 24, "Duel Complete", {
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
      .text(0, 26, `You ${result.playerPairs} — Bot ${result.botPairs}`, {
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
      this.cards.forEach((card) => {
        card.rect?.destroy();
        card.label?.destroy();
      });
      this.setupBoard();
      this.startRound();
    });

    panel.add([bg, title, summary, scoreLine, button, buttonLabel]);
  }

  private popMatch(indices: number[]) {
    indices.forEach((idx) => {
      const card = this.cards[idx];
      if (!card.rect) return;
      const emitterManager: any = this.add.particles(0, 0, "hit-spark");
      const emitter = emitterManager.createEmitter({
        speed: { min: 120, max: 200 },
        angle: { min: 0, max: 360 },
        lifespan: 400,
        quantity: 10,
        scale: { start: 0.7, end: 0 },
        tint: 0x38bdf8,
        blendMode: "ADD",
        gravityY: 160,
      });
      emitter.explode(12, card.rect.x, card.rect.y);
      this.time.delayedCall(420, () => emitterManager.destroy());
      this.playMatchSfx();
    });
  }

  private playFlipSfx() {
    const audio = new Audio(this.flipSfx);
    audio.volume = 0.2;
    audio.play().catch(() => {});
  }

  private playMatchSfx() {
    const audio = new Audio(this.matchSfx);
    audio.volume = 0.25;
    audio.play().catch(() => {});
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
