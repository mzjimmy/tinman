-- Single migration. wire.progress is a derived cache of met/total criteria.
-- Callers must never supply a progress value; the persistence layer always recomputes it.

CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  llm_profile_id TEXT,
  prefs_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  label TEXT NOT NULL,
  weight REAL NOT NULL,
  planned_start TEXT,
  status TEXT NOT NULL CHECK (status IN ('unmapped', 'pending', 'in_progress', 'done', 'blocked')),
  UNIQUE (workspace_id, slot)
);

CREATE TABLE IF NOT EXISTS wire (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES part(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  progress INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unmapped', 'pending', 'in_progress', 'done', 'blocked')),
  evidence_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  part_id TEXT,
  wire_id TEXT,
  goal_json TEXT NOT NULL,
  state TEXT NOT NULL,
  station TEXT,
  worktree_path TEXT,
  dispatched_at TEXT,
  finished_at TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_part_workspace ON part(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wire_part ON wire(part_id);
CREATE INDEX IF NOT EXISTS idx_task_workspace ON task(workspace_id);

-- Fifth table: LLM call log. The four core tables are the domain; every model
-- call's input, output and gate verdict must be reviewable, so they cannot live
-- on workspace/part/wire/task. Existing databases pick this up on reopen
-- because open() re-runs this file and the statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS llm_call (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  provider_id TEXT,
  model TEXT,
  request_json TEXT NOT NULL,
  response_text TEXT,
  verdict TEXT NOT NULL,
  reject_reason TEXT,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_call_workspace ON llm_call(workspace_id, created_at);
