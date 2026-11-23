const { getHomeHeadings } = require('../data/homeHeadings');
const { availableImage, stageGallery } = require('./publicMedia');

const defaultDesignText = 'Если у вас есть эскиз или несколько удачных примеров, обсудим их с архитектором и разработаем дом с учётом участка, планировки и бюджета.';
const defaultDesignImage = '/images/individual-studio.webp';

function getHomePage(content) {
  const hero = content.hero;
  const illustrated = !availableImage(hero.image) || hero.image === '/images/placeholder-hero.svg';
  const design = content.homeDesign;

  return {
    hero: { ...hero, image: illustrated ? '/images/site/hero.webp' : hero.image, illustrated },
    headings: getHomeHeadings(content),
    projects: content.houses.filter((house) => house.showOnHome !== false),
    stages: (content.stages || []).slice(0, 4).map((stage) => ({
      id: stage.id,
      title: stage.title,
      cover: stageGallery(stage).find((image) => image.kind !== 'example'),
    })),
    portfolio: (content.portfolio || []).slice(0, 3),
    advantages: content.advantages.map((item) => ({ ...item, image: availableImage(item.image) ? item.image : null })),
    design: {
      text: typeof design?.text === 'string' ? design.text : defaultDesignText,
      image: availableImage(design?.image) ? design.image : defaultDesignImage,
    },
  };
}

module.exports = { getHomePage };
