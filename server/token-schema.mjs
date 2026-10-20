export function ensureTokenSchema(store) {
  const db = store.db;
  const projectId = db
    .prepare('PRAGMA table_info(auth_tokens)')
    .all()
    .find((column) => column.name === 'project_id');
  if (!projectId?.notnull) return;

  store.transaction(() => {
    db.exec(`
      CREATE TABLE auth_tokens_next(
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL REFERENCES auth_users(id),
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('read','write')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO auth_tokens_next(
        id, token_hash, user_id, project_id, name, scope, created_at, expires_at
      )
      SELECT id, token_hash, user_id, project_id, name, scope, created_at, expires_at
      FROM auth_tokens;
      DROP TABLE auth_tokens;
      ALTER TABLE auth_tokens_next RENAME TO auth_tokens;
    `);
  });
}
