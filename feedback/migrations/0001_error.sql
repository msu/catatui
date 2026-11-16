-- Add the error column (kind error). Run before the deploy of the Worker that writes it:
-- npx wrangler d1 execute catai-feedback --remote --file migrations/0001_error.sql
ALTER TABLE reports ADD COLUMN error TEXT;
