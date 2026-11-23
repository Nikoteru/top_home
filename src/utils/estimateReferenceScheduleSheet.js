const { styleTableRow, styleHeader, styleSection, styleTotal } = require('./estimateAppendixStyles');

const columnWidths = [10.6640625, 28.109375, 19.44140625, 13.5546875, 59, 14, 35.109375];
const columns = [1, 2, 3, 4, 5, 6, 7];
const stageHeights = [67.8, 77.4, 79.2, 79.2, 79.2, 66, 66];
const dateFormulas = ['G1+7', 'G1+45', 'G1+60', 'C5+15', 'C6+30', 'C7', 'C7+30'];
const completionOffsets = [7, 45, 60, 75, 105, 105, 135];
const dateFormat = String.raw`[$-F800]dddd\,\ mmmm\ dd\,\ yyyy`;
const rubleLabelFormat = '#,##0"р."';
const stageNameFormat = String.raw`_-* #,##0.00"р."_-;\-* #,##0.00"р."_-;_-* "-"??"р."_-;_-@_-`;
const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const thinRule = { style: 'thin', color: { argb: 'FF000000' } };
const frameRule = { ...thinRule, style: 'medium' };

function reference(sheet, address) {
  return `'${sheet.name.replaceAll("'", "''")}'!${address}`;
}

function linkedCell(sheet, address, fallback) {
  const cell = sheet.getCell(address);
  return { formula: reference(sheet, address), result: cell.result ?? cell.value ?? fallback };
}

function addDays(date, days) {
  if (date instanceof Date) return new Date(date.getTime() + days * 86400000);
  return Number.isFinite(date) ? date + days : '';
}

function applyBorders(row, { top = columns, bottom = columns, left = [1], right = [7], outerTop = false, outerBottom = false } = {}) {
  for (const column of columns) {
    const border = {};
    if (top.includes(column)) border.top = outerTop ? frameRule : thinRule;
    if (bottom.includes(column)) border.bottom = outerBottom ? frameRule : thinRule;
    if (left.includes(column)) border.left = column === 1 ? frameRule : thinRule;
    if (right.includes(column)) border.right = column === 7 ? frameRule : thinRule;
    row.getCell(column).border = border;
  }
}

