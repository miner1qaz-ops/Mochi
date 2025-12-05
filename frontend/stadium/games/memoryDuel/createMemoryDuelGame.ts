import * as Phaser from "phaser";
import { MemoryDuelScene } from "./MemoryDuelScene";
import { MemoryDuelGameConfig } from "./types";

export function createMemoryDuelGame(config: MemoryDuelGameConfig): Phaser.Game {
  const { parent, width = 800, height = 600, ...rest } = config;
  const scene = new MemoryDuelScene(rest);
  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#030712",
    scene,
  });
}

export default createMemoryDuelGame;
