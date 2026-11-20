(function () {
  const columns = Object.freeze({ price: 'D', quantity: 'E', amount: 'F' });
  const fields = Object.keys(columns);
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, 'u+': 3, 'u-': 3, '^': 4 };
  const precision = 18;
  const scale = 10n ** BigInt(precision);
  const cent = scale / 100n;
  const maxValue = BigInt(Number.MAX_VALUE) * scale;

  class FormulaError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function getWorksheetRows(template) {
    const result = new Map();
    let row = 1; // The column headings are visible as worksheet row 1.
    (template?.stages || []).forEach((stage, stageIndex) => {
      row += 1;
      (stage.groups || []).forEach((group, groupIndex) => {
        row += 1;
        (group.items || []).forEach((item, itemIndex) => {
          result.set(++row, { item, stageIndex, groupIndex, itemIndex });
        });
        row += 1; // Subtotal for the group.
      });
      row += 2; // Stage actions and subtotal.
    });
    return result;
  }

  function isBaseCell(item, field) {
    return Array.isArray(item?.baseCells) ? item.baseCells.includes(field) : item?.base === true;
  }

  function normalizeEntry(value, field) {
    if (typeof value !== 'string') return null;
    const pattern = field === 'quantity' ? /^\d{1,9}(?:[.,]\d{1,3})?$/ : /^\d{1,9}(?:[.,]\d{1,2})?$/;
    const trimmed = value.trim();
    return pattern.test(trimmed) ? trimmed.replace(',', '.') : null;
  }

  function bounded(value) {
    if (value > maxValue || value < -maxValue) {
      throw new FormulaError('range', 'Результат выходит за допустимый числовой диапазон.');
    }
    return value;
  }

  function toFixedPoint(value) {
    const negative = value.startsWith('-');
    const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.');
    const whole = integer.replace(/^0+/, '');
    if (whole.length > 309) throw new FormulaError('range', 'Число слишком велико.');
    const decimals = fraction.slice(0, precision).padEnd(precision, '0');
    const rounded = BigInt(whole + decimals) + (fraction[precision] >= '5' ? 1n : 0n);
    return bounded(negative ? -rounded : rounded);
  }

  function roundedDivision(numerator, divisor) {
    const negative = (numerator < 0n) !== (divisor < 0n);
    const top = numerator < 0n ? -numerator : numerator;
    const bottom = divisor < 0n ? -divisor : divisor;
    if (bottom === 0n) throw new FormulaError('zero', 'Деление на ноль.');
    const result = (top + bottom / 2n) / bottom;
    return negative ? -result : result;
  }

  function multiply(left, right) {
    return bounded(roundedDivision(left * right, scale));
  }

  function divide(left, right) {
    return bounded(roundedDivision(left * scale, right));
  }

  function asNumber(value) {
    return Number(value / scale) + Number(value % scale) / Number(scale);
  }

  function power(base, exponent) {
    if (exponent % scale !== 0n) {
      const approximate = asNumber(base) ** asNumber(exponent);
      if (Number.isNaN(approximate)) throw new FormulaError('value', 'Степень не даёт действительного числа.');
      if (!Number.isFinite(approximate)) {
        if (base === 0n && exponent < 0n) throw new FormulaError('zero', 'Деление на ноль.');
        throw new FormulaError('range', 'Результат выходит за допустимый числовой диапазон.');
      }
      const [mantissa, exponentText] = approximate.toExponential(17).split('e');
      const digits = BigInt(mantissa.replace('.', ''));
      const shift = Number(exponentText) + precision - 17;
      return bounded(shift >= 0 ? digits * 10n ** BigInt(shift) : roundedDivision(digits, 10n ** BigInt(-shift)));
    }

    let remaining = exponent / scale;
    if (remaining < 0n) {
      base = divide(scale, base);
      remaining = -remaining;
    }
    let result = scale;
    while (remaining > 0n) {
      if (remaining % 2n === 1n) result = multiply(result, base);
      remaining /= 2n;
      if (remaining > 0n) base = multiply(base, base);
    }
    return result;
  }

  function syntaxError() {
    return new FormulaError('syntax', 'Введите формулу с «=», числами, ссылками на ячейки и знаками + - * / ^.');
  }

  function compile(formula) {
    if (typeof formula !== 'string' || !formula.trim().startsWith('=')) throw syntaxError();
    const expression = formula.trim().slice(1);
    const tokens = /\s+|[A-Za-z]+\d+|\d+(?:[.,]\d+)?|[.,]\d+|[-+*/^()]/gy;
    const output = [];
    const operators = [];
    const dependencies = new Set();
    let needsOperand = true;

    while (tokens.lastIndex < expression.length) {
      const match = tokens.exec(expression);
      if (!match) throw syntaxError();
      const token = match[0];
      if (/^\s/.test(token)) continue;

      if (/^[A-Za-z0-9.,]/.test(token)) {
        if (!needsOperand) throw syntaxError();
        if (/^[A-Za-z]/.test(token)) {
          const address = token.toUpperCase();
          dependencies.add(address);
          output.push(address);
        } else {
          output.push(toFixedPoint(token.replace(',', '.')));
        }
        needsOperand = false;
      } else if (token === '(') {
        if (!needsOperand) throw syntaxError();
        operators.push(token);
      } else if (token === ')') {
        if (needsOperand) throw syntaxError();
        while (operators.length && operators.at(-1) !== '(') output.push(operators.pop());
        if (operators.pop() !== '(') throw syntaxError();
      } else if (needsOperand) {
        if (token !== '+' && token !== '-') throw syntaxError();
        operators.push('u' + token);
      } else {
        let previous = operators.at(-1);
        while (precedence[previous] > precedence[token]
          || (precedence[previous] === precedence[token] && token !== '^')) {
          output.push(operators.pop());
          previous = operators.at(-1);
        }
        operators.push(token);
        needsOperand = true;
      }
    }

    if (needsOperand || operators.includes('(')) throw syntaxError();
    return { output: [...output, ...operators.reverse()], dependencies: [...dependencies] };
  }

  function evaluatePostfix(output, values) {
    const stack = [];
    for (const token of output) {
      if (typeof token === 'bigint') {
        stack.push(token);
      } else if (!Object.hasOwn(precedence, token)) {
        stack.push(values.get(token));
      } else if (token === 'u-') {
        stack.push(-stack.pop());
      } else if (token !== 'u+') {
        const right = stack.pop();
        const left = stack.pop();
        switch (token) {
          case '+': stack.push(bounded(left + right)); break;
          case '-': stack.push(bounded(left - right)); break;
          case '*': stack.push(multiply(left, right)); break;
          case '/': stack.push(divide(left, right)); break;
          case '^': stack.push(power(left, right)); break;
        }
      }
    }
    return stack[0];
  }

  function saveError(errors, address, error) {
    if (!(error instanceof FormulaError)) throw error;
    errors[address] = { code: error.code, message: error.message };
  }

  function dependsOn(cells, dependencies, target) {
    const pending = [...dependencies];
    const visited = new Set();
    while (pending.length) {
      const address = pending.pop();
      if (address === target) return true;
      if (visited.has(address)) continue;
      visited.add(address);
      const cell = cells.get(address);
      if (cell) pending.push(...cell.dependencies);
    }
    return false;
  }

  function makeCells(worksheet, entries, errors) {
    const cells = new Map();
    const optionalAmounts = [];
    for (const [row, { item }] of worksheet) {
      for (const field of fields) {
        const address = columns[field] + row;
        const base = isBaseCell(item, field);
        const input = entries?.[row]?.[field];
        const hasInput = input !== undefined && input !== null && !(typeof input === 'string' && !input.trim());
        const formula = item.formulas?.[field];
        const hasFormula = formula !== undefined && formula !== null && !(typeof formula === 'string' && !formula.trim());
        const cell = { field, dependencies: [], value: null };
        cells.set(address, cell);
        try {
          if (base && hasInput) {
            const normalized = normalizeEntry(input, field);
            if (normalized === null) throw new FormulaError('input', 'Проверьте введённое число.');
            cell.value = toFixedPoint(normalized);
          } else if (!base && hasFormula) {
            Object.assign(cell, compile(formula));
          } else if (field === 'amount') {
            const dependencies = ['D' + row, 'E' + row];
            const product = { dependencies, output: [...dependencies, '*'] };
            if (base) optionalAmounts.push({ address, product });
            else Object.assign(cell, product);
          }
        } catch (error) {
          saveError(errors, address, error);
        }
      }
    }
    for (const { address, product } of optionalAmounts) {
      // A manual amount must stay independent if a price or quantity already depends on it.
      if (!dependsOn(cells, product.dependencies, address)) Object.assign(cells.get(address), product);
    }
    for (const [address, cell] of cells) {
      const badReference = cell.dependencies.find((reference) => !cells.has(reference));
      if (badReference) {
        saveError(errors, address, new FormulaError('ref', `Ячейка ${badReference} должна быть ценой, количеством или суммой строки позиции.`));
      }
    }
    return cells;
  }

  function evaluateCells(cells, errors) {
    const values = new Map();
    for (const address of cells.keys()) {
      if (values.has(address)) continue;
      const stack = [{ address, next: 0 }];
      const active = new Map([[address, 0]]);
      while (stack.length) {
        const frame = stack.at(-1);
        const cell = cells.get(frame.address);
        if (!errors[frame.address] && frame.next < cell.dependencies.length) {
          const dependency = cell.dependencies[frame.next++];
          if (active.has(dependency)) {
            for (const entry of stack.slice(active.get(dependency))) {
              saveError(errors, entry.address, new FormulaError('cycle', 'Циклическая ссылка в формуле.'));
            }
          } else if (!values.has(dependency)) {
            active.set(dependency, stack.length);
            stack.push({ address: dependency, next: 0 });
          }
          continue;
        }

        let value = null;
        if (!errors[frame.address]) {
          try {
            const failed = cell.dependencies.find((dependency) => errors[dependency]);
            if (failed) throw new FormulaError('dependency', `Проверьте ячейку ${failed}.`);
            if (cell.output && cell.dependencies.every((dependency) => values.get(dependency) !== null)) {
              value = evaluatePostfix(cell.output, values);
            } else {
              value = cell.value;
            }
            if (value !== null && cell.field === 'amount') value = roundedDivision(value, cent) * cent;
          } catch (error) {
            saveError(errors, frame.address, error);
          }
        }
        values.set(frame.address, value);
        active.delete(frame.address);
        stack.pop();
      }
    }
    return values;
  }

  function evaluateEstimate(template, entries = {}) {
    const worksheet = getWorksheetRows(template);
    const errors = {};
    const cells = makeCells(worksheet, entries, errors);
    const values = evaluateCells(cells, errors);
    const rows = {};
    const amountCents = {};
    for (const row of worksheet.keys()) {
      rows[row] = Object.fromEntries(fields.map((field) => {
        const value = values.get(columns[field] + row);
        return [field, value === null ? null : asNumber(value)];
      }));
      const amount = values.get('F' + row);
      amountCents[row] = amount === null ? null : String(amount / cent);
    }
    return { rows, amountCents, errors };
  }

  function validateTemplateFormulas(template) {
    const { errors } = evaluateEstimate(template);
    for (const [row, { item }] of getWorksheetRows(template)) {
      const hasValue = fields.some((field) => isBaseCell(item, field)
        || (typeof item.formulas?.[field] === 'string' && item.formulas[field].trim()));
      if (!hasValue && !errors['F' + row]) {
        saveError(errors, 'F' + row, new FormulaError('required', 'Добавьте формулу или отметьте базовую ячейку.'));
      }
    }
    return errors;
  }

  const api = { columns, getWorksheetRows, isBaseCell, normalizeEntry, validateTemplateFormulas, evaluateEstimate };
  if (typeof module === 'object') module.exports = api;
  else window.estimateFormulas = api;
})();
