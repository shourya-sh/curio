-- Canonical layout coordinates (agent / auto-layout). User drags update position_x/y only.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS original_position_x DOUBLE PRECISION;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS original_position_y DOUBLE PRECISION;
UPDATE nodes SET original_position_x = position_x WHERE original_position_x IS NULL;
UPDATE nodes SET original_position_y = position_y WHERE original_position_y IS NULL;
ALTER TABLE nodes ALTER COLUMN original_position_x SET DEFAULT 0;
ALTER TABLE nodes ALTER COLUMN original_position_y SET DEFAULT 0;
ALTER TABLE nodes ALTER COLUMN original_position_x SET NOT NULL;
ALTER TABLE nodes ALTER COLUMN original_position_y SET NOT NULL;
