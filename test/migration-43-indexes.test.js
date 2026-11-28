// Migration 43 adds indexes only. Each lookup that used to scan a whole table now uses its index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, SCHEMA_VERSION } from '../server/db.js';

const plan = (db, sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');

test('migration 43: the slow lookups use their indexes', () => {
  assert.ok(SCHEMA_VERSION >= 43);
  const db = openDb(':memory:');
  const cases = [
    ['checkins_service', "SELECT person_id FROM checkins k WHERE k.service_id = ? AND k.kind = 'kid'", [1]],
    ['messages_reply', 'SELECT id FROM messages WHERE reply_to = ?', [1]],
    ['message_files_message', 'SELECT file FROM message_files WHERE message_id = ?', [1]],
    ['push_subscriptions_user', 'SELECT id FROM push_subscriptions WHERE user_id = ?', [1]],
  ];
  for (const [index, sql, args] of cases) {
    const detail = plan(db, sql, ...args);
    assert.match(detail, new RegExp(`USING (COVERING )?INDEX ${index}\\b`), `${index}: ${detail}`);
  }
  db.close();
});
