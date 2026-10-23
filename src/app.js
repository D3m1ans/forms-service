import express from 'express';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

const app = express();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

// Страницы не используют inline-скрипты и стили, поэтому разрешаем только свои ресурсы
app.use((req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'");
    res.set('X-Content-Type-Options', 'nosniff');
    next();
});
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { req.body ??= {}; next(); }); // запрос без тела не должен ронять обработчики
app.use(express.static(publicDir));

app.use('/api', adminRoutes);
app.use('/api/public', rateLimit({ windowMs: 60_000, limit: 120 }), publicRoutes);

app.get('/admin', (req, res) => res.sendFile(publicDir + 'admin.html'));
app.get('/f/:slug', (req, res) => res.sendFile(publicDir + 'form.html'));
app.get('/', (req, res) => res.redirect('/admin'));

// Любая ошибка (например, битый JSON) отдаётся как JSON, а не как HTML со стеком
app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.status ? 'Некорректный запрос' : 'Ошибка сервера' });
});

export default app;