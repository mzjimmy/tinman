CRITERIA:  C1 met — llm::tests::c1_purpose_set_is_closed: four purposes round-trip; "summarise" fails serde and does not construct a transport
           C2 met — llm::tests::c2_key_never_appears_in_log_row_or_error: sentinel is sent as Authorization, absent from log row JSON, result JSON, and detail
           C3 met — llm::tests::c3_call_log_round_trip: accepted + rejected rows persist; list_llm_calls returns newest first with verdict and reject_reason
           C4 met — c4_gate_rejects_fenced_code, c4_gate_rejects_diff_hunk, c4_gate_rejects_percentage, c4_gate_rejects_progress_fraction, c4_gate_rejects_missing_field (all five fields), c4_gate_rejects_done_criteria_out_of_range (2 and 6), c4_gate_rejects_unsourced_diagnosis, c4_gate_accepts_shi_shi_bu_zu_without_citation, c4_gate_accepts_a_clean_five_field_advice
           C5 met — llm::tests::c5_no_key_is_typed_unavailable_not_error (Unavailable/no_key, factory not called) + PartPanel.test.tsx (hand-fill copy, no `%` for each unavailable reason)
BASELINE:  npm test → Test Files 7 passed (7) Tests 35 passed (35); cargo test → test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 11.08s
AFTER:     Test Files  8 passed (8)
           Tests  47 passed (47)
           test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.96s
INVARIANT: wire progress derived from criteria — db.rs tests still green: yes
           four core tables unaltered: yes
FILES:     app/src-tauri/src/llm.rs
           app/src-tauri/src/db.rs
           app/src-tauri/src/commands.rs
           app/src-tauri/src/lib.rs
           app/src-tauri/migrations/001_init.sql
           app/src-tauri/Cargo.toml
           app/src-tauri/Cargo.lock
           app/src/lib/api.ts
           app/src/domain/types.ts
           app/src/hooks/useAppState.ts
           app/src/components/PartPanel.tsx
           app/src/components/PartPanel.test.tsx
           app/src/components/RobotView.tsx
           app/src/index.css
           REPORT-round2-wp1.md
SCOPE:     extended: add_criterion command — set_criterion_met only toggles an existing item; accepting a proposed or hand-filled criterion must append through WireInput (no progress field)
           extended: set_llm_key command — C2 requires a keychain write path; nothing in round 1 stored secrets
           extended: set_workspace_llm_profile command — workspace.llm_profile_id existed unused; resolution is per workspace

## 1. Files

- `app/src-tauri/src/llm.rs` — Purpose enum, ProviderConfig, pure `validate`, injected `Transport`/`KeyStore`/`Clock`, `call(purpose, input)`, HttpTransport (reqwest rustls, 3s connect timeout), OsKeychain (keyring). Tests live here.
- `app/src-tauri/src/db.rs` — `insert_llm_call`, `list_llm_calls` (newest first), `add_criterion`, `set_workspace_llm_profile`. Existing derived-progress tests untouched. New test: adding a criterion recomputes 2/5=40 → 2/6=33.
- `app/src-tauri/src/commands.rs` — `llm_call`, `list_llm_calls`, `add_criterion`, `set_llm_key`, `set_workspace_llm_profile`, all `rename_all = "snake_case"`. HTTP runs in `spawn_blocking`; the db mutex is not held across the network.
- `app/src-tauri/src/lib.rs` — `mod llm` and command registration.
- `app/src-tauri/migrations/001_init.sql` — appended `CREATE TABLE IF NOT EXISTS llm_call` plus index. The four core tables are unchanged.
- `app/src-tauri/Cargo.toml` / `Cargo.lock` — `reqwest` (json, rustls-tls, blocking, no default TLS) and `keyring` 3.
- `app/src/lib/api.ts` — invoke wrappers. ipcContract.test.ts discovered the new commands and stayed green (19 tests = 18 commands + surface check).
- `app/src/domain/types.ts` — `LlmAdviceView` / `LlmUnavailableReason` on top of existing `FrameworkAdvice`.
- `app/src/hooks/useAppState.ts` — `requestAdvice`, `addCriterion`, `partAdvice`, `llmCalls`. Catch path maps IPC failure to typed `offline`, not a raw error string as the primary UI.
- `app/src/components/PartPanel.tsx` — five-field render, degraded panel, `事实 + 手填验收项`, accept-proposed → `onAddCriterion`.
- `app/src/components/PartPanel.test.tsx` — available / four unavailable reasons / no `%` / accept calls write path.
- `app/src/components/RobotView.tsx` — wires the new PartPanel props.
- `app/src/index.css` — llm-advice / hand-fill / proposed-criteria.
- `REPORT-round2-wp1.md` — this file.

