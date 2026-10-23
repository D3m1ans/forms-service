const app = document.getElementById('app');

const TYPES = {
    text: 'Короткий текст', textarea: 'Длинный текст', email: 'Email', number: 'Число',
    select: 'Выпадающий список', radio: 'Один вариант', checkbox: 'Несколько вариантов',
};
const hasOptions = (type) => ['select', 'radio', 'checkbox'].includes(type);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
}

// ---------- Список форм ----------
async function renderList() {
    const forms = await api('/forms');
    app.innerHTML = `
    <h1>Формы</h1>
    <p><button data-act="create">+ Новая форма</button></p>
    <table>
      <tr><th>Название</th><th>Статус</th><th>Ответы</th><th>Аналитика</th><th></th></tr>
      ${forms.map((f) => `
        <tr>
          <td><a href="#/forms/${f.id}">${esc(f.title)}</a></td>
          <td>${f.status === 'published' ? `<a href="/f/${f.slug}" target="_blank">опубликована</a>` : 'черновик'}</td>
          <td><a href="#/forms/${f.id}/responses">${f.responses}</a></td>
          <td><a href="#/forms/${f.id}/stats">открыть</a></td>
          <td><button data-act="delete" data-id="${f.id}">Удалить</button></td>
        </tr>`).join('')}
    </table>`;

    app.oninput = null;
    app.onclick = async (e) => {
        const { act, id } = e.target.dataset;
        if (act === 'create') {
            const { id: newId } = await api('/forms', 'POST', { title: 'Новая форма' });
            location.hash = `#/forms/${newId}`;
        }
        if (act === 'delete' && confirm('Удалить форму вместе с ответами?')) {
            await api(`/forms/${id}`, 'DELETE');
            renderList();
        }
    };
}

// ---------- Конструктор ----------
async function renderEditor(id) {
    const form = await api(`/forms/${id}`);

    const fieldRow = (f, i) => `
    <div class="field" data-i="${i}">
      <select data-k="type">
        ${Object.entries(TYPES).map(([t, name]) =>
        `<option value="${t}" ${t === f.type ? 'selected' : ''}>${name}</option>`).join('')}
      </select>
      <input data-k="label" value="${esc(f.label)}" placeholder="Подпись поля">
      <label><input type="checkbox" data-k="required" ${f.required ? 'checked' : ''}> обязательное</label>
      ${hasOptions(f.type)
        ? `<textarea data-k="options" rows="3" placeholder="Варианты, по одному в строке">${esc((f.options || []).join('\n'))}</textarea>`
        : ''}
      <button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button>
    </div>`;

    const draw = () => {
        app.innerHTML = `
      <p><a href="#/">← К списку</a></p>
      <input id="title" class="title" value="${esc(form.title)}">
      <div id="fields">${form.fields.map(fieldRow).join('')}</div>
      <p><button data-act="add">+ Добавить поле</button></p>
      <p><button data-act="save">Сохранить</button> <button data-act="publish">Опубликовать</button></p>
      <div id="msg"></div>`;
    };

    // Перед сохранением приводим варианты ответа к списку и убираем лишнее
    const cleanFields = () => form.fields.map(({ options, ...f }) => hasOptions(f.type)
        ? { ...f, options: (options || []).map((s) => s.trim()).filter(Boolean) }
        : f);

    const save = () => api(`/forms/${id}`, 'PUT', { title: form.title, fields: cleanFields() });
    const say = (html) => { document.getElementById('msg').innerHTML = html; };

    app.oninput = (e) => {
        if (e.target.id === 'title') form.title = e.target.value;
        const row = e.target.closest('.field');
        if (!row) return;
        const f = form.fields[row.dataset.i];
        const k = e.target.dataset.k;
        if (k === 'required') f.required = e.target.checked;
        else if (k === 'options') f.options = e.target.value.split('\n');
        else f[k] = e.target.value;
        if (k === 'type') draw(); // у разных типов разный набор настроек
    };

    app.onclick = async (e) => {
        const { act } = e.target.dataset;
        const i = Number(e.target.closest('.field')?.dataset.i);
        try {
            if (act === 'add') {
                form.fields.push({ id: crypto.randomUUID(), type: 'text', label: '', required: false });
                draw();
            } else if (act === 'del') {
                form.fields.splice(i, 1);
                draw();
            } else if (act === 'up' || act === 'down') {
                const j = act === 'up' ? i - 1 : i + 1;
                if (j < 0 || j >= form.fields.length) return;
                [form.fields[i], form.fields[j]] = [form.fields[j], form.fields[i]];
                draw();
            } else if (act === 'save') {
                await save();
                say('Сохранено');
            } else if (act === 'publish') {
                await save();
                const { url } = await api(`/forms/${id}/publish`, 'POST');
                const link = location.origin + url;
                say(`<p>Опубликовано:</p><input id="link" value="${esc(link)}" readonly>
             <button data-act="copy">Копировать</button>`);
            } else if (act === 'copy') {
                await navigator.clipboard.writeText(document.getElementById('link').value);
            }
        } catch (err) {
            say(`<p class="error">${esc(err.message)}</p>`);
        }
    };

    draw();
}

// ---------- Ответы ----------
async function renderResponses(id) {
    const { columns, rows } = await api(`/forms/${id}/responses`);
    const show = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');

    app.innerHTML = `
    <p><a href="#/">← К списку</a> · <a href="/api/forms/${id}/responses.csv">Скачать CSV</a></p>
    <h1>Ответы (${rows.length})</h1>
    <div class="scroll"><table>
      <tr><th>Дата</th>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
      ${rows.map((r) => `
        <tr><td>${esc(r.createdAt)}</td>
        ${columns.map((c) => `<td>${esc(show(r.answers[c.id]))}</td>`).join('')}</tr>`).join('')}
    </table></div>`;
    app.oninput = app.onclick = null;
}

// ---------- Аналитика ----------
async function renderStats(id) {
    const { views, started, submitted, fields } = await api(`/forms/${id}/stats`);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    const worst = fields.reduce((a, b) => (b.dropped > a.dropped ? b : a), { dropped: 0 });

    app.innerHTML = `
    <p><a href="#/">← К списку</a></p>
    <h1>Аналитика</h1>
    <p>Открыли: <b>${views}</b> → начали: <b>${started}</b> (${pct(started, views)})
       → отправили: <b>${submitted}</b> (${pct(submitted, started)} от начавших)</p>
    ${worst.dropped
        ? `<p>Чаще всего форму бросают на поле «${esc(worst.label)}»: ${worst.dropped} из ${started - submitted}.</p>`
        : ''}
    <table>
      <tr><th>Поле</th><th>Дошли</th><th>Бросили здесь</th><th>Ошибки валидации</th></tr>
      ${fields.map((f) => `
        <tr><td>${esc(f.label)}</td><td>${f.reached}</td><td>${f.dropped}</td><td>${f.errors}</td></tr>`).join('')}
    </table>`;
    app.oninput = app.onclick = null;
}

// ---------- Роутинг по hash ----------
async function route() {
    const [, page, id, sub] = location.hash.split('/'); // #/forms/3/responses
    try {
        if (page === 'forms' && sub === 'responses') await renderResponses(id);
        else if (page === 'forms' && sub === 'stats') await renderStats(id);
        else if (page === 'forms') await renderEditor(id);
        else await renderList();
    } catch (err) {
        app.innerHTML = `<p class="error">${esc(err.message)}</p><p><a href="#/">← К списку</a></p>`;
    }
}

addEventListener('hashchange', route);
route();