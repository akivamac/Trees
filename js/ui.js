import { EQUIPPABLE } from './state.js?v=18';

const SEASON_LABELS = { summer: 'Summer', fall: 'Fall', winter: 'Winter', spring: 'Spring' };

export function updateUI(state) {
  updateVitals(state.player);
  updateTimeDisplay(state.time);
  updateWeatherDisplay(state.time.weather);
  updateSkills(state.skills);
  updateJournal(state.journal);
  updateInventory(state.inventory, state.equippedTool);
  updateEquipped(state.equippedTool);
}

function updateVitals(player) {
  setBar('health',  player.health,  getVitalColor('health',  player.health));
  setBar('hunger',  player.hunger,  getVitalColor('hunger',  player.hunger));
  setBar('thirst',  player.thirst,  getVitalColor('thirst',  player.thirst));
  setBar('stamina', player.stamina, getVitalColor('stamina', player.stamina));
  setBar('warmth',  player.warmth,  getVitalColor('warmth',  player.warmth));
  setBar('sleep',   player.sleep,   getVitalColor('sleep',   player.sleep));
}

function setBar(name, value, color) {
  const bar = document.getElementById('bar-' + name);
  if (!bar) return;
  const pct = Math.max(0, Math.min(100, value));
  bar.style.width = pct + '%';
  bar.style.background = color;
}

function getVitalColor(type, value) {
  if (value > 60) {
    const colors = {
      health: '#4caf50', hunger: '#ff9800', thirst: '#2196f3',
      stamina: '#8bc34a', warmth: '#ff7043', sleep: '#9c27b0',
    };
    return colors[type] || '#4caf50';
  }
  if (value > 30) return '#ffc107';
  return '#f44336';
}

function updateTimeDisplay(time) {
  const h = time.hour;
  const m = Math.floor(time.minute);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  const el = document.getElementById('time-display');
  if (el) el.textContent = `Day ${time.day} · ${timeStr}`;
  const season = document.getElementById('season-display');
  if (season) season.textContent = SEASON_LABELS[time.season] || time.season;
}

const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
function updateWeatherDisplay(weather) {
  const el = document.getElementById('weather-display');
  if (!el || !weather) return;
  const icon = { clear: '☀️', overcast: '☁️', rain: '🌧️' }[weather.condition] || '☀️';
  const dir  = WIND_DIRS[Math.round(weather.wind.dir / 45) % 8];
  const spd  = Math.round(weather.wind.speed);
  const key  = weather.condition + spd + dir;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.textContent = `${icon} ${weather.condition.charAt(0).toUpperCase() + weather.condition.slice(1)} · Wind ${dir} ${spd}mph`;
}

function updateSkills(skills) {
  for (const [name, value] of Object.entries(skills)) {
    const el = document.getElementById('skill-' + name);
    if (el) el.textContent = value;
  }
}

function updateJournal(entries) {
  const container = document.getElementById('journal-entries');
  if (!container) return;
  if (container.dataset.count == entries.length) return;
  container.dataset.count = entries.length;
  container.innerHTML = entries
    .slice(-20).reverse()
    .map(e => `<p class="journal-entry"><span class="journal-day">Day ${e.day}</span> — ${e.text}</p>`)
    .join('');
}

function updateInventory(inventory, equippedTool) {
  const section = document.getElementById('section-inventory');
  if (!section) return;
  const key = inventory.map(i => i.name + i.quantity).join(',') + '|' + equippedTool;
  if (section.dataset.key === key) return;
  section.dataset.key = key;

  const h3 = section.querySelector('h3').outerHTML;
  if (inventory.length === 0) {
    section.innerHTML = h3 + '<p class="empty-note">Empty</p>';
    return;
  }

  const rows = inventory.filter(item => item.quantity > 0).map(item => {
    const isTool = EQUIPPABLE.includes(item.name);
    const isEquipped = item.name === equippedTool;
    return `<div class="inv-row">
      <span class="inv-name">${item.name}</span>
      ${item.quantity > 1 ? `<span class="inv-qty">×${item.quantity}</span>` : ''}
      ${isTool ? `<button class="inv-equip-btn${isEquipped ? ' equipped' : ''}" data-item="${item.name}">${isEquipped ? 'Equipped' : 'Equip'}</button>` : ''}
    </div>`;
  }).join('');

  section.innerHTML = h3 + rows;
}

function updateEquipped(equippedTool) {
  const section = document.getElementById('section-tools');
  if (!section) return;
  if (section.dataset.equipped === String(equippedTool)) return;
  section.dataset.equipped = String(equippedTool);
  const h3 = section.querySelector('h3').outerHTML;
  section.innerHTML = equippedTool
    ? h3 + `<p class="equipped-name">${equippedTool}</p>`
    : h3 + '<p class="empty-note">Nothing equipped</p>';
}
