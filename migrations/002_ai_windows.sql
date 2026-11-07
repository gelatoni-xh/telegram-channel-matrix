BEGIN;

ALTER TABLE matrix_publication_items
  DROP CONSTRAINT matrix_publication_items_channel_operating_date_kind_fkey,
  DROP CONSTRAINT matrix_publication_items_pkey;
ALTER TABLE matrix_publications DROP CONSTRAINT matrix_publications_pkey;

ALTER TABLE matrix_publications ADD COLUMN window_id text NOT NULL DEFAULT 'daily';
UPDATE matrix_publications SET window_id = 'morning' WHERE channel = 'ai';
ALTER TABLE matrix_publications ADD CONSTRAINT matrix_publications_window_id_check
  CHECK (window_id IN ('morning','afternoon','evening','daily'));
ALTER TABLE matrix_publications ADD PRIMARY KEY(channel, operating_date, window_id, kind);

ALTER TABLE matrix_publication_items ADD COLUMN window_id text NOT NULL DEFAULT 'daily';
UPDATE matrix_publication_items i SET window_id = p.window_id
  FROM matrix_publications p
  WHERE i.channel = p.channel AND i.operating_date = p.operating_date AND i.kind = p.kind;
ALTER TABLE matrix_publication_items ADD PRIMARY KEY(channel, operating_date, window_id, kind, fingerprint);
ALTER TABLE matrix_publication_items ADD CONSTRAINT matrix_publication_items_publication_fkey
  FOREIGN KEY(channel, operating_date, window_id, kind)
  REFERENCES matrix_publications(channel, operating_date, window_id, kind);

INSERT INTO matrix_schema_version(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
