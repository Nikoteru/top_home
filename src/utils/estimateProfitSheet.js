const {
  moneyFormat, styleTitle, styleHeader, styleSection, styleTotal, styleInput, styleTableRow,
} = require('./estimateAppendixStyles');

const costPercent = 80n;
const excelLimitCents = 1_000_000_000_000_000n;
const excelLimitRubles = excelLimitCents / 100n;
const precisionWarning = 'Вне точности Excel';

function absolute(amount) {
  return amount < 0n ? -amount : amount;
}

function amountInCents(value) {
  if (typeof value === 'number') return BigInt(Math.round(value * 100));
  return value ? precisionWarning : null;
}

function resultAmount(cents) {
  return typeof cents === 'bigint' ? Number(cents) / 100 : (cents ?? '');
}

function estimatedCost(revenue) {
  if (typeof revenue !== 'bigint') return revenue;
  const rounded = (absolute(revenue) * costPercent + 50n) / 100n;
  return revenue < 0n ? -rounded : rounded;
}

function sumAmounts(lines, field) {
  const amounts = lines.map((line) => line[field]);
  if (amounts.includes(precisionWarning)) return precisionWarning;
  const numeric = amounts.filter((amount) => typeof amount === 'bigint');
  if (!numeric.length) return null;
  const total = numeric.reduce((sum, amount) => sum + amount, 0n);
  return absolute(total) < excelLimitCents ? total : precisionWarning;
}

function addresses(column, lines) {
  const first = lines[0].number;
  const last = lines.at(-1).number;
  if (last - first === lines.length - 1) return [`${column}${first}:${column}${last}`];
  return lines.map(({ number }) => `${column}${number}`);
}

function sumFormula(column, lines) {
  const cells = addresses(column, lines);
  const refs = cells.join(',');
  const flags = addresses(column === 'F' ? 'J' : 'K', lines).join(',');
  const total = `ROUND(SUM(${refs}),2)`;
  return `IF(SUM(${flags})>0,"${precisionWarning}",IF(COUNT(${refs})=0,"",IF(ABS(${total})>=${excelLimitRubles},"${precisionWarning}",${total})))`;
}

function putProfit(row, revenue, cost) {
  const { number } = row;
  const saleRef = `F${number}`;
  const costRef = `G${number}`;
  const profitRef = `H${number}`;
  const warning = revenue === precisionWarning || cost === precisionWarning;
  const profit = typeof revenue === 'bigint' && typeof cost === 'bigint' ? revenue - cost : null;
  // Distinguish a real text amount from a missing value or a numeric amount.
  for (const [flag, reference, value] of [['J', saleRef, revenue], ['K', costRef, cost]]) {
    row.getCell(flag).value = {
      formula: `IF(AND(ISTEXT(${reference}),${reference}<>""),1,0)`,
      result: value === precisionWarning ? 1 : 0,
    };
  }
  row.getCell('H').value = {
    formula: `IF(OR(AND(ISTEXT(${saleRef}),${saleRef}<>""),AND(ISTEXT(${costRef}),${costRef}<>"")),"${precisionWarning}",IF(COUNT(${saleRef},${costRef})=2,ROUND(${saleRef}-${costRef},2),""))`,
    result: warning ? precisionWarning : resultAmount(profit),
  };
  row.getCell('I').value = {
    formula: `IF(AND(COUNT(${saleRef},${profitRef})=2,${saleRef}<>0),${profitRef}/${saleRef},"")`,
    result: profit !== null && revenue !== 0n ? resultAmount(profit) / resultAmount(revenue) : '',
  };
}

