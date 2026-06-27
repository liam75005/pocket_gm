CREATE TABLE saves (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
  character_id  TEXT NOT NULL,
  state         JSONB NOT NULL,
  log_html      TEXT,
  turn_count    INTEGER DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slot)
);

ALTER TABLE saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_saves"
  ON saves FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
