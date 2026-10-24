const root = document.getElementById('root');
const slug = location.pathname.split('/')[2];

const sessionId = sessionStorage.getItem('sid') ?? crypto.randomUUID();
sessionStorage.setItem('sid', sessionId);

const track = (type, field) => fetch(`/api/public/${slug}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, type, field }),
    keepalive: true,
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function control(f) {
    const name = esc(f.id);
    switch (f.type) {
        case 'textarea':
            return `<textarea name="${name}" rows="4"></textarea>`;
        case 'select':
            return `<select name="${name}"><option value="">—</option>
        ${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
        case 'radio':
        case 'checkbox':
            return f.options.map((o) =>
                `<label class="opt"><input type="${f.type}" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
        default:
            return `<input type="${f.type}" name="${name}">`;
    }
}

async function main() {
    const res = await fetch(`/api/public/${slug}`);
    if (!res.ok) {
        root.innerHTML = '<h1>Форма не найдена</h1>';
        return;
    }
    const schema = await res.json();
    document.title = schema.title;

    root.innerHTML = `
    <h1>${esc(schema.title)}</h1>
    <progress id="bar" max="${schema.fields.length}" value="0"></progress>
    <form id="form" novalidate>
      ${schema.fields.map((f) => `
        <div class="question">
          <div><b>${esc(f.label)}</b>${f.required ? ' *' : ''}</div>
          ${control(f)}
          <div class="error" data-err="${esc(f.id)}"></div>
        </div>`).join('')}
      <input class="hp" name="website" tabindex="-1" autocomplete="off">
      <button>Отправить</button>
    </form>`;

    const form = document.getElementById('form');

    const collect = () => {
        const data = new FormData(form);
        return Object.fromEntries(schema.fields.map((f) => [
            f.id,
            f.type === 'checkbox' ? data.getAll(f.id) : data.get(f.id) ?? '',
        ]));
    };

   
    const draftKey = `draft:${slug}`;
    const bar = document.getElementById('bar');
    const refreshBar = () => { bar.value = Object.values(collect()).filter((v) => v.length).length; };

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { }
    for (const f of schema.fields) {
        for (const el of form.querySelectorAll(`[name="${f.id}"]`)) {
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = [].concat(saved[f.id] ?? []).includes(el.value);
            else el.value = saved[f.id] ?? '';
        }
    }
    refreshBar();

    form.oninput = () => {
        localStorage.setItem(draftKey, JSON.stringify(collect()));
        refreshBar();
    };

    // Аналитика: открытие формы и первый заход в каждое поле
    track('view');
    const seen = new Set();
    form.addEventListener('focusin', (e) => {
        const id = e.target.name;
        if (id && !seen.has(id)) {
            seen.add(id);
            track('focus', id);
        }
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true; 
        form.querySelectorAll('.error').forEach((el) => { el.textContent = ''; });

        const res = await fetch(`/api/public/${slug}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: collect(), sessionId, website: form.elements.website.value }),
        });

        if (res.ok) {
            localStorage.removeItem(draftKey);
            root.innerHTML = '<h1>Спасибо! Ответ отправлен.</h1>';
            return;
        }
        const { errors } = await res.json();
        for (const [id, message] of Object.entries(errors || {})) {
            form.querySelector(`[data-err="${id}"]`).textContent = message;
        }
        button.disabled = false;
    };
}

main();
