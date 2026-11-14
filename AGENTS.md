# Agent entry — PSEHR / Wundadi

**Product name (clinic-facing):** 北極星自主電子病歷系統  
**Repo / GitHub:** `momohsumomo/PSEHR` (internal code still says Wundadi; do not mass-rename)  
**This file:** first read for any agent opening this repo. Details live in linked docs; do not invent from memory.

---

## 60-second map

| What | Where |
|------|--------|
| Product rules (A/B/C, no VPN automation, data ownership) | `docs/專案憲章-原則與方向.md` |
| Locked clinic behaviour (do not reverse) | `docs/交接-目前進度.md` |
| Module / folder meanings | `docs/模組地圖.md` |
| All doc index + authority order | `docs/文件索引.md` |
| Host vs workstation | `docs/主機與工作站.md` |
| Claims / monthly XML | `docs/申報接手說明.md` |
| Cursor hard rules | `.cursor/rules/*.mdc` |

**North star:** independent SMART on FHIR clinic system that replaces 醫聖 for OPD + claims. Local-first: chart DB on the clinic host, not on GitHub.

---

## Hard stops (break these and you break the clinic)

1. **Do not update the live host** unless the user this turn says to install on the host. `git push` / `gh release create program-…` only. Never call `/maintenance/app-update`, never copy into `Z:\PolarisSEHR` or `\\Opd\e`. Clinic presses update in the lobby. Rule: `.cursor/rules/no-host-update.mdc`.
2. **Devices stay on the PC that opened the page.** Print, VPN, card reader = that desk’s `127.0.0.1:5310` / `:5066`. Never print or read cards via the host for another PC. Rule: `.cursor/rules/desk-card-local-only.mdc`.
3. **No DELETE** of chart / Media. POST/PUT only.
4. **No NHI VPN web automation**, no “guarantee indicator” product features (layer C).
5. **Do not reverse** behaviours listed in `docs/交接-目前進度.md`.
6. **Print feed is locked** for short slips (93×210). Do not touch rotation helpers. Rule: `.cursor/rules/print-feed-locked.mdc`.
7. Never print patient name / ID / chart number / doctor ID / IP in chat. Queue number only when discussing visits.
8. Chart DB `data/shadow.db` (on host often under `Z:\PolarisSEHR\data\`) — never write from a tooling session; read-only copies only if the user asks.

---

## Ports (memorize)

| Port | Role | Runs on |
|------|------|---------|
| TCP 5000 | FastAPI (`/api`, `/docs`) | Host only |
| TCP 3010 | Vite UI | Host only |
| UDP 5301 | Beacon so desks find the host | Host |
| TCP 5310 | Desk agent (print, card proxy, referral tools) | **Each** PC that opened the UI |
| HTTPS 5066 | NHI card console 6.0 | **That** desk |

Host start: `啟動-Wundadi門診.bat` / `重啟全部-Wundadi門診.bat` (background, no console).  
Other PCs: copy only `客戶端/`, run `開啟門診.exe` or `連到主機.bat`. Never start a second API on a workstation.

Program updates for clinics: GitHub Release tag `program-YYYY.MM.DD.N`.

---

## Feature layers (decide before coding)

| Layer | Meaning | Examples |
|-------|---------|----------|
| **A** | Built-in product | OPD loop, drug Pack, monthly claims, card read |
| **B** | Tooling + Cursor | Seasonal NHI projects: find patients, build upload files |
| **C** | Do not build | VPN click automation, one-click score chasing |

Seasonal (B) workflow: read the user’s circular → summarize fields → query → build file → **human** uploads on VPN. Docs: `docs/診所端-用Cursor處理時令專案.md`.

---

## Stack

- **Backend:** Python 3.12, FastAPI, SQLite shadow store (`src/infrastructure/sqlite_shadow_store.py`)
- **Frontend:** Vite + React + TypeScript + Tailwind (`frontend/`)
- **Desk agent:** PowerShell `客戶端/desk_agent.ps1` (ASCII, LF)
- **Claims export:** `src/claims/` only exit for XML packing
- **Drug price Pack:** host fetches open data → Pack → `src/spoke/`; not clinic VPN scraping
- **Tests:** `tests/` via `python -m unittest discover -s tests -q` with `PYTHONPATH` = repo root

---

## Read order for a new task

1. This file  
2. `docs/專案憲章-原則與方向.md`  
3. `docs/交接-目前進度.md` (recent locked behaviour)  
4. Topic doc from `docs/文件索引.md`  
5. Code under `docs/模組地圖.md`

If oral history conflicts with charter / 交接 → **charter and 交接 win**. Update those docs before changing product behaviour.

---

## What not to trust

| File | Status |
|------|--------|
| `CURSOR_PROJECT_HANDOVER.md` | **Obsolete.** Redirect only. Wrong ports/APIs/clinic-specific samples. |
| Root clutter (PDFs, JPG, tool folders, `scripts/_peek_*`) | Local clinic / scratch; not product core |
| `data/` | Runtime DB + logs; gitignored; never push |

---

## Chinese replies

User preference: answer in **zh-TW** unless they ask otherwise.
