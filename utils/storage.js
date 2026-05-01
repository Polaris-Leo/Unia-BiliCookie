import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

const DEFAULT_DATA = {
  version: 1,
  accounts: [],
  settings: {
    // 自动验证间隔（秒），默认 6 小时
    validateInterval: 21600,
    autoValidate: true,
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 从文件加载全部数据
 * @returns {Object}
 */
export function loadData() {
  try {
    ensureDataDir();
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      saveData(DEFAULT_DATA);
      return structuredClone(DEFAULT_DATA);
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // 补全缺失的 settings 字段
    data.settings = { ...DEFAULT_DATA.settings, ...(data.settings || {}) };
    return data;
  } catch (error) {
    console.error('❌ 加载数据失败:', error.message);
    return structuredClone(DEFAULT_DATA);
  }
}

/**
 * 将数据持久化写入文件
 * @param {Object} data
 * @returns {boolean}
 */
export function saveData(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('❌ 保存数据失败:', error.message);
    return false;
  }
}
