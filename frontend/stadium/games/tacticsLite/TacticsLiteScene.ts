import * as Phaser from "phaser";
import { TacticsLiteResult } from "../types";
import { TacticsLiteOptions } from "./types";

type Team = "player" | "bot";

interface Unit {
  id: string;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

const GRID_SIZE = 5;
const TILE_SIZE = 88;
const TILE_GAP = 8;
const ATTACK_DAMAGE = 2;

export class TacticsLiteScene extends Phaser.Scene {
  private sceneConfig: {
    onRoundEnd?: (result: TacticsLiteResult) => void;
  };

  private units: Unit[] = [];
  private roundActive = false;
  private currentTurn: Team = "player";
  private selectedUnitId: string | null = null;
  private turnCount = 0;
  private turnText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private gridOrigin = { x: 0, y: 0 };
  private pulseTween?: Phaser.Tweens.Tween;

  constructor(options?: TacticsLiteOptions) {
    super("TacticsLiteScene");
    this.sceneConfig = { onRoundEnd: options?.onRoundEnd };
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060d");
    this.addTitle();
    this.gridOrigin = {
      x: this.scale.width / 2 - (GRID_SIZE * TILE_SIZE + (GRID_SIZE - 1) * TILE_GAP) / 2 + TILE_SIZE / 2,
      y: 160 + TILE_SIZE / 2,
    };
    this.spawnUnits();
    this.drawGrid();
    this.drawUnits();
    this.startRound();
  }

  private addTitle() {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, 18, "Tactics Lite", {
        fontSize: "26px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.add
      .text(centerX, 50, "Move and strike on a 5x5 board. Eliminate the bot squad.", {
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
    this.hpText = this.add.text(this.scale.width - 24, 20, "", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    }).setOrigin(1, 0);
  }

  private spawnUnits() {
    this.units = [
      { id: "p1", team: "player", x: 0, y: 4, hp: 6, maxHp: 6 },
      { id: "p2", team: "player", x: 1, y: 4, hp: 6, maxHp: 6 },
      { id: "p3", team: "player", x: 2, y: 4, hp: 7, maxHp: 7 },
      { id: "b1", team: "bot", x: 2, y: 0, hp: 6, maxHp: 6 },
      { id: "b2", team: "bot", x: 3, y: 0, hp: 6, maxHp: 6 },
      { id: "b3", team: "bot", x: 4, y: 0, hp: 7, maxHp: 7 },
    ];
  }

  private drawGrid() {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const px = this.gridOrigin.x + x * (TILE_SIZE + TILE_GAP);
        const py = this.gridOrigin.y + y * (TILE_SIZE + TILE_GAP);
        const rect = this.add
          .rectangle(px, py, TILE_SIZE, TILE_SIZE, 0x0f172a, 1)
          .setStrokeStyle(2, 0x1f2937)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        rect.on("pointerdown", () => this.handleTileClick(x, y));
      }
    }
  }

