const defaultTitle = 'Что входит в стоимость';

class HouseInclusionsError extends Error {}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function savedSections(house) {
  return Array.isArray(house.inclusions?.sections) ? house.inclusions.sections : [];
}

function sectionStageId(section, stages) {
  if (section.stageId !== undefined) return String(section.stageId ?? '');
  const title = text(section.title).toLowerCase();
  const match = stages.find((stage) => text(stage.title).toLowerCase() === title);
  return match ? String(match.id) : '';
}

function getHouseInclusions(house, stages) {
  const saved = house.inclusions;
  const availableStages = stages || [];
  const byStage = new Map(availableStages.map(({ id, title }) => [String(id), { stageId: String(id), title, items: [] }]));
  const unassigned = [];
  for (const [index, section] of savedSections(house).entries()) {
    if (!Array.isArray(section?.items) || section.items.length === 0) continue;
    const stage = byStage.get(sectionStageId(section, availableStages));
    if (stage) stage.items.push(...section.items);
    else unassigned.push({ index, title: section.title, items: section.items });
  }

  return {
    title: text(saved?.title) || defaultTitle,
    note: text(saved?.note),
    sections: [...byStage.values()].filter(({ items }) => items.length > 0),
    unassigned,
  };
}

function normalizeHouseInclusions(draft, stages, house) {
  if (!Array.isArray(draft?.sections)) {
    throw new HouseInclusionsError('Проверьте список этапов комплектации.');
  }

  const titles = new Map(stages.map(({ id, title }) => [String(id), title]));
  const byStage = new Map();
  for (const section of draft.sections) {
    const stageId = section?.stageId;
    const id = typeof stageId === 'number' ? String(stageId) : text(stageId);
    const title = titles.get(id);
    if (!title) throw new HouseInclusionsError('Этап не найден в разделе «Этапы стройки». Обновите страницу.');
    if (byStage.has(id) || !Array.isArray(section.items)) {
      throw new HouseInclusionsError(`Проверьте пункты этапа «${title}».`);
    }
    const items = section.items.map((item, itemIndex) => {
      const name = text(item?.title);
      const description = text(item?.description);
      if (!name) throw new HouseInclusionsError(`Укажите название пункта ${itemIndex + 1} этапа «${title}».`);
      if (!description) throw new HouseInclusionsError(`Заполните описание пункта «${name}» этапа «${title}».`);
      return { title: name, description };
    });
    byStage.set(id, items);
  }

  const unassigned = [];
  for (const { index, title, items } of getHouseInclusions(house, stages).unassigned) {
    const id = text(draft.assignments?.[index]);
    if (!id) {
      unassigned.push({ stageId: null, title, items });
      continue;
    }
    if (!titles.has(id)) throw new HouseInclusionsError('Выберите существующий этап для переноса пунктов.');
    byStage.set(id, [...(byStage.get(id) || []), ...items]);
  }

  const sections = [];
  for (const [stageId, title] of titles) {
    const items = byStage.get(stageId);
    if (items?.length) sections.push({ stageId, title, items });
  }
  sections.push(...unassigned);

  return { title: text(draft.title) || defaultTitle, note: text(draft.note), sections };
}

function updateHouseInclusionStage(houses, stages, stage, stageId, title) {
  for (const house of houses) {
    for (const section of savedSections(house)) {
      if (section && sectionStageId(section, stages) === String(stage.id)) {
        section.stageId = stageId;
        section.title = title;
      }
    }
  }
}

module.exports = { HouseInclusionsError, getHouseInclusions, normalizeHouseInclusions, updateHouseInclusionStage };
