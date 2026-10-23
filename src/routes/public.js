import { Router } from 'express';
import db from '../db.js';
import { validateAnswers } from '../validate.js';

const router = Router();

function logEvent(formId, sessionId, type, field = null) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 64) return;
    db.prepare('INSERT INTO events (form_id, session_id, type, field_id) VALUES (?, ?, ?, ?)')
        .run(formId, sessionId, type, field);
}

function loadVersion(req, res, next) {
    req.version = db.prepare(`
        SELECT v.* FROM form_versions v JOIN forms f ON f.id = v.form_id
        WHERE f.slug = ? ORDER BY v.id DESC LIMIT 1
    `).get(req.params.slug);
    if (!req.version) return res.status(404).json({ error: 'Форма не найдена' });
    next();
}

router.get('/:slug', loadVersion, (req, res) => {
    res.json({ title: req.version.title, fields: JSON.parse(req.version.fields) });
});

router.post('/:slug/submit', loadVersion, (req, res) => {
    const fields = JSON.parse(req.version.fields);
    const { answers, sessionId, website } = req.body;
    if (website) return res.status(201).json({ ok: true }); // honeypot: человек это поле не видит
    const { errors, clean } = validateAnswers(fields, answers);
    const errorIds = Object.keys(errors);
    if (errorIds.length) {
        errorIds.forEach((id) => logEvent(req.version.form_id, sessionId, 'error', id));
        return res.status(400).json({ errors });
    }
    db.prepare('INSERT INTO responses (version_id, answers) VALUES (?, ?)')
        .run(req.version.id, JSON.stringify(clean));
    logEvent(req.version.form_id, sessionId, 'submit');
    res.status(201).json({ ok: true });
});

// События, которые присылает браузер: открытие формы и первый заход в поле
router.post('/:slug/events', loadVersion, (req, res) => {
    const { sessionId, type, field } = req.body;
    if (!['view', 'focus'].includes(type)) return res.status(400).json({ error: 'Неизвестное событие' });
    logEvent(req.version.form_id, sessionId, type, typeof field === 'string' ? field.slice(0, 64) : null);
    res.status(204).end();
});

export default router;