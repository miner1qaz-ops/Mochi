import * as Phaser from "phaser";
import { SpeedMatchScene } from "./SpeedMatchScene";
import { SpeedMatchGameConfig } from "./types";

export function createSpeedMatchGame(config: SpeedMatchGameConfig): Phaser.Game {
  const { parent, width = 800, height = 600, ...rest } = config;
  const scene = new SpeedMatchScene(rest);

  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#030712",
    scene,
  });
}

export default createSpeedMatchGame;