Not modified: `demo/`, `robot-v2.html`, `REPORT-round1.md`, `scanner.rs`, `app/src-tauri/.cargo/config.toml`. No second migration. No git commit/push.

`app/package-lock.json` was already dirty on this branch before this work; I did not run `npm install`.

## 2. Final test summary lines

npm test:

```
 Test Files  8 passed (8)
      Tests  47 passed (47)
```

cargo test (lib suite, the comparable line to the round-1 baseline of 8):

```
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.96s
```

`npx tsc --noEmit` also exited 0 after a narrowing fix in `DegradedAdvice` (see §5). Scanner budget test `scan_this_repo_under_10s_read_only_and_populated` passed.

## 3. Decisions

**Call path.** `llm::call` takes the purpose as a wire string and deserializes to `Purpose` before touching the transport factory, keychain, or HTTP client. That is the single path. An unknown value returns `Err(InvalidPurpose)` with no log row. The four listed unavailable reasons stay `no_key | no_profile | offline | rejected`.

**Config.** Profiles are `llm_profiles` in app prefs (`__tinman_app__`). `workspace.llm_profile_id` selects one; missing/unknown id is `no_profile`. `openai_compatible` requires a non-empty `key_ref` and a keychain hit; `ollama` sends no Authorization. Both speak `/v1/chat/completions`.

**Gate order.** (1) fenced code / diff hunk / function-at-line-start / percentage / progress-phrase on the raw text, (2) JSON parse → `NotJson`, (3) same forbidden scan on JSON string values plus any object key named `progress`/`进度`/`完成度` with a number or string, (4) advise_part field checks, (5) diagnosis sourcing. Code/progress beat `NotJson` so a fenced block is recorded as `contains_code`, not a parse error.

