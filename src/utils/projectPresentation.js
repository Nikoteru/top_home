const fs = require('node:fs/promises');
const path = require('node:path');
const { buffer } = require('node:stream/consumers');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { getHouseParameterFields } = require('./houseParameters');
const { getHouseInclusions } = require('./houseInclusions');

const fontsDirectory = path.join(__dirname, '..', 'assets', 'fonts');

function filledText(value) {
  return String(value ?? '').trim();
}

function getProjectPresentationDetails(house, calculator) {
  const summary = [
    { label: 'Площадь дома', value: filledText(house.area) },
    { label: 'Цена', value: filledText(house.price) },
  ].filter(({ value }) => value);
  const descriptions = [
    { label: 'Краткое описание', value: filledText(house.description) },
    { label: 'Полное описание', value: filledText(house.fullDescription) },
  ].filter(({ value }) => value);
  const parameters = getHouseParameterFields(house, calculator).map((field) => ({
    label: filledText(field.title),
    value: field.options
      .filter((option) => field.selectedIds.includes(String(option.id)))
      .map((option) => filledText(option.title)).filter(Boolean).join(', '),
  })).filter(({ value }) => value);
  const additional = (house.specs || []).map((spec) => ({
    label: filledText(spec.label), value: filledText(spec.value),
  })).filter(({ label, value }) => label || value);
  return { summary, descriptions, parameters, additional };
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== '..'
    && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function* projectPhotos(house, publicDirectory) {
  const root = await fs.realpath(publicDirectory);
  const references = new Set([house.image, ...(house.gallery || [])]);
  for (const reference of references) {
    if (typeof reference !== 'string' || !/^\/(?:images|uploads)\//.test(reference)) continue;
    const candidate = path.resolve(root, '.' + reference);
    if (!isInside(root, candidate)) continue;

    try {
      const file = await fs.realpath(candidate);
      if (!isInside(root, file)) continue;
      const image = await fs.readFile(file);
      yield await sharp(image)
        .rotate()
        .resize({ width: 1600, height: 1100, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 83 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      // Пропущенное или повреждённое фото не мешает выгрузке остальных данных.
    }
  }
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function addPhoto(doc, { data, info }, maxHeight) {
  const { left, right } = doc.page.margins;
  const available = doc.page.width - left - right;
  const scale = Math.min(available / info.width, maxHeight / info.height);
  const width = info.width * scale;
  const height = info.height * scale;
  if (doc.y + height > pageBottom(doc)) doc.addPage();
  const y = doc.y;
  doc.image(data, left + (available - width) / 2, y, { width, height });
  doc.x = left;
  doc.y = y + height + 12;
}

function addHeading(doc, text, fontSize = 16) {
  doc.moveDown(0.7);
  if (doc.y + 42 > pageBottom(doc)) doc.addPage();
  doc.font('bold').fontSize(fontSize).fillColor('#272b24').text(text);
  doc.moveDown(0.4);
}

function addDetails(doc, heading, rows) {
  if (!rows.length) return;
  addHeading(doc, heading);
  doc.fontSize(11).fillColor('#40443d');
  for (const { label, value } of rows) {
    if (label && value) {
      doc.font('bold').text(label, { continued: true });
      doc.font('regular').text(`   ·   ${value}`, { lineGap: 2 });
    } else {
      doc.font(label ? 'bold' : 'regular').text(label || value, { lineGap: 2 });
    }
  }
}

function addProjectInclusions(doc, inclusions) {
  const sections = [...inclusions.sections, ...inclusions.unassigned];
  if (!sections.length && !inclusions.note) return;
  addHeading(doc, inclusions.title);
  for (const section of sections) {
    addHeading(doc, section.title, 13);
    doc.fontSize(11).fillColor('#40443d');
    for (const item of section.items) {
      doc.font('bold').text(item.title);
      if (item.description) doc.font('regular').text(item.description, { lineGap: 2 });
      doc.moveDown(0.35);
    }
  }
  if (inclusions.note) {
    doc.moveDown(0.35);
    doc.font('regular').fontSize(11).fillColor('#40443d').text(inclusions.note, { lineGap: 2 });
  }
}

async function buildProjectPdf(house, calculator, publicDirectory, stages) {
  const details = getProjectPresentationDetails(house, calculator);
  const photos = projectPhotos(house, publicDirectory);
  const { value: cover } = await photos.next();
  const doc = new PDFDocument({
    size: 'A4', margin: 44, lang: 'ru-RU', info: { Title: house.title },
  });
  doc.registerFont('regular', path.join(fontsDirectory, 'NotoSans-Regular.ttf'));
  doc.registerFont('bold', path.join(fontsDirectory, 'NotoSans-Bold.ttf'));

  doc.font('bold').fontSize(28).fillColor('#272b24').text(house.title, { lineGap: 2 });
  if (details.summary.length) {
    const summary = details.summary.map(({ label, value }) => `${label} ${value}`).join('   ·   ');
    doc.font('regular').fontSize(14).fillColor('#765638').text(summary);
  }
  doc.moveDown(0.8);
  if (cover) addPhoto(doc, cover, 308);

  for (const { label, value } of details.descriptions) {
    addHeading(doc, label);
    doc.font('regular').fontSize(11).fillColor('#40443d').text(value, { lineGap: 3 });
  }

  addDetails(doc, 'Параметры проекта', details.parameters);
  addDetails(doc, 'Дополнительные характеристики', details.additional);
  addProjectInclusions(doc, getHouseInclusions(house, stages));

  let galleryStarted = false;
  for await (const photo of photos) {
    if (!galleryStarted) {
      doc.addPage();
      addHeading(doc, 'Фотографии проекта');
      galleryStarted = true;
    }
    addPhoto(doc, photo, 308);
  }

  const output = buffer(doc);
  doc.end();
  return output;
}

module.exports = { buildProjectPdf, getProjectPresentationDetails };
