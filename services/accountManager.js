import { EventEmitter } from 'events';
import { fetchUserInfo, refreshCookie, parseSessdataExpiry } from './bilibiliAuth.js';
import { loadData, saveData } from '../utils/storage.js';

// ---- 实时事件总线 ----
// account-update   : { uid, username, avatar, isValid, lastValidated, addedAt }
// validation-complete: Array<{ uid, username, isValid }>
export const accountEvents = new EventEmitter();
accountEvents.setMaxListeners(100); // 允许大量 SSE 连接

// ---- 基础 CRUD ----

/**
 * 获取所有账号（含 cookie）
 * @returns {Array}
 */
export function getAccounts() {
  return loadData().accounts;
}

/**
 * 获取单个账号
 * @param {string} uid
 * @returns {Object|null}
 */
export function getAccount(uid) {
  return loadData().accounts.find(a => a.uid === uid) || null;
}

/**
 * 添加或更新账号
 * 登录成功后调用，自动校验 Cookie 并写入用户信息
 * @param {string} uid - 初始 DedeUserID
 * @param {Object} cookieObj - 完整 Cookie 对象
 * @returns {Promise<Object>} 保存后的账号对象
 */
export async function addAccount(uid, cookieObj) {
  const data = loadData();

  // 通过 B站 NAV 接口拉取真实用户信息并验证 Cookie
  const info = await fetchUserInfo(cookieObj);

  // 合并 NAV 接口可能下发的附加 Cookie（SESSDATA 续期、ticket 等）
  if (info.extraCookies && Object.keys(info.extraCookies).length > 0) {
    Object.assign(cookieObj, info.extraCookies);
  }

  const realUid = info.valid ? info.uid : uid;
  const existing = data.accounts.find(a => a.uid === realUid);
  const isUpdate = !!existing;

  const sessdataExpiry = parseSessdataExpiry(cookieObj.SESSDATA || '');

  const account = {
    uid:             realUid,
    username:        info.valid ? info.username : `UID:${uid}`,
    avatar:          info.valid ? info.avatar : null,
    cookies:         cookieObj,
    addedAt:         existing?.addedAt ?? new Date().toISOString(),
    lastValidated:   new Date().toISOString(),
    isValid:         info.valid,
    sessdataExpiry,  // Unix 时间戳（秒），null 表示无法解析
  };

  const idx = data.accounts.findIndex(a => a.uid === account.uid);
  if (idx >= 0) {
    data.accounts[idx] = account;
    console.log(`🔄 更新账号: ${account.username} (${account.uid})`);
  } else {
    data.accounts.push(account);
    console.log(`✅ 新增账号: ${account.username} (${account.uid})`);
  }

  saveData(data);

  // 通知 SSE 客户端实时刷新（不含 cookies 字段）
  const { cookies: _omit, ...sanitized } = account;
  accountEvents.emit('account-update', sanitized);

  return { ...account, isUpdate };
}

/**
 * 删除账号
 * @param {string} uid
 * @returns {boolean}
 */
export function removeAccount(uid) {
  const data = loadData();
  const before = data.accounts.length;
  data.accounts = data.accounts.filter(a => a.uid !== uid);
  if (data.accounts.length < before) {
    saveData(data);
    console.log(`🗑️  已删除账号 UID: ${uid}`);
    return true;
  }
  return false;
}

// ---- 验证 ----

/**
 * 验证单个账号的 Cookie 是否有效，有效时同步检查并尝试续期
 * @param {string} uid
 * @returns {Promise<Object|null>} 更新后的账号对象，不含 cookies 字段
 */
export async function validateAccount(uid) {
  const data = loadData();
  const account = data.accounts.find(a => a.uid === uid);
  if (!account) return null;

  const info = await fetchUserInfo(account.cookies);
  account.lastValidated = new Date().toISOString();
  account.isValid = info.valid;
  let refreshed = false;

  if (info.valid) {
    account.username = info.username;
    account.avatar   = info.avatar;
    if (info.extraCookies && Object.keys(info.extraCookies).length > 0) {
      Object.assign(account.cookies, info.extraCookies);
    }

    const expiry = parseSessdataExpiry(account.cookies.SESSDATA || '');
    account.sessdataExpiry = expiry;
    const daysLeft = expiry ? (expiry - Date.now() / 1000) / 86400 : null;

    if (daysLeft === null || daysLeft <= 7) {
      const newCookies = await refreshCookie(account.cookies);
      if (newCookies) {
        account.cookies = newCookies;
        account.sessdataExpiry = parseSessdataExpiry(newCookies.SESSDATA || '') ?? expiry;
        refreshed = true;
        console.log(`🔄 ${account.username} (${account.uid}) Cookie 已自动续期`);
      }
    }
  } else {
    account.sessdataExpiry = null;
  }

  saveData(data);

  const { cookies: _omit, ...sanitized } = { ...account, refreshed };
  accountEvents.emit('account-update', sanitized);
  return sanitized;
}

/**
 * 验证全部账号，并对即将过期的有效账号自动续期
 * @returns {Promise<Array<{uid, username, isValid, sessdataExpiry, refreshed}>>}
 */
