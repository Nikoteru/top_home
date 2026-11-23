const { styleHeader, styleSection, styleTableRow, styleTotal } = require('./estimateAppendixStyles');
const { referenceProfitSections } = require('./estimateReferenceProfitFormulas');

const columnWidths = [18.33203125, 7.44140625, 77.44140625, 11.5546875, 11.109375, 12.6640625, 14.33203125];
const defaultRowHeight = 14.4;
const amountFormat = String.raw`#,##0\ "₽"`;
const contractDateFormat = String.raw`[$-F800]dddd\,\ mmmm\ dd\,\ yyyy`;
const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const blackLine = { style: 'thin', color: { argb: 'FF000000' } };
const mediumLine = { ...blackLine, style: 'medium' };

const rowHeights = new Map([
  ...[7, 8, 9, 11, 12, 36, 37, 58, 59, 60, 63, 64, 65, 93, 94, 95, 96, 99, 100].map((row) => [row, 15]),
  [22, 29.4], [23, 21], [85, 21], [107, 33.6], [108, 19.8], [109, 26.4], [129, 18.6],
]);

const quantityFormats = new Map(Object.entries({
  0: [56, 57, 71, 85, 125, 126],
  '0.0': [51, 52, 53, 54, 55, 59, 60, 61, 62, 63],
  '0.00': [77, 78, 79],
  '0.000': [49, 50],
  '#,##0': [13, 14, 15, 22, 30, 31, 32, 33, 34, 35, 72, 73, 105],
  '#,##0.00': [12, 16, 17, 18, 19, 23, 87, 89, 93, 111, 116, 117, 118, 119],
  '#,##0.000': [74, 75, 76],
}).flatMap(([format, rows]) => rows.map((row) => [row, format])));

function rowNumbers(...numbersAndRanges) {
  return numbersAndRanges.flatMap((entry) => Array.isArray(entry)
    ? Array.from({ length: entry[1] - entry[0] + 1 }, (_, index) => entry[0] + index)
    : [entry]);
}

const positionBorderExceptions = [
  ['B', 'left', rowNumbers(5, 6, 9, [13, 20], 64, 65, [88, 102], [105, 111], [113, 119])],
  ['D', 'bottom', rowNumbers(55, 82, 105, 106, 113, 114, [116, 118])],
  ['D', 'left', [75, 76, 109]],
  ['F', 'top', rowNumbers(5, 6, 13, 38, 61, [116, 119], 88, 93, [90, 92], [97, 99], [101, 107], 113, 114)],
  ['F', 'bottom', rowNumbers(22, 63, [54, 57], [83, 85], [108, 110], 88, 93)],
  ['F', 'right', rowNumbers(53, [54, 57], [68, 71], [74, 85], 88, [90, 93], [97, 99], [101, 110], 113, 114)],
  ['G', 'left', rowNumbers(4, 5, 12, 23, 37, 59, 60, 64, 65, 87, 89, [94, 96], [116, 119])],
  ['G', 'bottom', rowNumbers([54, 57], [83, 85], [116, 119])],
];

const totalBorderExceptions = [
  ['D', 'bottom', [11]],
  ['E', 'bottom', [7, 11]],
  ['E', 'top', [10, 24]],
  ['F', 'bottom', [7, 11, 36, 58, 86]],
  ['F', 'top', [10, 24]],
  ['G', 'bottom', [7, 11]],
  ['G', 'top', [10, 24]],
  ['G', 'right', [120, 121, 122, 123, 124]],
];

const mediumQuantityRows = new Set(rowNumbers(8, 9, 12, 23, 37, 59, 60, 64, 65, [94, 96], 100));
const bottomPositionRows = new Set(rowNumbers([26, 34], [38, 46], 50, 51, [60, 65], [68, 70], [72, 82], 85, [88, 102],
  [106, 108], [113, 119]));
const bottomAmountRows = new Set(rowNumbers([26, 29], [38, 46], [49, 51]));
const bottomUnitsRows = new Set(rowNumbers([13, 15], 19, [22, 34], 49, 50, [53, 56], [68, 70], [72, 82], 85, 105, 106, 108,
  113, 114, [116, 119]));