**Code rule.** Fences: ` ``` ` or `~~~`. Hunk: `@@ -<n>[,<m>] +<n>[,<m>] @@`. Function lines, start of line, languages in this repo: `fn` / `pub fn` / `async fn`, `function` / `export function`, `const x = () =>`, `def x(`. After parse, string values are scanned too — otherwise `{"entry_point":"fn foo() {}"}` would slip through. False positive is a visible rejection; false negative puts code on the architecture surface.

**Progress rule.** `\d+\s*[%％]`; `进度`/`完成度`/`progress` adjacent to a number; `\d+/\d+\s*完成`. `完成` alone is not a match, so a criterion like “完成 3 个测试” is not rejected. A JSON `progress: 40` is rejected so map_architecture cannot smuggle a number onto a wire.

**Unsourced rule.** Citations extracted from diagnosis: ISO date, 7–40 hex with at least one digit, slash-paths, filenames with an extension, `c\d+_*` / `test_*`. At least one citation must be a substring of the facts JSON that was sent. Literal `事实不足` in diagnosis skips the citation check and does not skip code/progress checks. I extended `validate(purpose, raw, facts)` relative to the brief’s two-arg sketch; without `facts` the “appears in the facts you sent” clause is not implementable.

**Missing fields.** Whitespace-only is missing. `done_criteria` must be 3–5 non-empty strings; 2 and 6 use `MissingField` (the listed enum) with a count in `detail`.

**Degradation.** `no_key` / `no_profile` / `offline` / `rejected` are values, logged, returned as `LlmCallResult::Unavailable`. The part panel shows a reason line plus `事实 + 手填验收项`. Accepting a proposed item or submitting the hand-fill form goes through `add_criterion` → `upsert_wire` / `WireInput` (still no progress field).

**Key scrub.** Any stored/returned string is `replace(secret, "[redacted]")`. `ChatRequest`’s Debug redacts `authorization`. The key is never a log column.

**No settings UI.** Commands exist to write profiles (via existing `set_app_prefs`), `set_llm_key`, and `set_workspace_llm_profile`. The composer still has the round-1 stub “Extra High Fast / Local stub” dropdown; this package’s UI contract was the part panel, not a provider form. With no profile and no key, advise_part degrades. That is the specified offline behaviour.

**keychain.rs.** Folded into `llm.rs` (`OsKeychain` + test-only `MemoryKeys`). Smaller than a second module.

## 4. Criteria I could not demonstrate live

- No real keychain round-trip on this machine (tests inject `MemoryKeys`). `OsKeychain` compiled against keyring 3.6.3 (`Error::NoEntry`).
- No real HTTP to OpenAI or Ollama. Transport is a trait; tests never open a socket. `HttpTransport::new` is only the production factory.
- No Tauri window. UI behaviour is vitest + Testing Library. I did not click through the desktop app.

## 5. What I got wrong, was unsure about, or did not verify

- First `cargo test` failed `c3_call_log_round_trip`: the stub key was `"k"`, `scrub` replaced every `k` in the JSON, `shared_risk` became `shared_ris[redacted]`, the gate reported `missing field: shared_risk`. Fixed by using a unique secret. A one-character production key would still mutilate logs; C2 still holds (the character would not appear). I did not special-case short keys.
- Citation check is substring-on-`facts.to_string()`. A diagnosis citing `db.rs` matches facts that contain `src/db.rs`. Tighter token-boundary matching would reject some honest citations (paths in JSON are quoted).
- Hex commit-ish requires a digit so `defaced` is not a citation. Still a guess.
- Function-line regex will reject a diagnosis that puts `fn foo` at the start of a line. That is the stated bias.
- `npx tsc --noEmit` initially failed: `DegradedAdvice` took `LlmAdviceView`, so `advice.reason` was not narrowed. Fixed by excluding `{ status: 'available' }`. Vitest does not run `tsc`; the 47 tests were already green. I did not re-run the full 174s vitest after that type-only fix.
- Invalid purpose is a command `Err("unknown llm purpose")`, not `Unavailable`. C1 asks for reject-before-I/O, not for a fifth unavailable reason.
- Composer LLM dropdown is still a stub. Selecting “Local stub” does not set `workspace.llm_profile_id`. Anyone configuring a provider today does it through prefs JSON + `set_llm_key`.
- I did not drive the UI in a real browser or Tauri webview. Closest substitute: PartPanel.test.tsx.

## 6. Brief items I think are off

- `validate(purpose, raw)` as written cannot implement “citation appears in the facts you sent”. The third `facts` argument is required.
- “The rendered part panel contains no `%` while advice is unavailable” fights the existing wire list, which legally prints derived `wireProgress(w)%`. The tests use a part with no wires for that assertion, and also assert the `.llm-advice` section. Hiding derived `%` would be the wrong product change.
- `set_criterion_met` cannot accept a *new* proposed criterion. The write path that preserves the invariant is `WireInput` / `upsert_wire`. That is why `add_criterion` exists.
- Work packages 2/3 (map_architecture UI prefill, draft_goal card, verify_delivery consumption) are stubs at the purpose/gate layer only, as specified.
