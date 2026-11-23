const ExcelJS = require('exceljs');
const { evaluateEstimate, getWorksheetRows } = require('../../public/js/estimate-formulas');
const { moneyFormat, styleTableRow, styleHeader, styleSection, styleTotal } = require('./estimateAppendixStyles');
const { appendPaymentsSheet } = require('./estimatePaymentsSheet');
const { getReferencePaymentAmounts } = require('./estimateReferencePaymentFormulas');
const { appendReferencePaymentsSheet } = require('./estimateReferencePaymentsSheet');
const { appendScheduleSheet } = require('./estimateScheduleSheet');
const { getReferenceScheduleAmounts } = require('./estimateReferenceScheduleFormulas');
const { appendReferenceScheduleSheet } = require('./estimateReferenceScheduleSheet');
const { appendProfitSheet } = require('./estimateProfitSheet');
const { getReferenceProfitRows } = require('./estimateReferenceProfitFormulas');
const { appendReferenceProfitSheet } = require('./estimateReferenceProfitSheet');

const positionAlignments = ['center', 'left', 'center', 'center', 'center', 'right'];

function excelAmount(cents) {
  if (cents === null) return null;
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  // Сохраняем точную сумму текстом, если она выходит за числовую точность Excel.
  if (absolute < 1000000000000000n) return Number(value) / 100;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${fraction}`;
}

function buildEstimateWorkbook(run, { includeAppendices = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Смета', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    properties: { defaultRowHeight: 15 },
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 10 / 25.4, right: 10 / 25.4, top: 10 / 25.4, bottom: 19 / 25.4, header: 8 / 25.4, footer: 8 / 25.4 },
      printTitlesRow: '2:3',
    },
  });
  const headers = ['№', 'Наименование', 'Ед. изм.', 'Цена за ед.', 'Количество', 'Сумма'];
  sheet.columns = [9.2, 89.66, 13.66, 12.66, 11.66, 14.44].map((width) => ({ width }));
  sheet.getColumn(4).numFmt = '#,##0.00######" ₽"';
  sheet.getColumn(5).numFmt = '#,##0.########';
  sheet.getColumn(6).numFmt = moneyFormat;

  function addSection(label, height, horizontal) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, headers.length);
    styleSection(row, headers.length);
    row.height = height;
    row.getCell(1).alignment = { horizontal, vertical: 'middle', wrapText: true };
    return row.number;
  }

  function addSubtotal(label, cents, height = 15) {
    const row = sheet.addRow([label, null, null, null, null, excelAmount(cents)]);
    sheet.mergeCells(row.number, 1, row.number, headers.length - 1);
    styleTotal(row, headers.length);
    row.height = height;
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(6).alignment = { horizontal: 'right', vertical: 'middle', shrinkToFit: true };
    return row.number;
  }

  addSection(run.title, 30, 'right');
  const source = sheet.addRow(['Шаблон', run.template.title]);
  sheet.mergeCells(source.number, 2, source.number, headers.length);
  styleHeader(source, headers.length);
  source.height = 24.75;
  const header = sheet.addRow(headers);
  styleHeader(header, headers.length);
  header.height = 19.5;

  const { rows, amountCents } = evaluateEstimate(run.template, run.entries);
  const positions = getWorksheetRows(run.template).keys();
  const stages = [];
  let total = 0n;
  for (const stage of run.template.stages) {
    const titleRow = addSection(`Этап · ${stage.title}`, 17.25, 'center');
    const groups = [];
    let stageTotal = 0n;
    for (const group of stage.groups) {
      const groupTitleRow = addSection(group.type === 'material' ? 'Материалы' : 'Работы', 15, 'left');
      const items = [];
      let groupTotal = 0n;
      for (const [index, item] of group.items.entries()) {
        const row = positions.next().value;
        const { price, quantity } = rows[row];
        const amount = amountCents[row];
        const exported = sheet.addRow([index + 1, item.title, item.unit, price, quantity, excelAmount(amount)]);
        styleTableRow(exported, headers.length);
        exported.eachCell({ includeEmpty: true }, (cell, column) => {
          cell.alignment = {
            horizontal: positionAlignments[column - 1],
            vertical: 'middle',
            wrapText: column <= 3,
            shrinkToFit: column > 3,
          };
        });
        items.push({ row: exported.number });
        groupTotal += BigInt(amount ?? 0);
      }
      const totalRow = addSubtotal('Итого по подблоку', groupTotal);
      groups.push({ type: group.type, titleRow: groupTitleRow, totalRow, items });
      stageTotal += groupTotal;
    }
    const totalRow = addSubtotal('Итого по этапу', stageTotal);
    stages.push({ title: stage.title, titleRow, totalRow, groups });
    total += stageTotal;
  }
  const totalRow = addSubtotal('Итого по смете', total, 18);
  sheet.pageSetup.printArea = `A1:F${totalRow}`;
  if (includeAppendices) {
    const context = { title: run.title, sourceSheet: sheet, totalRow, stages };
    const paymentSchedule = run.referencePaymentSchedule;
    const paymentAmounts = paymentSchedule && getReferencePaymentAmounts(sheet, stages);
    if (paymentAmounts) appendReferencePaymentsSheet(workbook, { schedule: paymentSchedule, amounts: paymentAmounts });
    else appendPaymentsSheet(workbook, context);

    const paymentSheet = workbook.getWorksheet('Приложение№3');
    const constructionSchedule = run.referenceConstructionSchedule;
    const stageAmounts = constructionSchedule && paymentAmounts && getReferenceScheduleAmounts(sheet, stages);
    if (stageAmounts) {
      appendReferenceScheduleSheet(workbook, {
        schedule: constructionSchedule,
        amounts: stageAmounts,
        sourceSheet: sheet,
        paymentSheet,
      });
    } else {
      appendScheduleSheet(workbook, { ...context, referencePayments: Boolean(paymentAmounts) });
    }

    const profitRows = run.referenceProfit && paymentAmounts && getReferenceProfitRows(sheet, stages, run.referenceProfit);
    if (profitRows) appendReferenceProfitSheet(workbook, { rows: profitRows, paymentSheet });
    else appendProfitSheet(workbook, context);
    workbook.calcProperties.fullCalcOnLoad = true;
  }
  return workbook;
}

module.exports = { buildEstimateWorkbook };
