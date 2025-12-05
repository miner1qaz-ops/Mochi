import * as Phaser from "phaser";
import { RpsPlusScene } from "./RpsPlusScene";
import { RpsPlusGameConfig } from "./types";

export function createRpsPlusGame(config: RpsPlusGameConfig): Phaser.Game {
  const { parent, width = 800, height = 600, ...rest } = config;
  const scene = new RpsPlusScene(rest);
  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#030712",
    scene,
  });
}

export default createRpsPlusGame;
