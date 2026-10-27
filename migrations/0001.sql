CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, automation_id TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'demo', created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS deliveries_automation_status ON deliveries (automation_id, status);
CREATE INDEX IF NOT EXISTS deliveries_mode_created ON deliveries (mode, created_at);
CREATE TABLE IF NOT EXISTS webhook_events (event_key TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, error_code TEXT);
CREATE TABLE IF NOT EXISTS pending_flows (id TEXT PRIMARY KEY, comment_id TEXT NOT NULL UNIQUE, recipient_id TEXT NOT NULL, automation_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pending_flows_recipient_status ON pending_flows (recipient_id, status, expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states (expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_attempts_expiry ON auth_attempts (expires_at);

CREATE INDEX IF NOT EXISTS pending_flows_automation_status ON pending_flows (automation_id, status, expires_at);
