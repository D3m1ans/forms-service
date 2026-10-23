const text = (v) => typeof v === 'string' && v.length <= 5000;
const inOptions = (v, f) => f.options.includes(v);

const checks = {
    text,
    textarea: text,
    email: (v) => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    number: (v) => v !== '' && Number.isFinite(Number(v)),
    select: inOptions,
    radio: inOptions,
    checkbox: (v, f) => Array.isArray(v) && v.every((x) => f.options.includes(x)),
};
const withOptions = ['select', 'radio', 'checkbox'];

export function validateSchema({ title, fields }) {
    if (typeof title !== 'string' || !title.trim()) return 'Нужно название формы';
    if (!Array.isArray(fields)) return 'fields должен быть массивом';
    for (const f of fields) {
        if (!(f.type in checks)) return `Неизвестный тип поля: ${f.type}`;
        if (typeof f.id !== 'string' || !f.id) return 'У поля нет id';
        if (typeof f.label !== 'string' || !f.label.trim()) return 'У поля нет подписи';
        if (withOptions.includes(f.type) && !(Array.isArray(f.options) && f.options.length)) {
            return `У поля «${f.label}» нет вариантов ответа`;
        }
    }
    return null;
}

export function validateAnswers(fields, answers) {
    const errors = {};
    const clean = {};
    for (const f of fields) {
        const v = answers?.[f.id];
        const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        if (empty) {
            if (f.required) errors[f.id] = 'Обязательное поле';
        } else if (!checks[f.type](v, f)) {
            errors[f.id] = 'Некорректное значение';
        } else {
            clean[f.id] = v;
        }
    }
    return { errors, clean };
}