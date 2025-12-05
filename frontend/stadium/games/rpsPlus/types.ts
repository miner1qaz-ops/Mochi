import { RpsPlusResult } from "../types";

export interface RpsPlusOptions {
  onRoundEnd?: (result: RpsPlusResult) => void;
}

export interface RpsPlusGameConfig extends RpsPlusOptions {
  width?: number;
  height?: number;
  parent: HTMLElement;
}
