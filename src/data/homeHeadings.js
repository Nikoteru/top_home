const DEFAULT_HOME_HEADINGS = {
  advantages: '5 причин выбрать одноэтажный дом',
  projects: 'Топ‑5 проектов',
  stages: 'Как строится дом',
  design: 'Индивидуальное проектирование',
  portfolio: 'Портфолио домов',
  request: 'Получите подробную презентацию проектов',
};

function getHomeHeadings(content) {
  return { ...DEFAULT_HOME_HEADINGS, ...content.homeHeadings };
}

module.exports = { DEFAULT_HOME_HEADINGS, getHomeHeadings };
