import {Router} from 'express';
import {randomBytes} from 'node:crypto';
import db from '../db.js';
import {validateSchema} from '../validate.js';

const router = Router();

const parse = (form) => ({...form, fields: JSON.parse(form.fields)});

function loadForm(req, res, next) {
    req.form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!req.form) return res.status(404).json({error: 'Форма не найдена'});
    next();
}

router.get('/forms', (req, res) => {
    const rows = db.prepare(`
        SELECT f.id,
               f.title,
               f.slug,
               f.status,
               (SELECT COUNT(*)
                FROM responses r
                         JOIN form_versions v ON v.id = r.version_id
                WHERE v.form_id = f.id) AS responses
        FROM forms f
        ORDER BY f.id DESC
    `).all();
    res.json(rows);
});

router.post('/forms', (req, res) => {
    const title = String(req.body.title || '').trim() || 'Новая форма';
    const {lastInsertRowid} = db.prepare('INSERT INTO forms (title) VALUES (?)').run(title);
    res.status(201).json({id: lastInsertRowid});
});

router.get('/forms/:id', loadForm, (req, res) => res.json(parse(req.form)));

router.put('/forms/:id', loadForm, (req, res) => {
    const error = validateSchema(req.body);
    if (error) return res.status(400).json({error});
    db.prepare('UPDATE forms SET title = ?, fields = ? WHERE id = ?')
        .run(req.body.title.trim(), JSON.stringify(req.body.fields), req.form.id);
    res.json({ok: true});
});

router.delete('/forms/:id', loadForm, (req, res) => {
    db.prepare('DELETE FROM forms WHERE id = ?').run(req.form.id);
    res.json({ok: true});
});

router.post('/forms/:id/publish', loadForm, (req, res) => {
    const {title, fields} = req.form;
    if (!JSON.parse(fields).length) return res.status(400).json({error: 'Добавьте хотя бы одно поле'});
    const slug = req.form.slug || randomBytes(6).toString('base64url');
    db.transaction(() => {
        db.prepare('INSERT INTO form_versions (form_id, title, fields) VALUES (?, ?, ?)')
            .run(req.form.id, title, fields);
        db.prepare("UPDATE forms SET slug = ?, status = 'published' WHERE id = ?")
            .run(slug, req.form.id);
    })();
    res.json({slug, url: `/f/${slug}`});
});

function collectResponses(formId) {
    const rows = db.prepare(`
        SELECT r.id, r.answers, r.created_at, v.fields
        FROM responses r
                 JOIN form_versions v ON v.id = r.version_id
        WHERE v.form_id = ?
        ORDER BY r.id DESC
    `).all(formId);

    const columns = new Map(); 
    for (const r of [...rows].reverse()) {
        for (const f of JSON.parse(r.fields)) columns.set(f.id, f.label);
    }
    return {
        columns: [...columns].map(([id, label]) => ({id, label})),
        rows: rows.map((r) => ({id: r.id, createdAt: r.created_at, answers: JSON.parse(r.answers)})),
    };
}

router.get('/forms/:id/responses', loadForm, (req, res) => {
    res.json(collectResponses(req.form.id));
});

const csvCell = (v) => {
    let s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
};

router.get('/forms/:id/responses.csv', loadForm, (req, res) => {
    const {columns, rows} = collectResponses(req.form.id);
    const lines = [
        ['Дата', ...columns.map((c) => c.label)],
        ...rows.map((r) => [r.createdAt, ...columns.map((c) => r.answers[c.id])]),
    ];
    res.type('text/csv; charset=utf-8').attachment('responses.csv')
        .send('\uFEFF' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'));
});

// Воронка и отказы по полям: события группируются по сессиям
router.get('/forms/:id/stats', loadForm, (req, res) => {
    const events = db.prepare(
        'SELECT session_id, type, field_id FROM events WHERE form_id = ? ORDER BY id',
    ).all(req.form.id);

    const sessions = new Map();
    for (const e of events) {
        if (!sessions.has(e.session_id)) sessions.set(e.session_id, {focused: [], errors: new Set(), submitted: false});
        const s = sessions.get(e.session_id);
        if (e.type === 'focus') s.focused.push(e.field_id);
        if (e.type === 'error') s.errors.add(e.field_id);
        if (e.type === 'submit') s.submitted = true;
    }

    const fields = new Map(); // подписи берём по всем версиям формы
    const versions = db.prepare('SELECT fields FROM form_versions WHERE form_id = ? ORDER BY id').all(req.form.id);
    for (const v of versions) {
        for (const f of JSON.parse(v.fields)) {
            fields.set(f.id, {id: f.id, label: f.label, reached: 0, dropped: 0, errors: 0});
        }
    }

    const bump = (id, key) => {
        if (fields.has(id)) fields.get(id)[key]++;
    };

    let started = 0;
    let submitted = 0;
    for (const s of sessions.values()) {
        if (s.focused.length) started++;
        if (s.submitted) submitted++;
        new Set(s.focused).forEach((id) => bump(id, 'reached'));
        s.errors.forEach((id) => bump(id, 'errors'));
        // «бросил» = начал, но не отправил; считаем на последнем поле, до которого дошёл
        if (s.focused.length && !s.submitted) bump(s.focused.at(-1), 'dropped');
    }
    res.json({views: sessions.size, started, submitted, fields: [...fields.values()]});
});


export default router;