  private drawUnits() {
    // clear previous drawings if any
    this.children.list
      .filter((o: any) => o.getData && o.getData("unit"))
      .forEach((o: any) => o.destroy());

    this.units.forEach((unit) => {
      const px = this.gridOrigin.x + unit.x * (TILE_SIZE + TILE_GAP);
      const py = this.gridOrigin.y + unit.y * (TILE_SIZE + TILE_GAP);
      const color = unit.team === "player" ? 0x38bdf8 : 0xf97316;
      const rect = this.add
        .rectangle(px, py, TILE_SIZE - 12, TILE_SIZE - 12, color, 1)
        .setOrigin(0.5)
        .setStrokeStyle(2, 0xffffff)
        .setData("unit", unit.id);

      const hpText = this.add
        .text(px, py, `${unit.hp}`, {
          fontSize: "16px",
          fontFamily: "Inter, 'Segoe UI', sans-serif",
          color: "#0b1021",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setData("unit", unit.id);

      if (this.selectedUnitId === unit.id) {
        rect.setStrokeStyle(4, 0xffffff);
      }

      this.tweens.add({
        targets: [rect, hpText],
        duration: 1400,
        scale: { from: 1, to: 1.05 },
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    });

    const playerTotal = this.units.filter((u) => u.team === "player").reduce((acc, u) => acc + u.hp, 0);
    const botTotal = this.units.filter((u) => u.team === "bot").reduce((acc, u) => acc + u.hp, 0);
    this.hpText.setText(`You HP ${playerTotal} | Bot HP ${botTotal}`);
  }

  private startRound() {
    this.roundActive = true;
    this.currentTurn = "player";
    this.turnCount = 0;
    this.turnText.setText("Turn: You");
    this.selectedUnitId = null;
  }

  private handleTileClick(x: number, y: number) {
    if (!this.roundActive) return;
    if (this.currentTurn !== "player") return;

    const unitAtTile = this.getUnitAt(x, y);

    if (unitAtTile && unitAtTile.team === "player") {
      this.selectedUnitId = unitAtTile.id;
      this.drawUnits();
      return;
    }

    if (!this.selectedUnitId) return;
    const selected = this.getUnitById(this.selectedUnitId);
    if (!selected) return;
    const dist = Math.abs(selected.x - x) + Math.abs(selected.y - y);

    // Attack if enemy on target tile and adjacent
    if (unitAtTile && unitAtTile.team === "bot" && dist === 1) {
      this.attack(selected, unitAtTile);
      this.endTurn();
      return;
    }

    // Move if empty and within range 1
    if (!unitAtTile && dist === 1) {
      selected.x = x;
      selected.y = y;
      this.selectedUnitId = null;
      this.drawUnits();
      this.endTurn();
    }
  }

  private getUnitAt(x: number, y: number) {
    return this.units.find((u) => u.x === x && u.y === y);
  }

  private getUnitById(id: string) {
    return this.units.find((u) => u.id === id);
  }

  private attack(attacker: Unit, defender: Unit) {
    defender.hp -= ATTACK_DAMAGE;
    if (defender.hp <= 0) {
      this.units = this.units.filter((u) => u.id !== defender.id);
    }
    this.flashHit(defender.x, defender.y);
    this.drawUnits();
    this.checkWinCondition();
  }

  private endTurn() {
    if (this.checkWinCondition()) return;
    this.currentTurn = this.currentTurn === "player" ? "bot" : "player";
    this.turnText.setText(this.currentTurn === "player" ? "Turn: You" : "Turn: Bot");
    this.turnCount += 1;
    if (this.currentTurn === "bot") {
      this.time.delayedCall(500, () => this.botTurn());
    }
  }

  private botTurn() {
    if (!this.roundActive) return;
    const botUnit = this.chooseBotUnit();
    if (!botUnit) {
      this.endTurn();
      return;
    }
    const target = this.closestEnemy(botUnit);
    if (!target) {
      this.endTurn();
      return;
    }
    const dist = Math.abs(botUnit.x - target.x) + Math.abs(botUnit.y - target.y);
    if (dist === 1) {
      this.attack(botUnit, target);
      this.endTurn();
      return;
    }
    const step = this.stepToward(botUnit, target);
    if (step) {
      botUnit.x = step.x;
      botUnit.y = step.y;
      this.drawUnits();
    }
    this.endTurn();
  }

  private chooseBotUnit() {
    const bots = this.units.filter((u) => u.team === "bot");
    Phaser.Utils.Array.Shuffle(bots);
    return bots[0];
  }

  private closestEnemy(unit: Unit) {
    const enemies = this.units.filter((u) => u.team !== unit.team);
    if (!enemies.length) return null;
    return enemies.sort(
      (a, b) =>
        Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y) - (Math.abs(b.x - unit.x) + Math.abs(b.y - unit.y))
    )[0];
  }

  private stepToward(unit: Unit, target: Unit) {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const options = [
      { x: unit.x + Math.sign(dx), y: unit.y },
      { x: unit.x, y: unit.y + Math.sign(dy) },
    ];
    for (const opt of options) {
      if (this.isInside(opt.x, opt.y) && !this.getUnitAt(opt.x, opt.y)) {
        return opt;
      }
    }
    return null;
  }

  private cellToWorld(x: number, y: number) {
    return {
      px: this.gridOrigin.x + x * (TILE_SIZE + TILE_GAP),
      py: this.gridOrigin.y + y * (TILE_SIZE + TILE_GAP),
    };
  }

  private isInside(x: number, y: number) {
    return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
  }

  private checkWinCondition() {
    const playerAlive = this.units.some((u) => u.team === "player");
    const botAlive = this.units.some((u) => u.team === "bot");
    if (playerAlive && botAlive) return false;
    this.roundActive = false;
    let winner: TacticsLiteResult["winner"] = "draw";
    if (playerAlive && !botAlive) winner = "player";
    else if (!playerAlive && botAlive) winner = "bot";

    const result: TacticsLiteResult = {
      finalScore: playerAlive ? 1 : 0,
      durationMs: 0,
      winner,
      summary: winner === "draw" ? "Draw" : winner === "player" ? "You wiped the bot squad" : "Bot wins the skirmish",
      turnsTaken: this.turnCount,
      playerUnitsRemaining: this.units.filter((u) => u.team === "player").length,
      botUnitsRemaining: this.units.filter((u) => u.team === "bot").length,
    };
    this.sceneConfig.onRoundEnd?.(result);
    this.showEndPanel(result);
    return true;
  }

  private showEndPanel(result: TacticsLiteResult) {
    const panelWidth = 460;
    const panelHeight = 220;
    const panel = this.add.container(this.scale.width / 2, this.scale.height / 2 + 10);
    const bg = this.add
      .rectangle(0, 0, panelWidth, panelHeight, 0x0b1222, 0.95)
      .setStrokeStyle(2, 0x38bdf8)
      .setOrigin(0.5);
    const title = this.add
      .text(0, -panelHeight / 2 + 24, "Battle Complete", {
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
      .text(0, 26, `Turns ${result.turnsTaken} | You ${result.playerUnitsRemaining} vs Bot ${result.botUnitsRemaining}`, {
        fontSize: "15px",
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
      this.spawnUnits();
      this.drawUnits();
      this.startRound();
    });

    panel.add([bg, title, summary, scoreLine, button, buttonLabel]);
  }

  private flashHit(x: number, y: number) {
    const { px, py } = this.cellToWorld(x, y);
    const rect = this.add.rectangle(px, py, TILE_SIZE - 10, TILE_SIZE - 10, 0xef4444, 0.35).setOrigin(0.5);
    this.tweens.add({
      targets: rect,
      duration: 280,
      alpha: 0,
      scale: 1.3,
      ease: "Quad.easeOut",
      onComplete: () => rect.destroy(),
    });
  }
}
