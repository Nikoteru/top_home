const moneyFormat = '#,##0.00" ₽"';
const dateFormat = 'dd.mm.yyyy';

const tableFont = { name: 'Tahoma', size: 10, color: { argb: 'FF000000' } };
const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF83A658' } };
const blackLine = { style: 'thin', color: { argb: 'FF000000' } };
const tableBorder = { top: blackLine, right: blackLine, bottom: blackLine, left: blackLine };

function styleTableRow(row, columnCount = row.cellCount) {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = tableFont;
    cell.border = tableBorder;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

function styleTitle(sheet, number, columnCount, text) {
  const row = sheet.getRow(number);
  sheet.mergeCells(number, 1, number, columnCount);
  const cell = row.getCell(1);
  cell.value = text;
  styleSection(row, columnCount);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  row.height = 32;
}

function styleHeader(row, columnCount = row.cellCount) {
  styleTableRow(row, columnCount);
  row.height = 30;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.fill = greenFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

function styleSection(row, columnCount = row.cellCount) {
  styleTableRow(row, columnCount);
  row.height = 20;
  for (let column = 1; column <= columnCount; column += 1) {
    row.getCell(column).font = { ...tableFont, bold: true };
  }
}

function styleTotal(row, columnCount = row.cellCount) {
  styleSection(row, columnCount);
  row.height = 28;
  for (let column = 1; column <= columnCount; column += 1) {
    row.getCell(column).fill = greenFill;
  }
}

function styleInput(cell) {
  cell.font = tableFont;
  cell.border = { ...cell.border, bottom: { ...blackLine, style: 'medium' } };
  return cell;
}

module.exports = { moneyFormat, dateFormat, styleTableRow, styleTitle, styleHeader, styleSection, styleTotal, styleInput };
