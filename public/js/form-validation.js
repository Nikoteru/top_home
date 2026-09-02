// Маска для российского телефона + валидация формы заявки (на главной
// странице и на странице конкретного дома). Работает на любой форме
// с атрибутом data-lead-form — полей достаточно: name="name/phone/email".

const RU_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

function isValidRuPhoneDigits(digits) {
  let normalized = digits;
  if (normalized.length === 11 && (normalized[0] === '7' || normalized[0] === '8')) {
    normalized = '7' + normalized.slice(1);
  } else if (normalized.length === 10) {
    normalized = '7' + normalized;
  } else {
    return false;
  }
  return /^7\d{10}$/.test(normalized);
}

// Простая маска "+7 (XXX) XXX-XX-XX": пересобирает значение из введённых
// цифр при каждом вводе. Курсор при этом уходит в конец — для номера
// телефона это не мешает вводу, зато код остаётся простым и без зависимостей.
function maskRuPhone(input) {
  let digits = input.value.replace(/\D/g, '');
  if (digits.length > 0 && (digits[0] === '7' || digits[0] === '8')) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);

  if (digits.length === 0) {
    input.value = '';
    return;
  }

  let formatted = '+7 (' + digits.slice(0, 3);
  if (digits.length >= 3) formatted += ')';
  if (digits.length > 3) formatted += ' ' + digits.slice(3, 6);
  if (digits.length > 6) formatted += '-' + digits.slice(6, 8);
  if (digits.length > 8) formatted += '-' + digits.slice(8, 10);
  input.value = formatted;
}

function initLeadForm(form) {
  const nameInput = form.querySelector('[name="name"]');
  const phoneInput = form.querySelector('[name="phone"]');
  const emailInput = form.querySelector('[name="email"]');
  const hint = form.querySelector('[data-form-hint]');
  const defaultHint = hint ? hint.textContent : '';

  function clearError() {
    [nameInput, phoneInput, emailInput].forEach((el) => el && el.classList.remove('field-invalid'));
    if (hint) {
      hint.textContent = defaultHint;
      hint.classList.remove('is-error');
    }
  }

  function showError(message, fields) {
    fields.forEach((el) => el && el.classList.add('field-invalid'));
    if (hint) {
      hint.textContent = message;
      hint.classList.add('is-error');
    }
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      maskRuPhone(phoneInput);
      clearError();
    });
  }
  if (emailInput) emailInput.addEventListener('input', clearError);
  if (nameInput) nameInput.addEventListener('input', clearError);

  form.addEventListener('submit', (e) => {
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';

    if (!name) {
      e.preventDefault();
      showError('Укажите ваше имя.', [nameInput]);
      nameInput.focus();
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    const phoneFilled = phoneDigits.length > 0;
    const emailFilled = email.length > 0;

    if (!phoneFilled && !emailFilled) {
      e.preventDefault();
      showError('Укажите телефон или e-mail — хотя бы одно из полей.', [phoneInput, emailInput]);
      phoneInput.focus();
      return;
    }

    if (phoneFilled && !isValidRuPhoneDigits(phoneDigits)) {
      e.preventDefault();
      showError('Введите корректный российский номер телефона.', [phoneInput]);
      phoneInput.focus();
      return;
    }

    if (emailFilled && !RU_EMAIL_RE.test(email)) {
      e.preventDefault();
      showError('Введите корректный e-mail.', [emailInput]);
      emailInput.focus();
      return;
    }

    clearError();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-lead-form]').forEach(initLeadForm);
});
