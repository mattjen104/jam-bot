import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive, repeatable DDL for the source-respecting Press article ledger. */
export async function applyRssArticlesMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rss_articles (
      id serial PRIMARY KEY,
      picker_id integer NOT NULL REFERENCES pickers(id),
      guid text NOT NULL,
      url text NOT NULL,
      title text NOT NULL,
      published_at timestamp,
      tags text[],
      matched_artist text,
      matched_work text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS rss_articles_picker_guid_uq ON rss_articles (picker_id, guid)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS rss_articles_picker_url_uq ON rss_articles (picker_id, url)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rss_articles_picker_published_idx ON rss_articles (picker_id, published_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rss_articles_published_idx ON rss_articles (published_at DESC)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rss_article_bookmarks (
      user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      article_id integer NOT NULL REFERENCES rss_articles(id) ON DELETE CASCADE,
      saved_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, article_id)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rss_article_bookmarks_user_saved_idx ON rss_article_bookmarks (user_id, saved_at DESC)`);
  // RSS publications are now source-directed article ledgers, not inputs to
  // the legacy article-page scraper. Preserve old queue rows for audit/history
  // while ensuring none can be picked up after this migration.
  await db.execute(sql`
    UPDATE blog_list_candidates AS candidate
    SET status = 'skipped',
        processed_at = COALESCE(candidate.processed_at, now()),
        note = 'retired: RSS publications are source-directed Press articles'
    FROM pickers AS publication
    WHERE candidate.picker_id = publication.id
      AND publication.picker_type = 'blog'
      AND publication.source_ref->>'feedUrl' IS NOT NULL
      AND candidate.status = 'pending'
  `);
}