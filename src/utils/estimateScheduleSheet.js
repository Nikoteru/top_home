const { moneyFormat, dateFormat, styleTableRow, styleHeader, styleSection, styleTotal, styleInput } = require('./estimateAppendixStyles');

const columnWidths = [10.66, 28.11, 13.55, 19.44, 19.44, 19.44, 35.11];
const frameLine = { style: 'medium', color: { argb: 'FF000000' } };
const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

function reference(sheetName, address) {
  return `'${sheetName.replace(/'/g, "''")}'!${address}`;
}

function linkedValue(sheetName, address, result) {
  const source = reference(sheetName, address);
  return { formula: `IF(${source}="","",${source})`, result: result ?? '' };
}

function alignCell(cell, horizontal) {
  cell.alignment = { ...cell.alignment, horizontal };
}

function frameRow(row, { top = false, bottom = false } = {}) {
  for (let column = 1; column <= columnWidths.length; column += 1) {
    const cell = row.getCell(column);
    const border = { ...cell.border };
    if (column === 1) border.left = frameLine;
    if (column === columnWidths.length) border.right = frameLine;
    if (top) border.top = frameLine;
    if (bottom) border.bottom = frameLine;
    cell.border = border;
  }
}

function appendScheduleSheet(workbook, { title, sourceSheet, totalRow, stages, referencePayments = false }) {
  const sheet = workbook.addWorksheet('Приложение№4', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: {
      paperSize: 1,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:5',
      margins: { left: 0.19685, right: 0.19685, top: 0.19685, bottom: 0.748, header: 0.315, footer: 0.315 },
    },
  });
  sheet.columns = columnWidths.map((width) => ({ width }));
  sheet.mergeCellsWithoutStyle('A1:G1');
  sheet.getCell('A1').value = 'Приложение №4. График строительства';
  const titleRow = sheet.getRow(1);
  styleSection(titleRow);
  titleRow.eachCell((cell) => { cell.fill = whiteFill; });
  titleRow.getCell(1).alignment = { horizontal: 'right', vertical: 'bottom', wrapText: true };
  titleRow.height = 31.8;
  frameRow(titleRow, { top: true });

  const paymentSheet = workbook.getWorksheet('Приложение№3');
  const numberAddress = referencePayments ? 'E1' : 'B2';
  const dateAddress = referencePayments ? 'F1' : 'G2';
  const contractLabel = paymentSheet?.getCell(numberAddress).value;
  const contractNumber = referencePayments ? String(contractLabel ?? '').replace(/^№\s*|\s+от\s*$/g, '') : contractLabel;
  const contractDate = paymentSheet?.getCell(dateAddress).value;
  const cachedContractDate = contractDate instanceof Date || (typeof contractDate === 'number' && contractDate > 0) ? contractDate : '';
  const numberSource = reference('Приложение№3', numberAddress);
  const numberValue = referencePayments ? `TRIM(SUBSTITUTE(SUBSTITUTE(${numberSource},"№","")," от",""))` : numberSource;
  const dateSource = reference('Приложение№3', dateAddress);
  const contractRow = sheet.getRow(2);
  contractRow.values = ['Договор №', {
    formula: `IF(OR(${numberSource}="",${numberSource}=0),"",${numberValue})`, result: contractNumber || '',
  }, null, null, null, 'Дата договора', {
    formula: `IF(AND(ISNUMBER(${dateSource}),${dateSource}>0),${dateSource},"")`, result: cachedContractDate,
  }];
  sheet.mergeCellsWithoutStyle('B2:E2');
  styleTableRow(contractRow);
  alignCell(contractRow.getCell(6), 'center');
  contractRow.height = 26;
  sheet.getCell('G2').numFmt = dateFormat;
  frameRow(contractRow);

  sheet.mergeCellsWithoutStyle('C3:G3');
  const startRow = sheet.getRow(3);
  styleTableRow(startRow);
  sheet.getCell('A3').value = 'Начало работ';
  const projectStart = sheet.getCell('B3');
  styleInput(projectStart);
  projectStart.numFmt = dateFormat;
  alignCell(projectStart, 'center');
  sheet.getCell('C3').value = 'Укажите дату начала работ и срок каждого этапа в календарных днях. Первый день входит в срок.';
  startRow.height = 29;
  frameRow(startRow);

  sheet.mergeCellsWithoutStyle('A4:G4');
  sheet.getCell('A4').value = title;
  const estimateRow = sheet.getRow(4);
  styleSection(estimateRow);
  frameRow(estimateRow);
  const header = sheet.getRow(5);
  header.values = ['№', 'Наименование этапа работ', 'Срок, календ. дн.', 'Начало', 'Окончание', 'Стоимость этапа, ₽', 'Примечание'];
  styleHeader(header);
  header.height = 26;
  frameRow(header);

  for (const [index, stage] of stages.entries()) {
    const position = index + 6;
    const stageSource = reference(sourceSheet.name, `A${stage.titleRow}`);
    const costCell = `F${stage.totalRow}`;
    const startSource = index === 0 ? '$B$3' : `E${position - 1}`;
    const startValue = index === 0 ? startSource : `${startSource}+1`;
    const duration = `C${position}`;
    const start = `D${position}`;
    const row = sheet.getRow(position);

    row.values = [index + 1, {
      formula: `IF(LEFT(${stageSource},7)="Этап · ",MID(${stageSource},8,32767),${stageSource})`,
      result: stage.title,
    }, null, {
      formula: `IF(AND(ISNUMBER(${startSource}),${startSource}>0),${startValue},"")`,
      result: '',
    }, {
      formula: `IF(COUNT(${start},${duration})<2,"",IF(AND(${start}>0,${duration}>=1,${duration}=INT(${duration})),${start}+${duration}-1,""))`,
      result: '',
    }, linkedValue(sourceSheet.name, costCell, sourceSheet.getCell(costCell).value)];
    row.height = stage.title.length > 46 ? 79.2 : 66;
    styleTableRow(row, columnWidths.length);
    const durationCell = sheet.getCell(duration);
    styleInput(durationCell);
    durationCell.dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1], showErrorMessage: true,
      errorTitle: 'Проверьте срок', error: 'Укажите целое число календарных дней от 1.' };
    styleInput(row.getCell(7));
    for (let column = 1; column <= 5; column += 1) alignCell(row.getCell(column), 'center');
    const stageName = row.getCell(2);
    stageName.font = { ...stageName.font, bold: true };
    alignCell(row.getCell(6), 'right');
    alignCell(row.getCell(7), 'left');
    row.getCell(4).numFmt = dateFormat;
    row.getCell(5).numFmt = dateFormat;
    row.getCell(6).numFmt = moneyFormat;
    frameRow(row);
  }

  const totalPosition = stages.length + 6;
  const total = sheet.getRow(totalPosition);
  const sourceTotal = `F${totalRow}`;
  sheet.mergeCellsWithoutStyle(`A${totalPosition}:E${totalPosition}`);
  total.getCell(1).value = 'Итого стоимость по смете';
  total.getCell(6).value = linkedValue(sourceSheet.name, sourceTotal, sourceSheet.getCell(sourceTotal).value);
  total.getCell(6).numFmt = moneyFormat;
  styleTotal(total, columnWidths.length);
  alignCell(total.getCell(6), 'right');
  total.height = 23.4;
  frameRow(total);

  const signatureTitle = totalPosition + 1;
  const signatureLabels = signatureTitle + 1;
  const signatureLines = signatureLabels + 1;
  sheet.mergeCellsWithoutStyle(`A${signatureTitle}:G${signatureTitle}`);
  sheet.getCell(`A${signatureTitle}`).value = 'Подписи сторон';
  for (const [rowNumber, height, left, right] of [
    [signatureTitle, 25.8],
    [signatureLabels, 24, 'Заказчик', 'Подрядчик'],
    [signatureLines, 68.4, '____________________', '____________________'],
  ]) {
    const row = sheet.getRow(rowNumber);
    if (right) {
      sheet.mergeCellsWithoutStyle(`A${rowNumber}:D${rowNumber}`);
      sheet.mergeCellsWithoutStyle(`E${rowNumber}:G${rowNumber}`);
      row.getCell(1).value = left;
      row.getCell(5).value = right;
    }
    styleSection(row);
    row.height = height;
    row.eachCell((cell) => {
      cell.border = {};
      cell.fill = whiteFill;
    });
    alignCell(row.getCell(1), 'center');
    alignCell(row.getCell(5), 'center');
    frameRow(row, { bottom: rowNumber === signatureLines });
  }
  sheet.pageSetup.printArea = `A1:G${signatureLines}`;
}

module.exports = { appendScheduleSheet };
