import { Connect3Result } from "../types";

export interface Connect3Options {
  onRoundEnd?: (result: Connect3Result) => void;
  timerMs?: number;
}

export interface Connect3GameConfig extends Connect3Options {
  width?: number;
  height?: number;
  parent: HTMLElement;
}
