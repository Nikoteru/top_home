// Небольшая обёртка для чтения/записи содержимого сайта (src/data/content.json).
// Никакой базы данных не нужно — для одной админки хватает JSON-файла на диске.
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'content.json');

function getContent() {
  const raw = fs.readFileSync(FILE_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveContent(content) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(content, null, 2), 'utf8');
}

module.exports = { getContent, saveContent };
