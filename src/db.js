import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });

const db = new Database(process.env.DB_PATH ?? dataDir + 'app.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS forms
    (
        id
        INTEGER
        PRIMARY
        KEY,
        title
        TEXT
        NOT
        NULL,
        fields
        TEXT
        NOT
        NULL
        DEFAULT
        '[]',
        slug
        TEXT
        UNIQUE,
        status
        TEXT
        NOT
        NULL
        DEFAULT
        'draft'
    );
    CREATE TABLE IF NOT EXISTS form_versions
    (
        id
        INTEGER
        PRIMARY
        KEY,
        form_id
        INTEGER
        NOT
        NULL
        REFERENCES
        forms
    (
        id
    ) ON DELETE CASCADE,
        title TEXT NOT NULL,
        fields TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    CREATE TABLE IF NOT EXISTS events
    (
        id
        INTEGER
        PRIMARY
        KEY,
        form_id
        INTEGER
        NOT
        NULL
        REFERENCES
        forms
    (
        id
    ) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        field_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    CREATE INDEX IF NOT EXISTS idx_events_form ON events(form_id);
    CREATE TABLE IF NOT EXISTS responses
    (
        id
        INTEGER
        PRIMARY
        KEY,
        version_id
        INTEGER
        NOT
        NULL
        REFERENCES
        form_versions
    (
        id
    ) ON DELETE CASCADE,
        answers TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
`);

export default db;