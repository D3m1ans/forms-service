import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.DB_PATH = ':memory:'; // до импорта приложения
const { default: app } = await import('../src/app.js');
const { validateAnswers } = await import('../src/validate.js');

const fields = [
    { id: 'n', type: 'text', label: 'Имя', required: true },
    { id: 'e', type: 'email', label: 'Email', required: true },
    { id: 'c', type: 'checkbox', label: 'Навыки', options: ['JS', 'Py'] },
];

async function publishedForm(formFields = fields) {
    const { body: { id } } = await request(app).post('/api/forms').send({ title: 'Тест' });
    await request(app).put(`/api/forms/${id}`).send({ title: 'Тест', fields: formFields });
    const { body: { slug } } = await request(app).post(`/api/forms/${id}/publish`);
    return { id, slug };
}

test('validateAnswers: обязательные, тип и варианты', () => {
    const { errors, clean } = validateAnswers(fields, { n: '', e: 'nope', c: ['Go'], extra: 1 });
    assert.deepEqual(Object.keys(errors).sort(), ['c', 'e', 'n']);
    assert.deepEqual(clean, {});
});

test('validateAnswers: лишние ключи отбрасываются', () => {
    const { errors, clean } = validateAnswers(fields, { n: 'Ян', e: 'a@b.co', extra: 1 });
    assert.deepEqual(errors, {});
    assert.deepEqual(clean, { n: 'Ян', e: 'a@b.co' });
});

test('публикация пустой формы запрещена', async () => {
    const { body: { id } } = await request(app).post('/api/forms').send({});
    await request(app).post(`/api/forms/${id}/publish`).expect(400);
});

test('форма: публикация, валидация и сохранение ответа', async () => {
    const { slug } = await publishedForm();
    await request(app).get(`/api/public/${slug}`).expect(200);
    await request(app).post(`/api/public/${slug}/submit`).send({ answers: { n: '' } }).expect(400);
    await request(app).post(`/api/public/${slug}/submit`).send({ answers: { n: 'Ян', e: 'a@b.co' } }).expect(201);
});

test('неопубликованная форма недоступна', async () => {
    await request(app).get('/api/public/nope').expect(404);
});

test('правка и повторная публикация не ломают старые ответы', async () => {
    const { id, slug } = await publishedForm();
    await request(app).post(`/api/public/${slug}/submit`).send({ answers: { n: 'Ян', e: 'a@b.co' } });

    const renamed = fields.map((f) => (f.id === 'n' ? { ...f, label: 'ФИО' } : f));
    await request(app).put(`/api/forms/${id}`).send({ title: 'Тест', fields: renamed });
    await request(app).post(`/api/forms/${id}/publish`);
    await request(app).post(`/api/public/${slug}/submit`).send({ answers: { n: 'Мария', e: 'm@b.co' } });

    const { body } = await request(app).get(`/api/forms/${id}/responses`);
    assert.deepEqual(body.rows.map((r) => r.answers.n).sort(), ['Мария', 'Ян']);
    assert.equal(body.columns.find((c) => c.id === 'n').label, 'ФИО');
});

test('CSV: значения-формулы экранируются', async () => {
    const { id, slug } = await publishedForm();
    await request(app).post(`/api/public/${slug}/submit`).send({ answers: { n: '=1+1', e: 'a@b.co' } });
    const res = await request(app).get(`/api/forms/${id}/responses.csv`).expect(200);
    assert.ok(res.text.includes(`"'=1+1"`));
});

test('honeypot: ответ бота не сохраняется', async () => {
    const { id, slug } = await publishedForm();
    await request(app).post(`/api/public/${slug}/submit`)
        .send({ answers: { n: 'Бот', e: 'a@b.co' }, website: 'spam.example' }).expect(201);
    const { body } = await request(app).get(`/api/forms/${id}/responses`);
    assert.equal(body.rows.length, 0);
});

test('аналитика: воронка, ошибки и место отказа', async () => {
    const { id, slug } = await publishedForm();
    const send = (sessionId, type, field) =>
        request(app).post(`/api/public/${slug}/events`).send({ sessionId, type, field });

    await send('s1', 'view');                                              // открыл и ушёл
    await send('s2', 'view'); await send('s2', 'focus', 'n'); await send('s2', 'focus', 'e'); // бросил на email
    await send('s3', 'view'); await send('s3', 'focus', 'n');              // ошибка, потом отправил
    await request(app).post(`/api/public/${slug}/submit`).send({ sessionId: 's3', answers: { n: '' } }).expect(400);
    await request(app).post(`/api/public/${slug}/submit`).send({ sessionId: 's3', answers: { n: 'Ян', e: 'a@b.co' } }).expect(201);
    await send('s4', 'hack').expect(400);

    const { body } = await request(app).get(`/api/forms/${id}/stats`);
    assert.deepEqual([body.views, body.started, body.submitted], [3, 2, 1]);
    const byId = Object.fromEntries(body.fields.map((f) => [f.id, f]));
    assert.equal(byId.e.dropped, 1);
    assert.equal(byId.n.errors, 1);
});

test('битый JSON даёт JSON-ошибку, а не падение', async () => {
    const res = await request(app).post('/api/forms').set('Content-Type', 'application/json').send('{oops');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
});