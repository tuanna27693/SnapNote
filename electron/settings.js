import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const defaults = { hotkey: 'Ctrl+Shift+A', autoCheckUpdates: true, launchAtStartup: false };
const data = { ...defaults };
const file = () => path.join(app.getPath('userData'), 'settings.json');

export async function load() {
  try {
    Object.assign(data, JSON.parse(await fs.readFile(file(), 'utf8')));
  } catch {}
}

export const get = (key) => data[key];
export const all = () => ({ ...data });
export const has = (key) => key in defaults;

export async function set(key, value) {
  data[key] = value;
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(data, null, 2));
}
