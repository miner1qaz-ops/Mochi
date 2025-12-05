import * as Phaser from "phaser";
import { SpeedMatchResult } from "../types";
import { SpeedMatchOptions } from "./types";

interface TilePalette {
  key: string;
  color: number;
  icon: string;
  label: string;
  texture: string;
}

interface TileInstance {
  rect: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
  palette: TilePalette;
}

const TILE_SET: TilePalette[] = [
  { key: "bulbasaur", color: 0x22c55e, icon: "🍃", label: "Bulbasaur", texture: "bulbasaur" },
  { key: "charmander", color: 0xf97316, icon: "🔥", label: "Charmander", texture: "charmander" },
  { key: "squirtle", color: 0x38bdf8, icon: "💧", label: "Squirtle", texture: "squirtle" },
  { key: "pikachu", color: 0xfacc15, icon: "⚡", label: "Pikachu", texture: "pikachu" },
  { key: "eevee", color: 0xf472b6, icon: "🌸", label: "Eevee", texture: "eevee" },
  { key: "gengar", color: 0xa855f7, icon: "🌙", label: "Gengar", texture: "gengar" },
  { key: "mew", color: 0x60a5fa, icon: "❄️", label: "Mew", texture: "mew" },
  { key: "dragonite", color: 0x94a3b8, icon: "🪨", label: "Dragonite", texture: "dragonite" },
];

const TILE_SIZE = 105;
const TILE_GAP = 12;
const DEFAULT_ROUND_MS = 30_000;
const DEFAULT_GRID_SIZE = 4;

export class SpeedMatchScene extends Phaser.Scene {
  private sceneConfig: {
    roundDurationMs: number;
    gridSize: number;
    onRoundEnd?: (result: SpeedMatchResult) => void;
    bot: { accuracy: number; minIntervalMs: number; maxIntervalMs: number };
  };

  private target!: TilePalette;
  private tiles: TileInstance[] = [];
  private remainingMs = DEFAULT_ROUND_MS;
  private playerScore = 0;
  private botScore = 0;
  private correctClicks = 0;
  private wrongClicks = 0;
  private roundActive = false;
  private botTimer?: Phaser.Time.TimerEvent;

  private scoreText!: Phaser.GameObjects.Text;
  private botScoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private accuracyText!: Phaser.GameObjects.Text;
  private targetBlock!: Phaser.GameObjects.Rectangle;
  private targetIcon!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private targetImage?: Phaser.GameObjects.Image;

  constructor(options?: SpeedMatchOptions) {
    super("SpeedMatchScene");
    const roundDurationMs = options?.roundDurationMs && options.roundDurationMs > 0 ? options.roundDurationMs : DEFAULT_ROUND_MS;
    const gridSize = options?.gridSize && options.gridSize > 1 ? options.gridSize : DEFAULT_GRID_SIZE;
    this.sceneConfig = {
      roundDurationMs,
      gridSize,
      onRoundEnd: options?.onRoundEnd,
      bot: {
        accuracy: options?.bot?.accuracy ?? 0.65,
        minIntervalMs: options?.bot?.minIntervalMs ?? 900,
        maxIntervalMs: options?.bot?.maxIntervalMs ?? 1400,
      },
    };
  }

  preload() {
    this.createSparkTexture();
    TILE_SET.forEach((t) => {
      if (!this.textures.exists(t.texture)) {
        this.load.image(t.texture, `/img/pokemon/${t.texture}.png`);
      }
    });
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060d");
    this.addTitle();
    this.createHud();
    this.startRound();
  }

  update(_time: number, delta: number) {
    if (!this.roundActive) return;
    this.remainingMs = Math.max(0, this.remainingMs - delta);
    this.updateHud();
    if (this.remainingMs <= 0) {
      this.endRound();
    }
  }

