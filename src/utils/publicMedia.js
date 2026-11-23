const { existsSync } = require('node:fs');
const path = require('node:path');

const DEFAULT_PROJECT_COVER = '/images/placeholder-new.svg';
const projectIllustrations = new Map([
  ['/images/placeholder-1.svg', '/images/site/horizon.webp'],
  ['/images/placeholder-2.svg', '/images/site/minimal.webp'],
  ['/images/placeholder-3.svg', '/images/individual-house.webp'],
  ['/images/placeholder-4.svg', '/images/site/panorama.webp'],
  ['/images/placeholder-5.svg', '/images/site/compact.webp'],
]);

const samplePhoto = /^\/images\/(?:gallery-\d+-\d+|stages\/stage-\d+-\d+)\.svg$/;
const stageExample = /^\/images\/stages\/stage-\d+-\d+\.svg$/;
const illustratedStages = new Set(['1', '2', '3', '4', '7', '10', '21', '22']);
const uploadsDirectory = path.join(__dirname, '..', '..', 'public', 'uploads');

function availableImage(source) {
  return typeof source === 'string' && Boolean(source) && (
    !source.startsWith('/uploads/') || existsSync(path.join(uploadsDirectory, path.basename(source)))
  );
}

function publicPhotos(photos) {
  return (Array.isArray(photos) ? photos : []).filter((photo) => availableImage(photo) && !samplePhoto.test(photo));
}

function stageGallery(stage) {
  const sources = Array.isArray(stage.photos) ? stage.photos : [];
  const photos = [];
  const examples = [];
  for (const [storedIndex, src] of sources.entries()) {
    if (!availableImage(src)) continue;
    if (stageExample.test(src)) examples.push({ src, kind: 'example', storedIndex });
    else photos.push({ src, kind: 'photo', storedIndex });
  }

  const id = String(stage.id);
  if (examples.length && illustratedStages.has(id)) {
    photos.push({ src: `/images/stages/illustrations/stage-${id}.webp`, kind: 'illustration' });
  }
  return photos.concat(examples);
}

function projectMedia(house) {
  const gallery = [...new Set((Array.isArray(house.gallery) ? house.gallery : []).filter(availableImage))];
  const projectPhotos = gallery.filter((photo) => !samplePhoto.test(photo));
  const examplePhotos = gallery.filter((photo) => samplePhoto.test(photo));
  const savedCover = availableImage(house.image) ? house.image : DEFAULT_PROJECT_COVER;
  const illustration = projectIllustrations.get(savedCover);
  const usesPlaceholder = savedCover === DEFAULT_PROJECT_COVER || Boolean(illustration);
  const cover = usesPlaceholder ? projectPhotos[0] || illustration || savedCover : savedCover;
  const photos = [cover, ...[...projectPhotos, ...examplePhotos].filter((photo) => photo !== cover)];
  return { cover, photos, illustrated: cover === illustration, examplePhotos };
}

function portfolioMedia(item) {
  const photos = publicPhotos(item.photos);
  const illustrated = !photos.length && item.photos?.[0] === '/images/gallery-1-1.svg';
  const cover = illustrated ? projectIllustrations.get('/images/placeholder-1.svg') : photos[0];
  return { cover, photos: illustrated ? [cover] : photos, illustrated };
}

module.exports = { DEFAULT_PROJECT_COVER, availableImage, stageGallery, projectMedia, portfolioMedia };
