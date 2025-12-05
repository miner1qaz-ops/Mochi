import { MemoryDuelResult } from "../types";

export interface MemoryDuelOptions {
  cols?: number;
  rows?: number;
  flipDelayMs?: number;
  onRoundEnd?: (result: MemoryDuelResult) => void;
}

export interface MemoryDuelGameConfig extends MemoryDuelOptions {
  width?: number;
  height?: number;
  parent: HTMLElement;
}
