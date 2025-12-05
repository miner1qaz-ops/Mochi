import { SpeedMatchResult } from "../types";

export interface SpeedMatchOptions {
  roundDurationMs?: number;
  gridSize?: number;
  onRoundEnd?: (result: SpeedMatchResult) => void;
  bot?: {
    accuracy?: number; // chance bot picks a correct tile
    minIntervalMs?: number;
    maxIntervalMs?: number;
  };
}

export interface SpeedMatchGameConfig extends SpeedMatchOptions {
  width?: number;
  height?: number;
  parent: HTMLElement;
}
