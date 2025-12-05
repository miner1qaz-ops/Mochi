import * as Phaser from "phaser";
import { RpsPlusResult } from "../types";
import { RpsPlusOptions } from "./types";

type Move = "Fire" | "Water" | "Grass" | "Electric" | "Psychic";

const MOVES: Move[] = ["Fire", "Water", "Grass", "Electric", "Psychic"];

// Each move beats the next two in this list (circular), loses to previous two.
function outcome(player: Move, opponent: Move): "win" | "lose" | "draw" {
  if (player === opponent) return "draw";
  const order: Move[] = ["Fire", "Grass", "Water", "Electric", "Psychic"];
  const pIndex = order.indexOf(player);
  const beats = [order[(pIndex + 1) % 5], order[(pIndex + 2) % 5]];
  if (beats.includes(opponent)) return "win";
  return "lose";
}

export class RpsPlusScene extends Phaser.Scene {
  private sceneConfig: { onRoundEnd?: (result: RpsPlusResult) => void };
  private round = 1;
  private playerWins = 0;
  private botWins = 0;
  private history: RpsPlusResult["rounds"] = [];
  private roundText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private playerMoveCounts: Record<Move, number> = {
    Fire: 0,
    Water: 0,
    Grass: 0,
    Electric: 0,
    Psychic: 0,
  };
  private roundActive = true;

  constructor(options?: RpsPlusOptions) {
    super("RpsPlusScene");
    this.sceneConfig = { onRoundEnd: options?.onRoundEnd };
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060d");
    this.addTitle();
    this.drawButtons();
    this.updateHud("Pick your move");
  }

  private addTitle() {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, 18, "Rock–Paper–Scissors+", {
        fontSize: "26px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.add
      .text(centerX, 50, "5-move duel. First to 3 wins.", {
        fontSize: "14px",
        fontFamily: "Inter, 'Segoe UI', sans-serif",
        color: "#dbeafe",
      })
      .setOrigin(0.5, 0);

    this.roundText = this.add.text(24, 20, "Round 1 / 5", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    });
    this.scoreText = this.add.text(this.scale.width - 24, 20, "You 0 | Bot 0", {
      fontSize: "16px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e5e7eb",
    }).setOrigin(1, 0);
    this.statusText = this.add.text(centerX, 110, "Pick your move", {
      fontSize: "18px",
      fontFamily: "Inter, 'Segoe UI', sans-serif",
      color: "#e0f2fe",
    }).setOrigin(0.5, 0);
  }

  private drawButtons() {
    const centerX = this.scale.width / 2;
    const startX = centerX - 220;
    const y = 200;
    MOVES.forEach((move, idx) => {
      const x = startX + idx * 110;
      const rect = this.add
        .rectangle(x, y, 100, 120, 0x111827, 1)
        .setStrokeStyle(2, 0x1f2937)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x, y - 10, move, {
          fontSize: "16px",
          fontFamily: "Inter, 'Segoe UI', sans-serif",
          color: "#e5e7eb",
          fontStyle: "bold",
          align: "center",
        })
        .setOrigin(0.5);
      const hint = this.add
        .text(
          x,
          y + 26,
          move === "Fire"
            ? "Beats Grass/Psychic"
            : move === "Water"
            ? "Beats Fire/Electric"
            : move === "Grass"
            ? "Beats Water/Electric"
            : move === "Electric"
            ? "Beats Psychic/Fire"
            : "Beats Fire/Grass",
          {
            fontSize: "11px",
            fontFamily: "Inter, 'Segoe UI', sans-serif",
            color: "#94a3b8",
            align: "center",
          }
        )
        .setOrigin(0.5);

      rect.on("pointerover", () => rect.setStrokeStyle(3, 0x38bdf8));
      rect.on("pointerout", () => rect.setStrokeStyle(2, 0x1f2937));
      rect.on("pointerdown", () => this.playRound(move));

      rect.setData("rps-btn", true);
      label.setData("rps-btn", true);
      hint.setData("rps-btn", true);
    });
  }

  private playRound(playerMove: Move) {
    if (!this.roundActive) return;
    const botMove = this.chooseBotMove();
    this.playerMoveCounts[playerMove] += 1;
    const result = outcome(playerMove, botMove);
    if (result === "win") this.playerWins += 1;
    else if (result === "lose") this.botWins += 1;

    const roundEntry: RpsPlusResult["rounds"][number] = {
      round: this.round,
      playerMove,
      botMove,
      outcome: result === "draw" ? "draw" : result === "win" ? "player" : "bot",
    };
    this.history.push(roundEntry);
    this.round += 1;
    this.updateHud(`You played ${playerMove}, Bot played ${botMove} (${result})`);

    if (this.playerWins === 3 || this.botWins === 3 || this.round > 5) {
      this.finishMatch();
    }
  }

  private chooseBotMove(): Move {
    // Simple adaptation: bias against player's most frequent move
    const counts = this.playerMoveCounts;
    const mostUsed = (Object.keys(counts) as Move[]).reduce((a, b) => (counts[a] > counts[b] ? a : b));
    const counterCandidates = this.countersOf(mostUsed);
    const pool: Move[] = [...MOVES, ...counterCandidates]; // slight bias
    return Phaser.Utils.Array.GetRandom(pool);
  }

  private countersOf(move: Move): Move[] {
    // Moves that beat the provided move using outcome lookup
    return MOVES.filter((m) => outcome(m, move) === "win");
  }

  private updateHud(status: string) {
    this.roundText.setText(`Round ${Math.min(this.round, 5)} / 5`);
    this.scoreText.setText(`You ${this.playerWins} | Bot ${this.botWins}`);
    this.statusText.setText(status);
  }

  private finishMatch() {
    this.roundActive = false;
    let winner: RpsPlusResult["winner"] = "draw";
    if (this.playerWins > this.botWins) winner = "player";
    else if (this.botWins > this.playerWins) winner = "bot";

    const result: RpsPlusResult = {
      finalScore: this.playerWins,
      durationMs: 0,
      winner,
      summary: winner === "draw" ? "Draw" : winner === "player" ? "You win the set" : "Bot takes the set",
      rounds: this.history,
      playerRoundsWon: this.playerWins,
      botRoundsWon: this.botWins,
    };
    this.sceneConfig.onRoundEnd?.(result);
    this.showEndPanel(result);
  }

  private showEndPanel(result: RpsPlusResult) {
    const panelWidth = 460;
    const panelHeight = 240;
    const panel = this.add.container(this.scale.width / 2, this.scale.height / 2 + 10);
    const bg = this.add
      .rectangle(0, 0, panelWidth, panelHeight, 0x0b1222, 0.95)
      .setStrokeStyle(2, 0x38bdf8)
      .setOrigin(0.5);
    const title = this.add
      .text(0, -panelHeight / 2 + 24, "Match Complete", {
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
      .text(0, 26, `You ${result.playerRoundsWon} — Bot ${result.botRoundsWon}`, {
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
      this.resetMatch();
    });

    panel.add([bg, title, summary, scoreLine, button, buttonLabel]);
  }

  private resetMatch() {
    this.round = 1;
    this.playerWins = 0;
    this.botWins = 0;
    this.history = [];
    this.roundActive = true;
    this.playerMoveCounts = {
      Fire: 0,
      Water: 0,
      Grass: 0,
      Electric: 0,
      Psychic: 0,
    };
    this.updateHud("Pick your move");
  }
}
