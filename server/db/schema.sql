-- 雪花画布书稿库。只建在数据库 snowflake 里，不碰 gbrain 所在的 postgres 库。

CREATE TABLE IF NOT EXISTS series (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book (
  id text PRIMARY KEY,
  series_id text REFERENCES series (id),
  title text NOT NULL DEFAULT '',
  document_text text NOT NULL DEFAULT '',
  target_words integer NOT NULL DEFAULT 0,
  ending_type text NOT NULL DEFAULT '',
  forbidden text NOT NULL DEFAULT '',
  style_sample text NOT NULL DEFAULT '',
  book_version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chapter (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  ord integer NOT NULL DEFAULT 0,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS scene (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  chapter_id text REFERENCES chapter (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  ord integer NOT NULL DEFAULT 0,
  body text NOT NULL DEFAULT '',
  step text NOT NULL DEFAULT '',
  failure boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS scene_revision (
  id text PRIMARY KEY,
  scene_id text NOT NULL REFERENCES scene (id) ON DELETE CASCADE,
  rev integer NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  session_id text,
  request_id text,
  quote text NOT NULL DEFAULT '',
  source_offset integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  layer text NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  scene_id text,
  rev integer NOT NULL DEFAULT 1,
  needs_review boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS card_scene (
  card_id text NOT NULL REFERENCES card (id) ON DELETE CASCADE,
  scene_id text NOT NULL REFERENCES scene (id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, scene_id)
);

CREATE TABLE IF NOT EXISTS entity (
  id text PRIMARY KEY,
  book_id text REFERENCES book (id) ON DELETE CASCADE,
  series_id text REFERENCES series (id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('book', 'series')),
  name text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  CHECK (scope <> 'book' OR book_id IS NOT NULL),
  CHECK (scope <> 'series' OR series_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS entity_revision (
  id text PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entity (id) ON DELETE CASCADE,
  rev integer NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  source text NOT NULL DEFAULT '',
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relation (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  from_entity text,
  to_entity text,
  plant_scene_id text,
  payoff_scene_id text,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS discussion (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  card_id text,
  entity_id text,
  session_id text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS provenance (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('手写', '采纳', '扩写', '导入')),
  scene_revision_id text,
  entity_revision_id text,
  session_id text,
  request_id text,
  quote text NOT NULL DEFAULT '',
  source_offset integer
);

CREATE TABLE IF NOT EXISTS op_log (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  before_json jsonb NOT NULL,
  after_json jsonb NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suggestion (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  scene_id text,
  entity_id text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS structure_frame (
  book_id text PRIMARY KEY REFERENCES book (id) ON DELETE CASCADE,
  kind text NOT NULL,
  points text NOT NULL DEFAULT '',
  source_slug text NOT NULL DEFAULT '',
  dismissed jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS layout (
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  node_id text NOT NULL,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, node_id)
);

CREATE TABLE IF NOT EXISTS embedding (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id text NOT NULL,
  chunk text NOT NULL,
  embedding vector(1024)
);

CREATE INDEX IF NOT EXISTS scene_body_trgm ON scene USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS card_body_trgm ON card USING gin (body gin_trgm_ops);
