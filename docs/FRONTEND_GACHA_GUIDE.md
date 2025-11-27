# Mochi Gacha Frontend – Agent / Team Guide

## 1) Purpose & Scope
This defines how the “Gacha / Pack Opening” UI should behave and how code should be maintained. It is for developers, AI agents, and reviewers working on:
- Pack purchase / build / preview / open.
- Two reveal modes: grid (fast) and 1-card modal (swipe/tap).
- Frontend logic; avoid touching backend/RNG unless explicitly requested.

## 2) Reveal UX Specification
### Reveal Modes
- **Grid (fast)** (default after purchase/preview or when user selects fast mode): all cards in a grid. Click any card to flip back → front independently. No order, no swipe.
- **1-card (modal)** (user selects “1-card mode (swipe/tap)”; modal opens after pack build/test):
  - One card at a time, starts face-down (card back).
  - First swipe or click: flip current card back → front (no advance).
  - Second swipe/click (or subsequent) when current card is revealed: advance to next card (starts face-down).
  - Last card swipe/click closes modal.
  - Swipe/drag must work on touch; click must behave the same for desktop.

### Grid Mode Rules
- Clicking any card flips that card; independent order.

## 3) Code Conventions (React/TSX)
- Functional components + hooks; no classes.
- Separate UI/presentation from logic/API where practical.
- Keep API/tx/RNG logic untouched unless explicitly requested.
- Maintain readability; immutable state updates; no hooks in loops/conditions.
- Document any UI-behaviour change (comment or markdown) when altering reveal logic.

## 4) Agent Prompt Template (for Codex/LLM)
When editing the gacha UI, instruct the agent:
- Two reveal modes; do not remove either.
- 1-card modal interactions:
  - First drag/click flips current card; next drag/click advances; last closes.
  - Swipe/drag must remain; click treated like swipe.
- Do not change backend API/tx/RNG unless asked.
- Keep components functional, organized, and readable.
- Return minimal diffs; if adding behaviour, explain briefly.

## 5) Process
- For notable UI changes, add a short design/behaviour note (in PR or docs).
- Prefer a living style guide (Storybook or similar) if the surface grows.
