-- Adds public URL slug column. Numeric `id` stays the primary key and FK target.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

-- Slug backfill, unique index, and NOT NULL are applied by `db.ensure_schema()` on API startup.
-- To migrate without starting the app, run the Python backfill from a shell or duplicate its logic here.
