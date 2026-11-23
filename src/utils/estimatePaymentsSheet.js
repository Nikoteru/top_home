const {
  moneyFormat, dateFormat, styleTableRow, styleTitle, styleHeader, styleSection, styleTotal, styleInput,
} = require('./estimateAppendixStyles');

function appendPaymentsSheet(workbook, { title, sourceSheet, totalRow, stages }) {
  const sheet = workbook.addWorksheet('Приложение№3', {
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    pageSetup: {
      orientation: 'portrait',
      paperSize: 1,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:6',
      margins: { left: 0.197, right: 0.197, top: 0.197, bottom: 0.748, header: 0.315, footer: 0.315 },
    },
  });
  sheet.columns = [9.22, 58.22, 16, 16, 16, 32, 20].map((width) => ({ width }));
  for (const column of ['C', 'D', 'E']) sheet.getColumn(column).numFmt = moneyFormat;

  const source = `'${sourceSheet.name.replaceAll("'", "''")}'`;
  const total = sourceSheet.getCell(`F${totalRow}`).value;
  const amounts = stages.map((stage) => sourceSheet.getCell(`F${stage.totalRow}`).value);
  const numeric = typeof total === 'number' && amounts.every((amount) => typeof amount === 'number');

  styleTitle(sheet, 1, 7, 'Приложение №3 · График платежей');
  sheet.mergeCells('B2:D2');
  sheet.mergeCells('E2:F2');
  styleTableRow(sheet.getRow(2), 7);
  sheet.getRow(2).height = 29;
  sheet.getCell('A2').value = 'Договор №';
  styleInput(sheet.getCell('B2')).numFmt = '@';
  sheet.getCell('E2').value = 'Дата договора';
  styleInput(sheet.getCell('G2')).numFmt = dateFormat;

  sheet.mergeCells('B3:D3');
  sheet.mergeCells('E3:F3');
  styleTableRow(sheet.getRow(3), 7);
  sheet.getRow(3).height = 25;
  sheet.getCell('A3').value = 'Аванс, ₽';
  const advance = styleInput(sheet.getCell('B3'));
  advance.value = 0;
  advance.numFmt = moneyFormat;
  advance.dataValidation = {
    type: 'decimal', operator: 'between', allowBlank: true,
    formulae: [0, 'MAX(0,$G$3)'], showErrorMessage: true,
    errorTitle: 'Проверьте аванс', error: 'Аванс должен быть от нуля до общей суммы сметы.',
  };
  sheet.getCell('E3').value = 'Итого по смете, ₽';
  sheet.getCell('G3').numFmt = moneyFormat;
  sheet.getCell('G3').value = { formula: `${source}!F${totalRow}`, result: total };

  sheet.mergeCells('A4:G4');
  sheet.getCell('A4').value = title;
  styleSection(sheet.getRow(4), 7);
  sheet.mergeCells('A5:G5');
  styleTableRow(sheet.getRow(5), 7);
  sheet.getRow(5).height = 24;
  const stageCount = stages.length;
  const numericCheck = stageCount ? `AND(ISNUMBER($G$3),COUNT($C$8:$C$${7 + stageCount})=${stageCount})` : 'ISNUMBER($G$3)';
  const instructions = 'Аванс засчитывается в оплату этапов по порядку. Подчёркнутые поля можно заполнять.';
  const precisionWarning = 'Некоторые суммы сохранены текстом для точности. Автоматический график для них недоступен.';
  sheet.getCell('A5').value = {
    formula: `IF(NOT(${numericCheck}),"${precisionWarning}",IF(ISNUMBER($E$7),"${instructions}","Укажите аванс от нуля до общей суммы сметы."))`,
    result: numeric ? instructions : precisionWarning,
  };

  styleHeader(sheet.addRow(['№', 'Наименование этапа платежа', 'По смете, ₽', 'Зачёт аванса, ₽', 'К оплате, ₽', 'Сумма прописью', 'Примечание']));
  const advanceRow = sheet.addRow([1, 'Аванс при заключении договора', null, null, {
    formula: `IF(AND(${numericCheck},OR($B$3="",ISNUMBER($B$3)),N($B$3)>=0,ROUND(N($B$3),2)<=MAX(0,N($G$3))),ROUND(N($B$3),2),"")`,
    result: numeric ? 0 : '',
  }]);
  stylePaymentRow(advanceRow);

  for (const [index, stage] of stages.entries()) {
    const number = 8 + index;
    const row = sheet.addRow([
      index + 2,
      { formula: `"После завершения: "&MID(${source}!A${stage.titleRow},8,32767)`, result: `После завершения: ${stage.title}` },
      { formula: `${source}!F${stage.totalRow}`, result: amounts[index] },
      {
        formula: `IF(AND(ISNUMBER(C${number}),ISNUMBER($E$7)),ROUND(MAX(0,MIN(C${number},$E$7-SUM(D$7:D${number - 1}))),2),"")`,
        result: numeric ? 0 : '',
      },
      { formula: `IF(ISNUMBER(D${number}),ROUND(C${number}-D${number},2),"")`, result: numeric ? amounts[index] : '' },
    ]);
    stylePaymentRow(row);
  }

  const last = 7 + stageCount;
  const sum = (column) => stageCount ? `ROUND(SUM(${column}8:${column}${last}),2)` : '0';
  const summary = sheet.addRow([
    null, 'Итого по графику',
    { formula: `IF(${numericCheck},${sum('C')},"")`, result: numeric ? total : '' },
    { formula: `IF(ISNUMBER(E7),${sum('D')},"")`, result: numeric ? 0 : '' },
    { formula: `IF(ISNUMBER(E7),ROUND(SUM(E7:E${last}),2),"")`, result: numeric ? total : '' },
    null, null,
  ]);
  styleTotal(summary, 7);
  const difference = sheet.addRow([null, 'Расхождение со сметой', null, null, {
    formula: `IF(ISNUMBER(E${summary.number}),ROUND(E${summary.number}-$G$3,2),"")`, result: numeric ? 0 : '',
  }]);
  styleTableRow(difference, 7);
  difference.height = 20;
  sheet.addRow([]);
  const signatureTitle = sheet.addRow(['Подписи сторон']);
  sheet.mergeCells(`A${signatureTitle.number}:G${signatureTitle.number}`);
  styleSection(signatureTitle, 7);
  signatureTitle.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  const signatures = sheet.addRow(['Заказчик ____________________', null, null, null, 'Подрядчик ____________________']);
  sheet.mergeCells(`A${signatures.number}:D${signatures.number}`);
  sheet.mergeCells(`E${signatures.number}:G${signatures.number}`);
  styleTableRow(signatures, 7);
  signatures.height = 35;
  for (const column of ['A', 'E']) {
    signatures.getCell(column).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  sheet.pageSetup.printArea = `A1:G${signatures.number}`;
}

function stylePaymentRow(row) {
  styleTableRow(row, 7);
  row.height = 34;
  row.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
  styleInput(row.getCell('F'));
  styleInput(row.getCell('G'));
}

module.exports = { appendPaymentsSheet };