const bottomQuantityRows = new Set(rowNumbers(13, 23, [26, 29], [38, 46], 64, 65, [88, 102], [125, 128]));
const bottomTotalRows = new Set([10, 36, 47, 48, 58, 66, 67, 86, 103, 104, 112, 120, 121, 122, 123]);

function applyBorderExceptions(row, exceptions) {
  for (const [column, side, numbers] of exceptions) {
    if (!numbers.includes(row.number)) continue;
    const cell = row.getCell(column);
    const border = { ...cell.border };
    delete border[side];
    cell.border = border;
  }
}

function paymentLink(sheet, address) {
  return {
    formula: `'${sheet.name.replaceAll("'", "''")}'!${address}`,
    result: sheet.getCell(address).value ?? '',
  };
}

function align(row, column, horizontal, { vertical = 'middle', wrapText = false } = {}) {
  row.getCell(column).alignment = { horizontal, vertical, wrapText };
}

function appendReferenceProfitSheet(workbook, { rows, paymentSheet }) {
  const sheet = workbook.addWorksheet('Прибыль', {
    properties: { defaultRowHeight },
    pageSetup: {
      orientation: 'portrait',
      paperSize: 1,
      fitToPage: false,
      fitToWidth: 1,
      fitToHeight: 1,
      scale: 100,
      printArea: 'A1:G134',
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  sheet.columns = columnWidths.map((width) => ({ width }));

  const title = sheet.getRow(1);
  title.values = ['        Приложение №1(смета) к договору', null, null, null,
    paymentLink(paymentSheet, 'E1'), paymentLink(paymentSheet, 'F1')];
  sheet.mergeCellsWithoutStyle('A1:D1');
  sheet.mergeCellsWithoutStyle('F1:G1');
  styleSection(title, 7);
  title.height = 19.2;
  title.eachCell((cell, column) => {
    cell.fill = whiteFill;
    cell.border = { top: blackLine, bottom: blackLine };
    if (column === 1) cell.border.left = blackLine;
    if (column === 7) cell.border.right = blackLine;
  });
  align(title, 'A', 'right', { vertical: 'bottom' });
  align(title, 'E', 'center', { vertical: 'bottom' });
  align(title, 'F', 'left', { vertical: 'bottom' });
  title.getCell('F').numFmt = contractDateFormat;

  const tableTitle = sheet.getRow(2);
  tableTitle.values = ['Этапы строительства', null, 'Работы/материалы'];
  sheet.mergeCellsWithoutStyle('C2:G2');
  styleHeader(tableTitle, 7);
  tableTitle.height = 34.2;
  const headers = sheet.getRow(3);
  headers.values = [null, '№', 'Наименование', 'Ед. изм.', 'Цена', 'Кол-во', 'Сумма'];
  styleHeader(headers, 7);
  headers.height = defaultRowHeight;
  headers.getCell('F').border = { top: blackLine, left: blackLine, right: blackLine };

  function addPosition(number, firstRow) {
    const row = sheet.getRow(number);
    const { name, unit, price, quantity, amount } = rows.get(number);
    const index = number - firstRow + 1;
    const position = index === 1 ? index : { formula: `B${number - 1}+1`, result: index };
    row.values = [null, position, name, unit, price, quantity, amount];
    styleTableRow(row, 7);
    row.height = rowHeights.get(number) ?? defaultRowHeight;
    align(row, 'B', 'center', { vertical: bottomPositionRows.has(number) ? 'bottom' : 'middle' });
    align(row, 'D', 'center', { vertical: bottomUnitsRows.has(number) ? 'bottom' : 'middle' });
    align(row, 'E', 'center');
    align(row, 'F', 'center', { vertical: bottomQuantityRows.has(number) ? 'bottom' : 'middle' });
    align(row, 'C', 'left', { wrapText: number === 109 });
    align(row, 'G', 'right', { vertical: bottomAmountRows.has(number) ? 'bottom' : 'middle' });
    row.getCell('E').numFmt = amountFormat;
    row.getCell('E').border = { top: blackLine, bottom: blackLine, left: blackLine };
    row.getCell('F').numFmt = quantityFormats.get(number) ?? 'General';
    row.getCell('G').numFmt = amountFormat;
    if (number === 110) row.getCell('D').border = {};
    if (mediumQuantityRows.has(number)) {
      row.getCell('F').border = { top: mediumLine, bottom: mediumLine, left: mediumLine, right: mediumLine };
    }
    applyBorderExceptions(row, positionBorderExceptions);
  }

  function addTotal(number, label, column) {
    const row = sheet.getRow(number);
    row.getCell(column).value = label;
    row.getCell('G').value = rows.get(number).amount;
    if (number === 7 || number === 21) sheet.mergeCellsWithoutStyle(`B${number}:C${number}`);
    styleTotal(row, 7);
    row.height = rowHeights.get(number) ?? defaultRowHeight;
    align(row, column, 'left');
    align(row, 'G', 'right', { vertical: bottomTotalRows.has(number) ? 'bottom' : 'middle' });
    row.getCell('G').numFmt = amountFormat;
    applyBorderExceptions(row, totalBorderExceptions);
  }

  for (const section of referenceProfitSections) {
    const firstRow = section.groups[0].firstRow;
    const lastRow = section.delivery ? section.groups[0].lastRow : section.totalRow;
    for (const group of section.groups) {
      for (let number = group.firstRow; number <= group.lastRow; number += 1) {
        addPosition(number, group.firstRow);
      }
      if (!section.delivery) {
        addTotal(group.lastRow + 1, group.type === 'material' ? 'Итого (материалы):' : 'Итого (работы):', 'B');
      }
    }
    addTotal(section.totalRow, 'Итого:', section.delivery ? 'A' : 'B');
    sheet.getCell(`A${firstRow}`).value = rows.get(firstRow).stage;
    sheet.mergeCellsWithoutStyle(`A${firstRow}:A${lastRow}`);
    for (let number = firstRow; number <= lastRow; number += 1) {
      const cell = sheet.getCell(`A${number}`);
      cell.fill = whiteFill;
      cell.font = { ...cell.font, bold: true };
      cell.border = { left: blackLine, right: blackLine };
      if (number === firstRow) cell.border.top = blackLine;
      if (number === lastRow) cell.border.bottom = blackLine;
    }
    align(sheet.getRow(firstRow), 'A', 'center', { wrapText: true });
  }

  addTotal(122, 'Итого (материалы):', 'A');
  addTotal(123, 'Итого (работы):', 'A');
  addTotal(124, 'Итого:', 'A');
  sheet.getCell('A130').border = { left: blackLine };
  sheet.getCell('G130').border = { right: blackLine };
  addTotal(131, 'Итого с учётом доставки и разгрузки:', 'A');

  const signatures = [
    { text: 'Подписи сторон:', height: 25.8, vertical: 'middle' },
    { text: `Заказчик :${' '.repeat(115)}Подрядчик:`, height: defaultRowHeight, vertical: 'bottom' },
    { text: `${' '.repeat(44)}__________${' '.repeat(117)}___________`, height: 42, vertical: 'middle' },
  ];
  for (const [index, { text, height, vertical }] of signatures.entries()) {
    const number = index + 132;
    const row = sheet.getRow(number);
    row.getCell('A').value = text;
    sheet.mergeCellsWithoutStyle(`A${number}:G${number}`);
    styleTableRow(row, 7);
    row.height = height;
    align(row, 'A', 'center', { vertical });
    for (let column = 1; column <= 7; column += 1) {
      const cell = row.getCell(column);
      cell.fill = whiteFill;
      cell.border = {};
      if (number === 134) cell.border.bottom = blackLine;
      if (column === 1) cell.border.left = blackLine;
      if (column === 7) cell.border.right = blackLine;
    }
  }
}

module.exports = { appendReferenceProfitSheet };
