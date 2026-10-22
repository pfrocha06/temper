-- Full-text search over knowledge entries.
CREATE INDEX IF NOT EXISTS knowledge_fts_idx ON knowledge_entries
  USING gin (to_tsvector('english', title || ' ' || abstract || ' ' || body));
--> statement-breakpoint
-- Existing projects join a default environment rooted at the first project's parent folder.
INSERT INTO environments (id, name, root_path)
  SELECT 'env_default', 'default', regexp_replace(repo_path, '/[^/]+/?$', '')
  FROM projects ORDER BY created_at LIMIT 1;
--> statement-breakpoint
UPDATE projects SET environment_id = 'env_default' WHERE environment_id IS NULL;
--> statement-breakpoint
-- The Planner role is replaced by the Chief of Staff (seeded on boot).
DELETE FROM agents WHERE id = 'planner';
