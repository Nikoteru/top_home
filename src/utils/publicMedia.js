const { existsSync } = require('node:fs');
const path = require('node:path');

const projectIllustrations = new Map([
  ['/images/placeholder-1.svg', '/images/site/horizon.webp'],
  ['/images/placeholder-2.svg', '/images/site/minimal.webp'],
  ['/images/placeholder-3.svg', '/images/individual-house.webp'],
  ['/images/placeholder-4.svg', '/images/site/panorama.webp'],
  ['/images/placeholder-5.svg', '/images/site/compact.webp'],
]);

const samplePhoto = /^\/images\/(?:gallery-\d+-\d+|stages\/stage-\d+-\d+)\.svg$/;
const uploadsDirectory = path.join(__dirname, '..', '..', 'public', 'uploads');

function availableImage(source) {
  return typeof source === 'string' && Boolean(source) && (
    !source.startsWith('/uploads/') || existsSync(path.join(uploadsDirectory, path.basename(source)))
  );
}

function publicPhotos(photos) {
  return (Array.isArray(photos) ? photos : []).filter((photo) => availableImage(photo) && !samplePhoto.test(photo));
}

function projectMedia(house) {
  const photos = publicPhotos(house.gallery);
  const image = availableImage(house.image) ? house.image : null;
  const illustration = projectIllustrations.get(image);
  const cover = (illustration ? photos[0] || illustration : image || photos[0]) || '/images/placeholder-new.svg';
  return { cover, photos: photos.length ? photos : [cover], illustrated: cover === illustration };
}

function portfolioMedia(item) {
  const photos = publicPhotos(item.photos);
  const illustrated = !photos.length && item.photos?.[0] === '/images/gallery-1-1.svg';
  const cover = illustrated ? projectIllustrations.get('/images/placeholder-1.svg') : photos[0];
  return { cover, photos: illustrated ? [cover] : photos, illustrated };
}

module.exports = { availableImage, publicPhotos, projectMedia, portfolioMedia };
