const { getReferenceEstimateSubtotals } = require('./estimateReferencePaymentFormulas');

function getReferenceScheduleAmounts(sourceSheet, stages) {
  const estimate = getReferenceEstimateSubtotals(sourceSheet, stages);
  if (!estimate) return null;

  const { matchedStages, stageSubtotal } = estimate;
  const [foundation, walls, roof, windows, finishing, engineering, delivery] = matchedStages;
  const amounts = [foundation, walls, roof, windows, finishing, delivery, engineering].map((stage) => {
    if (!Number.isSafeInteger(stage.titleRow) || stage.titleRow < 1) return null;
    const subtotal = stageSubtotal(stage, stage === delivery ? ['work'] : ['material', 'work']);
    return subtotal && { ...subtotal, titleRow: stage.titleRow };
  });
  return amounts.includes(null) ? null : amounts;
}

module.exports = { getReferenceScheduleAmounts };
