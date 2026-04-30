-- Idempotent DDL for Curio link appearance (matches repo migrations/).
ALTER TABLE node_links ADD COLUMN IF NOT EXISTS color VARCHAR(20);
ALTER TABLE node_links ADD COLUMN IF NOT EXISTS line_style VARCHAR(20) NOT NULL DEFAULT 'solid';
