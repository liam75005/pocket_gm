CREATE TABLE characters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  species          TEXT NOT NULL,
  subrace          TEXT,
  class            TEXT NOT NULL,
  subclass         TEXT,
  background       TEXT NOT NULL,
  level            INTEGER NOT NULL DEFAULT 1,

  -- Ability scores (final values after background bonuses)
  str              INTEGER NOT NULL,
  dex              INTEGER NOT NULL,
  con              INTEGER NOT NULL,
  int              INTEGER NOT NULL,
  wis              INTEGER NOT NULL,
  cha              INTEGER NOT NULL,

  -- Derived stats (computed at creation, stored for prompt)
  hp_max           INTEGER NOT NULL,
  ac               INTEGER NOT NULL,
  speed            INTEGER NOT NULL,

  -- Proficiencies
  saving_throw_profs  TEXT[] NOT NULL DEFAULT '{}',
  skill_profs         TEXT[] NOT NULL DEFAULT '{}',
  armor_profs         TEXT[] NOT NULL DEFAULT '{}',
  weapon_profs        TEXT[] NOT NULL DEFAULT '{}',
  tool_profs          TEXT[] NOT NULL DEFAULT '{}',

  -- Equipment
  equipment        JSONB NOT NULL DEFAULT '[]',

  -- Features (class + species + background)
  features         JSONB NOT NULL DEFAULT '[]',

  -- Spells (null for non-casters)
  cantrips         TEXT[],
  spells_known     TEXT[],
  spell_slots      JSONB,  -- { "1": 2 } = 2 level-1 slots

  -- Meta
  is_pregenerated  BOOLEAN NOT NULL DEFAULT false,
  campaign         TEXT,   -- e.g. "five_oaks"
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_characters"
  ON characters FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- saves.character_id is TEXT but should be migrated to UUID for consistency
-- with campaign_progress.character_id.
ALTER TABLE saves ALTER COLUMN character_id TYPE UUID USING character_id::UUID;
ALTER TABLE saves ADD CONSTRAINT saves_character_id_fkey
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
