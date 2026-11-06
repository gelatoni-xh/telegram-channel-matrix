CREATE TABLE IF NOT EXISTS matrix_schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS matrix_runs (
  id uuid PRIMARY KEY, operating_date date NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz, status text NOT NULL, report jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS matrix_publications (
  channel text NOT NULL CHECK (channel IN ('ai','steam')), operating_date date NOT NULL,
  kind text NOT NULL DEFAULT 'daily_digest' CHECK (kind = 'daily_digest'),
  chat_id bigint NOT NULL, status text NOT NULL CHECK(status IN ('sending','sent','failed','uncertain')),
  message_id bigint, sent_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL REFERENCES matrix_runs(id), payload jsonb NOT NULL,
  PRIMARY KEY(channel, operating_date, kind),
  CHECK(status <> 'sent' OR (message_id > 0 AND sent_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS matrix_publication_items (
  channel text NOT NULL, operating_date date NOT NULL, kind text NOT NULL DEFAULT 'daily_digest',
  fingerprint text NOT NULL, position integer NOT NULL, candidate jsonb NOT NULL,
  PRIMARY KEY(channel, operating_date, kind, fingerprint),
  FOREIGN KEY(channel, operating_date, kind) REFERENCES matrix_publications(channel, operating_date, kind)
);
CREATE INDEX IF NOT EXISTS matrix_item_history ON matrix_publication_items(channel, fingerprint);
INSERT INTO matrix_schema_version(version) VALUES (1) ON CONFLICT DO NOTHING;
