-- Which devices a campaign asks testers to cover: 'desktop' or 'desktop_mobile'.
ALTER TABLE campaigns ADD COLUMN devices TEXT NOT NULL DEFAULT 'desktop';
