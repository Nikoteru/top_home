// Общая серверная валидация для формы заявки. Логика зеркалит клиентский
// JS (public/js/form-validation.js), чтобы поведение совпадало один в один.

// Приводим телефон к 11 цифрам, начинающимся с 7 (и мобильные, и городские
// номера в РФ имеют такой формат: 7 + код города/оператора + 7 цифр).
function normalizeRuPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '7' + digits;
  }
  return null;
}

function isValidRuPhone(raw) {
  const normalized = normalizeRuPhone(raw);
  return !!normalized && /^7\d{10}$/.test(normalized);
}

function formatRuPhone(raw) {
  const normalized = normalizeRuPhone(raw);
  if (!normalized) return raw;
  const d = normalized;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

function isValidEmail(raw) {
  return EMAIL_RE.test((raw || '').trim());
}

module.exports = { isValidRuPhone, isValidEmail, normalizeRuPhone, formatRuPhone };
