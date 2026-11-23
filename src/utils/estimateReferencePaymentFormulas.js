const referenceStages = [
  'фундамент',
  'стены',
  'кровля',
  'окна двери',
  'отделка',
  'сантехника, электрика, финишные работы',
  'доставка разгрузка',
];

function groupItems(stage, type) {
  const matches = (stage.groups ?? []).filter((group) => group.type === type);
  return matches.length === 1 ? matches[0].items : null;
}

function findReferenceEstimateStages(stages) {
  const matchedStages = referenceStages.map((title) => {
    const matches = stages.filter((stage) => (
      stage.title?.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').replace(/\.$/, '') === title
    ));
    return matches.length === 1 ? matches[0] : null;
  });
  return matchedStages.includes(null) ? null : matchedStages;
}

function getReferenceEstimateSubtotals(sourceSheet, stages) {
  const matchedStages = findReferenceEstimateStages(stages);
  if (!matchedStages) return null;
  const source = `'${sourceSheet.name.replaceAll("'", "''")}'`;

  // Приложение складывает произведения цены и количества с полной точностью.
  function subtotal(items) {
    if (!items?.length) return null;
    const first = items[0].row;
    const last = items.at(-1).row;
    if (!Number.isSafeInteger(first) || first < 1) return null;

    let result = 0;
    for (const [index, { row }] of items.entries()) {
      if (row !== first + index) return null;
      const price = sourceSheet.getCell(row, 4).value;
      const quantity = sourceSheet.getCell(row, 5).value;
      if (!Number.isFinite(price) || !Number.isFinite(quantity)) return null;
      result += price * quantity;
    }
    return { formula: `SUMPRODUCT(${source}!D${first}:D${last},${source}!E${first}:E${last})`, result };
  }

  function stageSubtotal(stage, requiredTypes) {
    if (!requiredTypes.every((type) => groupItems(stage, type)?.length)) return null;
    const parts = stage.groups.map((group) => subtotal(group.items));
    if (parts.includes(null)) return null;
    return {
      formula: parts.map((part) => part.formula).join('+'),
      result: parts.reduce((sum, part) => sum + part.result, 0),
    };
  }

  return { matchedStages, source, subtotal, stageSubtotal };
}

function getReferencePaymentAmounts(sourceSheet, stages) {
  const estimate = getReferenceEstimateSubtotals(sourceSheet, stages);
  if (!estimate) return null;
  const { matchedStages, source, subtotal, stageSubtotal } = estimate;
  const [foundation, walls, roof, windows, finishing, engineering, delivery] = matchedStages;
  const wallMaterialItems = groupItems(walls, 'material');
  const engineeringWorkItems = groupItems(engineering, 'work');
  if (!wallMaterialItems?.length || (engineeringWorkItems?.length ?? 0) < 7) return null;

  const foundationTotal = stageSubtotal(foundation, ['material', 'work']);
  const wallMaterials = subtotal(wallMaterialItems);
  const wallWork = subtotal(groupItems(walls, 'work'));
  const roofMaterials = subtotal(groupItems(roof, 'material'));
  const roofWork = subtotal(groupItems(roof, 'work'));
  const windowMaterials = subtotal(groupItems(windows, 'material'));
  const windowWork = subtotal(groupItems(windows, 'work'));
  const finishingMaterials = subtotal(groupItems(finishing, 'material'));
  const finishingWork = subtotal(groupItems(finishing, 'work'));
  const engineeringMaterials = subtotal(groupItems(engineering, 'material'));
  const engineeringWork = subtotal(engineeringWorkItems);
  const finalEngineeringWork = subtotal(engineeringWorkItems.slice(2, 7));
  const deliveryTotal = stageSubtotal(delivery, ['work']);
  if ([
    foundationTotal, wallMaterials, wallWork, roofMaterials, roofWork, windowMaterials, windowWork,
    finishingMaterials, finishingWork, engineeringMaterials, engineeringWork, finalEngineeringWork, deliveryTotal,
  ].includes(null)) return null;

  const logPriceRow = wallMaterialItems[0].row;
  const logPrice = sourceSheet.getCell(logPriceRow, 4).value;
  const logPriceFormula = `${source}!D${logPriceRow}`;
  const advance = { formula: `${logPriceFormula}*10+200000`, result: logPrice * 10 + 200000 };
  const secondDelivery = { formula: `${logPriceFormula}*30`, result: logPrice * 30 };

  return [
    advance,
    foundationTotal,
    {
      formula: `${wallMaterials.formula}+${roofMaterials.formula}+${wallWork.formula}*0.5+${deliveryTotal.formula}-C7`,
      result: wallMaterials.result + roofMaterials.result + wallWork.result * 0.5 + deliveryTotal.result - secondDelivery.result,
    },
    secondDelivery,
    {
      formula: `${wallWork.formula}*0.5+${roofWork.formula}*0.5+100000`,
      result: wallWork.result * 0.5 + roofWork.result * 0.5 + 100000,
    },
    {
      formula: `${roofWork.formula}*0.5+${windowMaterials.formula}+${finishingMaterials.formula}`
        + `+${engineeringMaterials.formula}+${engineeringWork.formula}*0.5-C4-167000`,
      result: roofWork.result * 0.5 + windowMaterials.result + finishingMaterials.result + engineeringMaterials.result
        + engineeringWork.result * 0.5 - advance.result - 167000,
    },
    {
      formula: `${windowWork.formula}*0.5+${finishingWork.formula}*0.5+${engineeringWork.formula}*0.5`,
      result: windowWork.result * 0.5 + finishingWork.result * 0.5 + engineeringWork.result * 0.5,
    },
    { formula: `${finishingWork.formula}*0.5`, result: finishingWork.result * 0.5 },
    { formula: `${finalEngineeringWork.formula}+340`, result: finalEngineeringWork.result + 340 },
  ];
}

module.exports = { findReferenceEstimateStages, getReferenceEstimateSubtotals, getReferencePaymentAmounts };
