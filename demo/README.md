# Tinman Demo

Interactive product demo for **Tinman** — a robot-view multi-project workbench. This is a React + TypeScript + Vite slice with canned data and simulated dispatch (no real scan, SQLite, LLM, or agent CLI).

## Install

```bash
cd demo
npm install
```

## Start

```bash
npm run dev
```

Open the URL shown in the terminal (default `http://localhost:5173`).

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Demo click path (≤3 clicks)

1. Open **Fleet** view (default) and click a row in **最短腿排行 Top 5** — navigates to Robot view with that part selected.
2. In the part panel, click **生成任务** — shows the goal card (Demo JSON, authorization flags false).
3. Click **确认派发** — task appears on a workstation; view switches to **Task**.

Other flows:

- **Help → Reset Demo** restores seed data from localStorage key `tinman-demo-v1`.
- Unconfirmed architecture map: select **客户端 SDK**, confirm map via banner CTA.
- Theme toggle in the top bar (default dark).

## Replacement seams

- `src/adapters/scan.ts` — repo scan → `facts.json`
- `src/adapters/db.ts` — SQLite
- `src/adapters/llm.ts` — `llm.call(purpose, input)`
- `src/adapters/agentCli.ts` — worktree + agent CLI
- `src/data/demoData.ts` — all Demo sample data

## Originals (read-only)

Do not modify repo-root `robot-v2.html`. Visuals follow that HTML; product intent is kept locally and is not published in this repository.