  private addTitle() {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, 18, "Speed Match", {
        fontSize: "26px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);

    this.add
      .text(centerX, 50, "Tap the tiles that match the target icon before time runs out.", {
        fontSize: "14px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#dbeafe",
      })
      .setOrigin(0.5, 0);
  }

  private createHud() {
    const centerX = this.scale.width / 2;
    const baseStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    };

    this.scoreText = this.add.text(24, 20, "You: 0", baseStyle);
    this.botScoreText = this.add.text(24, 46, "Bot: 0", { ...baseStyle, color: "#cbd5e1" });
    this.timerText = this.add.text(this.scale.width - 24, 20, "Time: 30.0s", baseStyle).setOrigin(1, 0);
    this.accuracyText = this.add.text(this.scale.width - 24, 46, "Hits: 0 / Misses: 0", { ...baseStyle, color: "#cbd5e1" }).setOrigin(1, 0);

    this.targetBlock = this.add
      .rectangle(centerX - 70, 108, 92, 92, 0x38bdf8, 1)
      .setStrokeStyle(2, 0xffffff)
      .setOrigin(0.5);
    this.targetIcon = this.add
      .text(centerX - 70, 108, "⚡", {
        fontSize: "36px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#0b0f1a",
      })
      .setOrigin(0.5);
    this.targetImage = this.add.image(centerX - 70, 108, "pikachu").setDisplaySize(72, 72).setVisible(false);
    this.targetText = this.add
      .text(centerX + 20, 84, "Find target", {
        fontSize: "18px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);

    this.add
      .text(centerX + 20, 110, "Click matching tiles for +10. Wrong taps are -5.", {
        fontSize: "13px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#cbd5e1",
      })
      .setOrigin(0, 0);
  }

  private startRound() {
    this.roundActive = true;
    this.remainingMs = this.sceneConfig.roundDurationMs;
    this.playerScore = 0;
    this.botScore = 0;
    this.correctClicks = 0;
    this.wrongClicks = 0;
    this.target = Phaser.Utils.Array.GetRandom(TILE_SET);
    this.updateTargetVisuals();
    this.renderGrid();
    this.updateHud();
    this.startBotLoop();
  }

  private updateTargetVisuals() {
    this.targetBlock.setFillStyle(this.target.color, 1);
    this.targetIcon.setText(this.target.icon);
    if (this.targetImage) {
      this.targetImage.setTexture(this.target.texture);
      this.targetImage.setVisible(true);
      this.tweens.add({
        targets: this.targetImage,
        duration: 1200,
        scale: { from: 1, to: 1.06 },
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    this.targetText.setText(`Find ${this.target.icon} ${this.target.label}`);
  }

  private renderGrid() {
    this.tiles.forEach((tile) => {
      tile.rect.destroy();
      tile.icon.destroy();
    });
    this.tiles = [];

    const totalTiles = this.sceneConfig.gridSize * this.sceneConfig.gridSize;
    const minMatches = Math.max(3, Math.floor(totalTiles / 4));
    const maxMatches = Math.max(minMatches + 1, Math.floor(totalTiles / 3) + 1);
    const matches = Phaser.Math.Between(minMatches, maxMatches);
    const assignments: TilePalette[] = [];

    for (let i = 0; i < totalTiles; i++) {
      const palette = i < matches ? this.target : Phaser.Utils.Array.GetRandom(TILE_SET);
      assignments.push(palette);
    }

    Phaser.Utils.Array.Shuffle(assignments);

    const gridWidth = this.sceneConfig.gridSize * TILE_SIZE + (this.sceneConfig.gridSize - 1) * TILE_GAP;
    const startX = this.scale.width / 2 - gridWidth / 2 + TILE_SIZE / 2;
    const startY = 140 + TILE_SIZE / 2;

    assignments.forEach((palette, index) => {
      const col = index % this.sceneConfig.gridSize;
      const row = Math.floor(index / this.sceneConfig.gridSize);
      const x = startX + col * (TILE_SIZE + TILE_GAP);
      const y = startY + row * (TILE_SIZE + TILE_GAP);

      const rect = this.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, palette.color, 0.8)
        .setOrigin(0.5)
        .setStrokeStyle(2, palette.key === this.target.key ? 0xffffff : 0x1f2937)
        .setInteractive({ useHandCursor: true });

      const icon = this.add
        .image(x, y, palette.texture)
        .setDisplaySize(TILE_SIZE * 0.72, TILE_SIZE * 0.72)
        .setOrigin(0.5);

      rect.on("pointerover", () => rect.setScale(1.03));
      rect.on("pointerout", () => rect.setScale(1));
      rect.on("pointerdown", () => this.handleTileClick(palette, rect));

      this.tiles.push({ rect, icon, palette });
    });
  }

  private handleTileClick(palette: TilePalette, rect: Phaser.GameObjects.Rectangle) {
    if (!this.roundActive) return;
    const isMatch = palette.key === this.target.key;
    if (isMatch) {
      this.playerScore += 10;
      this.correctClicks += 1;
    } else {
      this.playerScore -= 5;
      this.wrongClicks += 1;
    }
    this.updateHud();
    this.playTileFeedback(rect, isMatch);
    this.refreshChallenge();
  }

  private playTileFeedback(rect: Phaser.GameObjects.Rectangle, success: boolean) {
    const tint = success ? 0x22c55e : 0xef4444;
    rect.setStrokeStyle(3, tint);
    this.tweens.add({
      targets: rect,
      duration: 140,
      scale: 1.08,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => rect.setStrokeStyle(2, success ? 0xffffff : 0x1f2937),
    });
    const emitterManager: any = this.add.particles(0, 0, "hit-spark");
    const emitter = emitterManager.createEmitter({
      speed: { min: 120, max: 220 },
      angle: { min: 0, max: 360 },
      lifespan: 350,
      quantity: 12,
      gravityY: 200,
      scale: { start: 0.7, end: 0 },
      tint: success ? 0x22c55e : 0xef4444,
      blendMode: "ADD",
    });
    emitter.explode(14, rect.x, rect.y);
    this.time.delayedCall(400, () => emitterManager.destroy());
  }

  private refreshChallenge() {
    this.target = Phaser.Utils.Array.GetRandom(TILE_SET);
    this.updateTargetVisuals();
    this.renderGrid();
  }

  private startBotLoop() {
    this.botTimer?.remove(false);
    const interval = Phaser.Math.Between(this.sceneConfig.bot.minIntervalMs, this.sceneConfig.bot.maxIntervalMs);
    this.botTimer = this.time.addEvent({
      delay: interval,
      loop: false,
      callback: () => {
        if (!this.roundActive) return;
        const success = Math.random() < this.sceneConfig.bot.accuracy;
        if (success) {
          this.botScore += 10;
        } else {
          this.botScore -= 5;
        }
        this.updateHud();
        this.refreshChallenge();
        this.startBotLoop();
      },
    });
  }

  private updateHud() {
    this.scoreText.setText(`You: ${this.playerScore}`);
    this.botScoreText.setText(`Bot: ${this.botScore}`);
    this.accuracyText.setText(`Hits: ${this.correctClicks} / Misses: ${this.wrongClicks}`);
    this.timerText.setText(`Time: ${(this.remainingMs / 1000).toFixed(1)}s`);
  }

  private endRound() {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.botTimer?.remove(false);
    this.tiles.forEach((tile) => tile.rect.disableInteractive());

    let winner: SpeedMatchResult["winner"] = "draw";
    if (this.playerScore > this.botScore) winner = "player";
    else if (this.botScore > this.playerScore) winner = "bot";

    const result: SpeedMatchResult = {
      finalScore: this.playerScore,
      durationMs: this.sceneConfig.roundDurationMs,
      winner,
      summary: winner === "draw" ? "Draw" : winner === "player" ? "You beat the bot" : "Bot wins",
      playerScore: this.playerScore,
      botScore: this.botScore,
      correctClicks: this.correctClicks,
      wrongClicks: this.wrongClicks,
    };

    this.sceneConfig.onRoundEnd?.(result);
    this.showEndPanel(result);
  }

  private showEndPanel(result: SpeedMatchResult) {
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
      .text(0, -6, `${result.summary ?? "Finished"}`, {
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

    const accuracyLine = this.add
      .text(0, 54, `Hits ${this.correctClicks} / Misses ${this.wrongClicks}`, {
        fontSize: "14px",
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
      this.startRound();
    });

    panel.add([bg, title, summary, scoreLine, accuracyLine, button, buttonLabel]);
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
