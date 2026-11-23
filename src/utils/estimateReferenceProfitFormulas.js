const { findReferenceEstimateStages } = require('./estimateReferencePaymentFormulas');

const costShare = 0.8;
const referenceProfitSections = [
  { totalRow: 11, groups: [{ type: 'material', firstRow: 4, lastRow: 6 }, { type: 'work', firstRow: 8, lastRow: 9 }] },
  { totalRow: 25, groups: [{ type: 'material', firstRow: 12, lastRow: 20 }, { type: 'work', firstRow: 22, lastRow: 23 }] },
  { totalRow: 48, groups: [{ type: 'material', firstRow: 26, lastRow: 35 }, { type: 'work', firstRow: 37, lastRow: 46 }] },
  { totalRow: 67, groups: [{ type: 'material', firstRow: 49, lastRow: 57 }, { type: 'work', firstRow: 59, lastRow: 65 }] },
  { totalRow: 104, groups: [{ type: 'material', firstRow: 68, lastRow: 85 }, { type: 'work', firstRow: 87, lastRow: 102 }] },
  { totalRow: 121, groups: [{ type: 'material', firstRow: 105, lastRow: 111 }, { type: 'work', firstRow: 113, lastRow: 119 }] },
  { totalRow: 129, groups: [{ type: 'work', firstRow: 125, lastRow: 128 }], delivery: true },
];

function referencedName(address, name, originalName) {
  const prefix = originalName.slice(0, originalName.length - originalName.trimStart().length);
  const suffix = originalName.slice(originalName.trimEnd().length);
  return {
    formula: [prefix && JSON.stringify(prefix), address, suffix && JSON.stringify(suffix)].filter(Boolean).join('&'),
    result: prefix + name + suffix,
  };
}

function getReferenceProfitRows(sourceSheet, stages, referenceProfit) {
  const matched = findReferenceEstimateStages(stages);
  if (!matched) return null;

  const source = `'${sourceSheet.name.replaceAll("'", "''")}'!`;
  const rows = new Map();
  const materials = [];
  const works = [];

  function putTotal(row, formula, inputRows) {
    const result = inputRows.reduce((sum, number) => sum + rows.get(number).amount.result, 0);
    rows.set(row, { amount: { formula, result } });
  }

  for (const [index, section] of referenceProfitSections.entries()) {
    const stage = matched[index];
    if (stage.groups.length !== section.groups.length) return null;

    const groupRows = [];
    for (const { type, firstRow, lastRow } of section.groups) {
      const group = stage.groups.find((entry) => entry.type === type);
      if (group?.items.length !== lastRow - firstRow + 1) return null;

      const itemRows = [];
      for (const [offset, { row: sourceRow }] of group.items.entries()) {
        const row = firstRow + offset;
        const position = referenceProfit.positions[row];
        const salePrice = sourceSheet.getCell(`D${sourceRow}`).value;
        const quantity = sourceSheet.getCell(`E${sourceRow}`).value;
        const name = sourceSheet.getCell(`B${sourceRow}`).value;
        if (!position || typeof name !== 'string' || !Number.isFinite(salePrice) || !Number.isFinite(quantity)) return null;
        const supplierPrice = salePrice * costShare;
        rows.set(row, {
          name: referencedName(`${source}B${sourceRow}`, name, position.name),
          unit: position.unit,
          price: { formula: `${source}D${sourceRow}*${costShare}`, result: supplierPrice },
          quantity: { formula: `${source}E${sourceRow}`, result: quantity },
          amount: { formula: row === 8 ? 'F8*E8' : `E${row}*F${row}`, result: supplierPrice * quantity },
        });
        itemRows.push(row);
      }

      const groupRow = lastRow + 1;
      putTotal(groupRow, `SUM(G${firstRow}:G${lastRow})`, itemRows);
      groupRows.push(groupRow);
      if (!section.delivery) (type === 'material' ? materials : works).push(groupRow);
    }

    const firstRow = section.groups[0].firstRow;
    rows.get(firstRow).stage = referenceProfit.stageLabels[firstRow] ?? stage.title;
    if (!section.delivery) {
      if (section.totalRow === 104) groupRows.reverse();
      putTotal(section.totalRow, groupRows.map((row) => `G${row}`).join('+'), groupRows);
    }
  }

  putTotal(122, materials.map((row) => `G${row}`).join('+'), materials);
  putTotal(123, works.map((row) => `G${row}`).join('+'), works);
  putTotal(124, 'SUM(G122:G123)', [122, 123]);
  putTotal(131, 'G124+G129', [124, 129]);
  return rows;
}

module.exports = { getReferenceProfitRows, referenceProfitSections };