function appendReferenceScheduleSheet(workbook, { schedule, amounts, sourceSheet, paymentSheet }) {
  const sheet = workbook.addWorksheet('Приложение№4', {
    properties: { defaultRowHeight: 14.4 },
    pageSetup: {
      orientation: 'portrait',
      paperSize: 1,
      scale: 58,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      printArea: 'A1:G13',
      margins: { left: 5 / 25.4, right: 5 / 25.4, top: 5 / 25.4, bottom: 19 / 25.4, header: 8 / 25.4, footer: 8 / 25.4 },
    },
  });
  sheet.columns = columnWidths.map((width) => ({ width }));

  const contractDate = linkedCell(paymentSheet, 'F1', '');
  const title = sheet.getRow(1);
  title.values = [' Приложение №4(Этапы работ) к договору', null, null, null, null, linkedCell(paymentSheet, 'E1', ''), contractDate];
  sheet.mergeCellsWithoutStyle('A1:E1');
  styleSection(title, 7);
  title.height = 31.8;
  title.eachCell((cell) => { cell.fill = whiteFill; });
  for (const [column, horizontal] of [['A', 'right'], ['F', 'center'], ['G', 'left']]) {
    title.getCell(column).alignment = { horizontal, vertical: 'bottom' };
  }
  title.getCell('G').numFmt = dateFormat;
  applyBorders(title, { outerTop: true });

  const header = sheet.getRow(2);
  header.values = ['№ этапа работ', 'Наименования этапа работ', 'Дата окончания ', 'Стоимость этапа работ', null, null, 'Пояснение'];
  sheet.mergeCellsWithoutStyle('D2:F2');
  styleHeader(header, 7);
  header.height = 26.4;
  for (const column of ['A', 'B', 'C', 'D', 'G']) header.getCell(column).numFmt = rubleLabelFormat;
  applyBorders(header, { left: [1, 2, 3, 4, 7], right: [1, 2, 3, 6, 7] });

  const stageBorders = [
    {}, {}, {},
    { bottom: [1, 3, 5, 6, 7] },
    { bottom: [3, 5, 6, 7] },
    { bottom: [3, 5, 6] },
    { bottom: [2, 3, 5, 6, 7], left: [1, 2, 3, 7], right: [2, 3, 6, 7] },
  ];
  for (const [index, { formula, result, titleRow }] of amounts.entries()) {
    const position = index + 3;
    const { name, amountInWords, notes } = schedule.stages[index];
    const trailingSpaces = name.slice(name.trimEnd().length);
    const titleAddress = `A${titleRow}`;
    const stage = {
      formula: `MID(${reference(sourceSheet, titleAddress)},8,32767)${trailingSpaces ? `&"${trailingSpaces}"` : ''}`,
      result: sourceSheet.getCell(titleAddress).value.slice(7) + trailingSpaces,
    };
    const completion = { formula: dateFormulas[index], result: addDays(contractDate.result, completionOffsets[index]) };
    const words = index === 0 ? linkedCell(paymentSheet, 'D5', amountInWords) : amountInWords;
    const row = sheet.getRow(position);
    row.values = [`${index + 1}.1.`, stage, completion, { formula, result }, words, null, notes];
    sheet.mergeCellsWithoutStyle(`E${position}:F${position}`);
    styleTableRow(row, 7);
    row.height = stageHeights[index];
    row.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('A').numFmt = '@';
    row.getCell('B').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.getCell('B').font = { ...row.getCell('B').font, bold: true };
    if (position >= 5 && position <= 7) row.getCell('B').numFmt = stageNameFormat;
    row.getCell('C').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('C').numFmt = dateFormat;
    row.getCell('D').alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell('D').numFmt = '#,##0';
    for (const column of [4, 5, 6]) row.getCell(column).fill = whiteFill;
    applyBorders(row, { left: [1, 2, 3, 4], right: [1, 2, 3, 6, 7], ...stageBorders[index] });
  }

  const total = sheet.getRow(10);
  const totalValue = amounts.reduce((sum, { result }) => sum + (Number.isFinite(result) ? result : 0), 0);
  total.values = ['Итого стоимость по договору:', null, null, {
    formula: 'SUM(D3:D9)', result: totalValue,
  }, linkedCell(paymentSheet, 'C13', schedule.totalInWords)];
  sheet.mergeCellsWithoutStyle('A10:C10');
  sheet.mergeCellsWithoutStyle('E10:G10');
  styleTotal(total, 7);
  total.height = 23.4;
  for (const [column, horizontal] of [['A', 'left'], ['D', 'right'], ['E', 'left']]) {
    total.getCell(column).alignment = { horizontal, vertical: 'middle', wrapText: true };
  }
  total.getCell('A').numFmt = rubleLabelFormat;
  total.getCell('D').numFmt = '#,##0';
  total.getCell('E').numFmt = rubleLabelFormat;
  applyBorders(total);

  const signatures = [
    { text: 'Подписи сторон:', height: 25.8 },
    { text: ` Заказчик :${' '.repeat(140)}Подрядчик:`, height: 14.4 },
    { text: `${' '.repeat(58)}____________${' '.repeat(142)}_____________ `, height: 68.4 },
  ];
  for (const [index, { text, height }] of signatures.entries()) {
    const position = index + 11;
    const row = sheet.getRow(position);
    row.getCell('A').value = text;
    sheet.mergeCellsWithoutStyle(`A${position}:G${position}`);
    styleTableRow(row, 7);
    row.height = height;
    row.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
    row.eachCell((cell) => { cell.fill = whiteFill; });
    applyBorders(row, { top: [], bottom: position === 13 ? columns : [], outerBottom: true });
  }
}

module.exports = { appendReferenceScheduleSheet };
