const { styleTableRow, styleHeader, styleSection, styleTotal } = require('./estimateAppendixStyles');

const columnWidths = [9.21875, 58.21875, 11.109375, 36.88671875, 13.109375, 18.5546875];
const columns = [1, 2, 3, 4, 5, 6];
const paymentHeights = [48.6, 34.2, 72.6, 66, 60.6, 47.4, 47.4, 49.2, 49.2];
const paymentFormat = String.raw`#,##0\ _₽`;
const totalFormat = String.raw`#,##0\ "₽"`;
const contractDateFormat = String.raw`[$-F800]dddd\,\ mmmm\ dd\,\ yyyy`;
const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const blackRule = { style: 'thin', color: { argb: 'FF000000' } };

function applyBorders(row, { top = columns, bottom = columns, left = [1], right = [6] } = {}) {
  for (const column of columns) {
    const cell = row.getCell(column);
    const border = {};
    if (top.includes(column)) border.top = blackRule;
    if (bottom.includes(column)) border.bottom = blackRule;
    if (left.includes(column)) border.left = blackRule;
    if (right.includes(column)) border.right = blackRule;
    cell.border = border;
  }
}

function appendReferencePaymentsSheet(workbook, { schedule, amounts }) {
  const sheet = workbook.addWorksheet('Приложение№3', {
    properties: { defaultRowHeight: 14.4 },
    views: [{ zoomScale: 115 }],
    pageSetup: {
      orientation: 'portrait',
      paperSize: 1,
      scale: 66,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      printArea: 'A1:F16',
      margins: { left: 5 / 25.4, right: 5 / 25.4, top: 5 / 25.4, bottom: 19 / 25.4, header: 8 / 25.4, footer: 8 / 25.4 },
    },
  });
  sheet.columns = columnWidths.map((width) => ({ width }));

  const title = sheet.getRow(1);
  title.values = ['        Приложение №3(этапы платежей) к договору ', null, null, null, schedule.contractLabel, schedule.contractDate];
  sheet.mergeCellsWithoutStyle('A1:D1');
  styleSection(title, 6);
  title.height = 31.8;
  for (const [column, horizontal] of [['A', 'right'], ['E', 'center'], ['F', 'left']]) {
    title.getCell(column).alignment = { horizontal, vertical: 'bottom' };
  }
  for (const column of [1, 2, 3, 4, 6]) title.getCell(column).fill = whiteFill;
  title.getCell('F').numFmt = contractDateFormat;
  applyBorders(title, { bottom: [1, 2, 3, 4] });

  const groupHeader = sheet.getRow(2);
  groupHeader.getCell('B').value = 'Работы/материалы';
  sheet.mergeCellsWithoutStyle('B2:F2');
  styleHeader(groupHeader, 6);
  groupHeader.getCell('B').alignment = { horizontal: 'center', vertical: 'middle' };
  groupHeader.height = 14.4;
  applyBorders(groupHeader, { left: [1, 2], right: [1, 6] });

  const columnHeader = sheet.getRow(3);
  columnHeader.values = ['№', 'Наименование этапов платежей', 'сумма этапа платежа'];
  sheet.mergeCellsWithoutStyle('C3:F3');
  styleHeader(columnHeader, 6);
  columnHeader.height = 14.4;
  columnHeader.getCell('C').numFmt = '#,##0"р."';
  applyBorders(columnHeader, { left: [1, 2, 3], right: [1, 2, 6] });

  for (const [index, amount] of amounts.entries()) {
    const position = index + 4;
    const { description, amountInWords } = schedule.payments[index];
    const number = index ? { formula: `A${position - 1}+1`, result: index + 1 } : 1;
    const row = sheet.getRow(position);
    row.values = [number, description, amount, amountInWords];
    sheet.mergeCellsWithoutStyle(`D${position}:F${position}`);
    styleTableRow(row, 6);
    row.height = paymentHeights[index];
    row.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('C').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    row.getCell('C').numFmt = paymentFormat;
    row.getCell('D').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell('D').numFmt = totalFormat;
    for (const column of [3, 4, 5, 6]) row.getCell(column).fill = whiteFill;
    applyBorders(row, { left: [1, 2, 3], right: [1, 6] });
  }

  const total = sheet.getRow(13);
  const totalValue = amounts.reduce((sum, { result }) => sum + (Number.isFinite(result) ? result : 0), 0);
  total.values = ['Итого:', { formula: 'SUM(C4:C12)', result: totalValue }, schedule.totalInWords];
  sheet.mergeCellsWithoutStyle('C13:F13');
  styleTotal(total, 6);
  total.height = 45;
  total.getCell('A').alignment = { vertical: 'middle' };
  total.getCell('B').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  total.getCell('B').numFmt = totalFormat;
  total.getCell('C').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  total.getCell('C').numFmt = totalFormat;
  total.getCell('C').font = { ...total.getCell('C').font, bold: false };
  applyBorders(total, { top: [1, 2], bottom: [], left: [1, 2], right: [1, 6] });

  const signatures = [
    { text: 'Подписи сторон:', height: 14.4, vertical: 'middle', top: columns, bottom: [] },
    { text: `Заказчик :${' '.repeat(115)}Подрядчик:`, height: 37.2, vertical: 'bottom', top: [], bottom: [] },
    { text: `${' '.repeat(44)}__________${' '.repeat(117)}___________`, height: 69, vertical: 'middle', top: [], bottom: columns },
  ];
  for (const [index, signature] of signatures.entries()) {
    const position = 14 + index;
    const row = sheet.getRow(position);
    row.getCell('A').value = signature.text;
    sheet.mergeCellsWithoutStyle(`A${position}:F${position}`);
    styleTableRow(row, 6);
    row.height = signature.height;
    row.getCell('A').alignment = { horizontal: 'center', vertical: signature.vertical };
    row.eachCell((cell) => { cell.fill = whiteFill; });
    applyBorders(row, signature);
  }
}

module.exports = { appendReferencePaymentsSheet };
