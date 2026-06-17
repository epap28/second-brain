const fs = require('fs');
const path = require('path');
const { DataModel } = require('./dataModel');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'second-brain.json');

function ensureDataFileExists() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const model = new DataModel();
    const payload = JSON.stringify(model.serialize(), null, 2);
    fs.writeFileSync(DATA_FILE, payload, 'utf-8');
  }
}

function loadData() {
  ensureDataFileExists();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  ensureCollections(parsed);
  return new DataModel(parsed);
}

function saveData(model) {
  const serialized = model.serialize();
  fs.writeFileSync(DATA_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
}

function exportData() {
  ensureDataFileExists();
  return fs.readFileSync(DATA_FILE, 'utf-8');
}

function importData(rawJson) {
  if (!rawJson) {
    throw new Error('No data provided');
  }
  const parsed = JSON.parse(rawJson);
  // Basic shape validation
  if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.notes)) {
    throw new Error('Invalid data format');
  }
  ensureCollections(parsed);
  fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
  return new DataModel(parsed);
}

function ensureCollections(data) {
  if (!Array.isArray(data.aiComments)) {
    data.aiComments = [];
  } else {
    data.aiComments = data.aiComments.map((comment) => ({
      ...comment,
      dismissed: Boolean(comment.dismissed),
    }));
  }
}

module.exports = {
  loadData,
  saveData,
  exportData,
  importData,
  DATA_FILE,
};
