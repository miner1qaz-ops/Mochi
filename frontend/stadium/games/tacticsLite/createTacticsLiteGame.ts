import * as Phaser from "phaser";
import { TacticsLiteScene } from "./TacticsLiteScene";
import { TacticsLiteGameConfig } from "./types";

export function createTacticsLiteGame(config: TacticsLiteGameConfig): Phaser.Game {
  const { parent, width = 800, height = 600, ...rest } = config;
  const scene = new TacticsLiteScene(rest);
  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#030712",
    scene,
  });
}

export default createTacticsLiteGame;
