// Persistent button storage using file system
const fs = require('fs');
const path = require('path');

const STORAGE_FILE = path.join(__dirname, 'buttons.json');

// Load buttons from file
function loadButtons() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      const buttons = JSON.parse(data);
      console.log(`Loaded ${buttons.length} buttons from storage`);
      return Array.isArray(buttons) ? buttons : [];
    }
  } catch (error) {
    console.error('Error loading buttons from storage:', error);
  }
  return [];
}

// Save buttons to file
function saveButtons(buttons) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(buttons, null, 2), 'utf8');
    console.log(`Saved ${buttons.length} buttons to storage`);
  } catch (error) {
    console.error('Error saving buttons to storage:', error);
  }
}

module.exports = { loadButtons, saveButtons };