function appendProfitSheet(workbook, { title, sourceSheet, stages }) {
  const sheet = workbook.addWorksheet('Прибыль', {
    properties: { defaultRowHeight: 14 },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    pageSetup: {
      orientation: 'portrait',
      paperSize: 1,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '6:6',
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  sheet.columns = [8, 77, 12, 17, 13, 18, 21, 18, 13].map((width) => ({ width }));
  sheet.getColumn('J').hidden = true;
  sheet.getColumn('K').hidden = true;
  sheet.getColumn('B').alignment = { vertical: 'middle', wrapText: true };
  sheet.getColumn('D').numFmt = '#,##0.00######" ₽"';
  sheet.getColumn('E').numFmt = '#,##0.########';
  for (const column of ['F', 'G', 'H']) sheet.getColumn(column).numFmt = moneyFormat;
  sheet.getColumn('I').numFmt = '0.00%';

  const source = `'${sourceSheet.name.replaceAll("'", "''")}'!`;
  function linkedValue(address) {
    return {
      formula: `IF(ISBLANK(${source}${address}),"",${source}${address})`,
      result: sourceSheet.getCell(address).value ?? '',
    };
  }

  styleTitle(sheet, 1, 9, 'Прибыль по смете');
  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = { formula: `"Расчёт · "&${source}A1`, result: `Расчёт · ${title}` };
  sheet.getCell('A3').value = 'Доля';
  sheet.mergeCells('C3:I3');
  sheet.getCell('C3').value = 'Доля себестоимости от суммы позиции. 80% взяты из примера, значение можно изменить.';
  sheet.mergeCells('A4:I4');
  sheet.getCell('A4').value = 'В расчёт включаются позиции с суммой. Маржа — доля прибыли от суммы по смете.';
  sheet.mergeCells('A5:I5');
  sheet.getCell('A5').value = 'Суммы вне числовой точности Excel отображаются текстом. Итоги по таким строкам помечаются отдельно.';
  for (const number of [2, 3, 4, 5]) {
    const row = sheet.getRow(number);
    styleTableRow(row, 9);
    row.height = 18;
  }
  const ratio = sheet.getCell('B3');
  ratio.value = Number(costPercent) / 100;
  styleInput(ratio);
  ratio.alignment = { horizontal: 'center', vertical: 'middle' };
  ratio.numFmt = '0.00%';
  ratio.dataValidation = {
    type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
    showErrorMessage: true, errorStyle: 'stop', error: 'Введите долю себестоимости от 0%.',
  };
  styleHeader(sheet.addRow(['№', 'Позиция', 'Ед. изм.', 'Цена за ед., ₽', 'Количество', 'По смете, ₽', 'Себестоимость, ₽', 'Прибыль, ₽', 'Маржа']));

  function appendSection(sourceRow) {
    const row = sheet.addRow([linkedValue(`A${sourceRow}`)]);
    sheet.mergeCells(row.number, 1, row.number, 9);
    styleSection(row);
    row.getCell('A').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  function appendItem({ row: sourceRow }) {
    const row = sheet.addRow(['A', 'B', 'C', 'D', 'E', 'F'].map((column) => linkedValue(`${column}${sourceRow}`)));
    const { number } = row;
    const revenue = amountInCents(sourceSheet.getCell(`F${sourceRow}`).value);
    const cost = estimatedCost(revenue);
    const saleRef = `F${number}`;
    const costExpr = `ROUND(${saleRef}*$B$3,2)`;
    row.getCell('G').value = {
      formula: `IF(AND(ISTEXT(${saleRef}),${saleRef}<>""),"${precisionWarning}",IF(AND(ISNUMBER(${saleRef}),ISNUMBER($B$3),$B$3>=0),IF(ABS(${costExpr})>=${excelLimitRubles},"${precisionWarning}",${costExpr}),""))`,
      result: resultAmount(cost),
    };
    putProfit(row, revenue, cost);
    styleTableRow(row, 9);
    for (const column of ['A', 'C', 'D', 'E']) {
      row.getCell(column).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    for (const column of ['F', 'G', 'H', 'I']) {
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    }
    const label = sourceSheet.getCell(`B${sourceRow}`).value;
    if (typeof label === 'string' && label.length > 74) row.height = 14 * Math.ceil(label.length / 74);
    return { number, revenue, cost };
  }

  function appendTotal(label, lines) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, 5);
    const revenue = sumAmounts(lines, 'revenue');
    const cost = sumAmounts(lines, 'cost');
    if (lines.length) {
      row.getCell('F').value = { formula: sumFormula('F', lines), result: resultAmount(revenue) };
      row.getCell('G').value = { formula: sumFormula('G', lines), result: resultAmount(cost) };
      putProfit(row, revenue, cost);
    }
    styleTotal(row);
    for (const column of ['F', 'G', 'H', 'I']) {
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    }
    return { number: row.number, revenue, cost };
  }

  const stageTotals = stages.map((stage) => {
    appendSection(stage.titleRow);
    const groupTotals = stage.groups.map((group) => {
      appendSection(group.titleRow);
      return appendTotal('Итого по подблоку', group.items.map(appendItem));
    });
    return appendTotal('Итого по этапу', groupTotals);
  });
  const total = appendTotal('Итого по смете', stageTotals);
  sheet.pageSetup.printArea = `A1:I${total.number}`;
}

module.exports = { appendProfitSheet };