export async function validateAll() {
  const data = loadData();
  const results = [];

  console.log(`🔍 开始验证 ${data.accounts.length} 个账号...`);

  for (const account of data.accounts) {
    const info = await fetchUserInfo(account.cookies);
    account.lastValidated = new Date().toISOString();
    account.isValid = info.valid;
    let refreshed = false;

    if (info.valid) {
      account.username = info.username;
      account.avatar   = info.avatar;
      // 合并 NAV 刷新的附加 Cookie
      if (info.extraCookies && Object.keys(info.extraCookies).length > 0) {
        Object.assign(account.cookies, info.extraCookies);
      }

      // 解析 SESSDATA 过期时间，若剩余 ≤ 7 天则主动续期
      const expiry = parseSessdataExpiry(account.cookies.SESSDATA || '');
      account.sessdataExpiry = expiry;
      const daysLeft = expiry ? (expiry - Date.now() / 1000) / 86400 : null;

      if (daysLeft === null || daysLeft <= 7) {
        const reason = daysLeft === null ? '无法解析过期时间，尝试续期' : `剩余 ${daysLeft.toFixed(1)} 天，触发自动续期`;
        console.log(`🔄 ${account.username} (${account.uid}): ${reason}`);
        const newCookies = await refreshCookie(account.cookies);
        if (newCookies) {
          account.cookies = newCookies;
          account.sessdataExpiry = parseSessdataExpiry(newCookies.SESSDATA || '') ?? expiry;
          refreshed = true;
          console.log(`  ✅ 续期成功，新过期时间: ${account.sessdataExpiry ? new Date(account.sessdataExpiry * 1000).toLocaleDateString('zh-CN') : '未知'}`);
        } else {
          console.log(`  ⚠️  续期未返回新 Cookie，保持原有 Cookie`);
        }
      }
    } else {
      // 账号失效时清空过期信息（避免显示陈旧数据）
      account.sessdataExpiry = null;
    }

    results.push({
      uid:            account.uid,
      username:       account.username,
      isValid:        info.valid,
      sessdataExpiry: account.sessdataExpiry,
      refreshed,
    });
    console.log(`  ${info.valid ? (refreshed ? '🔄' : '✅') : '❌'} ${account.username} (${account.uid})`);

    // 实时推送当前账号的验证结果
    const { cookies: _omit, ...sanitized } = account;
    accountEvents.emit('account-update', sanitized);
  }

  saveData(data);

  // 若全部账号均已失效，发送告警事件
  const validCount = results.filter(r => r.isValid).length;
  if (data.accounts.length > 0 && validCount === 0) {
    console.warn('🚨 所有账号 Cookie 均已失效！请登录新账号。');
    accountEvents.emit('all-invalid');
  }

  accountEvents.emit('validation-complete', results);
  return results;
}

// ---- Cookie 对外供给 ----

/**
 * 获取当前标记为有效的第一个账号的 Cookie
 * 策略：优先选取最近验证的有效账号，无需每次重新验证（由定时任务保持状态新鲜）
 * @returns {{uid, username, cookies}|null}
 */
export function getValidCookie() {
  const accounts = loadData().accounts;
  const validAccounts = accounts.filter(a => a.isValid === true);
  if (validAccounts.length === 0) return null;

  // 优先选取最近验证的有效账号
  validAccounts.sort(
    (a, b) => new Date(b.lastValidated || 0) - new Date(a.lastValidated || 0)
  );

  const account = validAccounts[0];
  return {
    uid:      account.uid,
    username: account.username,
    cookies:  account.cookies,
  };
}

/**
 * 获取指定账号的 Cookie
 * @param {string} uid
 * @returns {{uid, username, isValid, cookies}|null}
 */
export function getAccountCookie(uid) {
  const account = loadData().accounts.find(a => a.uid === uid);
  if (!account) return null;
  return {
    uid:      account.uid,
    username: account.username,
    isValid:  account.isValid,
    cookies:  account.cookies,
  };
}

// ---- 自动定时验证 ----

let validationTimer = null;

/**
 * 启动定时自动验证（服务启动时调用一次）
 */
export function startAutoValidation() {
  const data = loadData();
  if (!data.settings?.autoValidate) return;

  const intervalSec = data.settings.validateInterval || 21600;
  const intervalMs  = intervalSec * 1000;
  const hours       = intervalSec / 3600;

  console.log(`⏰ 自动验证已启用（每 ${hours} 小时）`);

  // 服务启动时立即执行一次验证
  if (data.accounts.length > 0) {
    validateAll()
      .then(results => {
        const valid = results.filter(r => r.isValid).length;
        console.log(`✅ 启动验证完成: ${valid}/${results.length} 个账号有效`);
      })
      .catch(e => console.error('启动验证失败:', e.message));
  }

  if (validationTimer) clearInterval(validationTimer);
  validationTimer = setInterval(async () => {
    const accounts = getAccounts();
    if (accounts.length === 0) return;
    console.log('⏰ 执行定时 Cookie 验证...');
    const results = await validateAll();
    const valid   = results.filter(r => r.isValid).length;
    console.log(`✅ 定时验证完成: ${valid}/${results.length} 个账号有效`);
  }, intervalMs);
}
