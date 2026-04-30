-- Run against your Curio / Supabase Postgres database once.
ALTER TABLE node_links ADD COLUMN IF NOT EXISTS color VARCHAR(20);
ALTER TABLE node_links ADD COLUMN IF NOT EXISTS line_style VARCHAR(20) NOT NULL DEFAULT 'solid';
