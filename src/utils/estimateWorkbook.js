const ExcelJS = require('exceljs');
const { evaluateEstimate, getWorksheetRows } = require('../../public/js/estimate-formulas');

function excelAmount(cents) {
  if (cents === null) return null;
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  // Сохраняем точную сумму текстом, если она выходит за числовую точность Excel.
  if (absolute < 1000000000000000n) return Number(value) / 100;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${fraction}`;
}

function buildEstimateWorkbook(run) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Смета', { views: [{ state: 'frozen', ySplit: 3 }] });
  const headers = ['№', 'Наименование', 'Ед. изм.', 'Цена за ед., ₽', 'Количество', 'Сумма, ₽'];
  sheet.columns = [8, 42, 14, 18, 16, 20].map((width) => ({ width }));
  sheet.getColumn(4).numFmt = '#,##0.00######';
  sheet.getColumn(5).numFmt = '#,##0.########';
  sheet.getColumn(6).numFmt = '#,##0.00';
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };

  function addSection(label, color) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, headers.length);
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }

  function addSubtotal(label, cents) {
    const row = sheet.addRow([label, null, null, null, null, excelAmount(cents)]);
    sheet.mergeCells(row.number, 1, row.number, headers.length - 1);
    row.font = { bold: true };
  }

  addSection(run.title, 'FFD7E3F7');
  const source = sheet.addRow(['Шаблон', run.template.title]);
  sheet.mergeCells(source.number, 2, source.number, headers.length);
  sheet.addRow(headers).font = { bold: true };

  const { rows, amountCents } = evaluateEstimate(run.template, run.entries);
  const positions = getWorksheetRows(run.template).keys();
  let total = 0n;
  for (const stage of run.template.stages) {
    addSection(`Этап · ${stage.title}`, 'FFE0E9F7');
    let stageTotal = 0n;
    for (const group of stage.groups) {
      addSection(group.type === 'material' ? 'Материалы' : 'Работы', 'FFF0F4FA');
      let groupTotal = 0n;
      for (const [index, item] of group.items.entries()) {
        const row = positions.next().value;
        const { price, quantity } = rows[row];
        const amount = amountCents[row];
        sheet.addRow([index + 1, item.title, item.unit, price, quantity, excelAmount(amount)]);
        groupTotal += BigInt(amount ?? 0);
      }
      addSubtotal('Итого по подблоку', groupTotal);
      stageTotal += groupTotal;
    }
    addSubtotal('Итого по этапу', stageTotal);
    total += stageTotal;
  }
  addSubtotal('Итого по смете', total);
  return workbook;
}

module.exports = { buildEstimateWorkbook };
