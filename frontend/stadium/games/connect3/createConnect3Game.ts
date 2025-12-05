import * as Phaser from "phaser";
import { Connect3Scene } from "./Connect3Scene";
import { Connect3GameConfig } from "./types";

export function createConnect3Game(config: Connect3GameConfig): Phaser.Game {
  const { parent, width = 800, height = 600, ...rest } = config;
  const scene = new Connect3Scene(rest);
  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#030712",
    scene,
  });
}

export default createConnect3Game;
