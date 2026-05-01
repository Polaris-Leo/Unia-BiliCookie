import axios from 'axios';
import QRCode from 'qrcode';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BILIBILI_API = {
  QR_GENERATE: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  QR_POLL:     'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
  FINGER_SPI:  'https://api.bilibili.com/x/frontend/finger/spi',
  NAV:         'https://api.bilibili.com/x/web-interface/nav',
};

export const QR_CODE_STATUS = {
  SUCCESS:     0,      // 扫码登录成功
  KEY_ERROR:   86038,  // 二维码已失效
  NOT_SCANNED: 86101,  // 未扫码
  SCANNED:     86090,  // 已扫码，待确认
};

/**
 * 生成登录二维码
 * @returns {Promise<{url, qrcode_key, qrcode_image, expires_in}>}
 */
export async function generateQRCode() {
  const response = await axios.get(BILIBILI_API.QR_GENERATE, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.bilibili.com',
    },
    timeout: 10000,
  });

  if (response.data.code !== 0) {
    throw new Error(`B站API错误: ${response.data.message}`);
  }

  const { url, qrcode_key } = response.data.data;
  const qrcode_image = await QRCode.toDataURL(url, {
    width: 280,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  return { url, qrcode_key, qrcode_image, expires_in: 180 };
}

/**
 * 轮询二维码扫描状态
 * @param {string} qrcode_key
 * @returns {Promise<{data, cookies}>}
 */
export async function pollQRCode(qrcode_key) {
  const response = await axios.get(BILIBILI_API.QR_POLL, {
    params: { qrcode_key },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000,
  });

  const setCookieHeader = response.headers['set-cookie'];
  let cookies = null;

  if (setCookieHeader && response.data.data.code === QR_CODE_STATUS.SUCCESS) {
    cookies = parseCookies(setCookieHeader);
  }

  return { data: response.data.data, cookies };
}

/**
 * 使用已登录 Cookie 从B站指纹接口获取 buvid3/buvid4
 * @param {Object} cookieObj
 * @returns {Promise<{buvid3, buvid4}|null>}
 */
export async function fetchBuvid(cookieObj) {
  try {
    const cookieStr = buildCookieString(cookieObj);
    const response = await axios.get(BILIBILI_API.FINGER_SPI, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.bilibili.com/',
        'Cookie': cookieStr,
      },
      timeout: 5000,
    });

    // 收集响应 set-cookie 中的所有附加字段（buvid_fp、b_nut 等）
    const extra = {};
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      parseCookies(setCookieHeader).forEach(c => {
        if (c.name && c.value) extra[c.name] = c.value;
      });
    }

    if (response.data.code === 0 && response.data.data) {
      return {
        buvid3: response.data.data.b_3,
        buvid4: response.data.data.b_4,
        ...extra,
      };
    }
    return Object.keys(extra).length > 0 ? extra : null;
  } catch (e) {
    console.warn('⚠️  获取 buvid 失败:', e.message);
  }
  return null;
}

/**
 * 验证 Cookie 有效性并获取用户信息
 * 通过调用 /x/web-interface/nav 检测登录态
 * @param {Object} cookieObj
 * @returns {Promise<{valid, uid, username, avatar}|{valid: false}>}
 */
export async function fetchUserInfo(cookieObj) {
  try {
    const cookieStr = buildCookieString(cookieObj);
    const response = await axios.get(BILIBILI_API.NAV, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.bilibili.com/',
        'Cookie': cookieStr,
      },
      timeout: 10000,
    });

    // 捕获 NAV 接口可能下发的刷新 Cookie（SESSDATA 续期、ticket 等）
    const extraCookies = {};
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      parseCookies(setCookieHeader).forEach(c => {
        if (c.name && c.value) extraCookies[c.name] = c.value;
      });
    }

    if (response.data.code === 0 && response.data.data?.isLogin) {
      const { mid, uname, face } = response.data.data;
      return {
        valid: true,
        uid: String(mid),
        username: uname,
        avatar: face,
        extraCookies,
      };
    }
    return { valid: false, extraCookies };
  } catch (e) {
    console.warn('⚠️  获取用户信息失败:', e.message);
    return { valid: false, extraCookies: {} };
  }
}

/**
 * 主动调用 B站 cookie/update 接口续期 SESSDATA
 * 适用于 Cookie 仍有效但即将过期的场景，不需要用户重新扫码
 * @param {Object} cookieObj
 * @returns {Promise<Object|null>} 续期后的新 Cookie 对象，失败返回 null
 */
export async function refreshCookie(cookieObj) {
  try {
    const cookieStr = buildCookieString(cookieObj);
    const response = await axios.post(
      'https://passport.bilibili.com/x/passport-login/web/cookie/update',
      new URLSearchParams({
        csrf:   cookieObj.bili_jct || '',
        source: 'main_web',
      }),
      {
        headers: {
          'User-Agent':   USER_AGENT,
          'Referer':      'https://www.bilibili.com/',
          'Origin':       'https://www.bilibili.com',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie':        cookieStr,
        },
        timeout: 10000,
      }
    );

    if (response.data.code === 0) {
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader && setCookieHeader.length > 0) {
        const newCookies = { ...cookieObj };
        parseCookies(setCookieHeader).forEach(c => {
          if (c.name && c.value) newCookies[c.name] = c.value;
        });
        return newCookies;
      }
    }
    return null;
  } catch (e) {
    console.warn('⚠️  Cookie 续期失败:', e.message);
    return null;
  }
}

/**
 * 解析 SESSDATA 中内嵌的过期 Unix 时间戳（秒）
 * SESSDATA URL解码后格式：token,timestamp,suffix*hash
 * @param {string} sessdata
 * @returns {number|null}
 */
export function parseSessdataExpiry(sessdata) {
  if (!sessdata) return null;
  try {
    const decoded = decodeURIComponent(sessdata);
    // 去掉可能存在的引号（某些存储格式）
    const clean = decoded.replace(/^["']|["']$/g, '');
    const parts = clean.split(',');
    if (parts.length >= 2) {
      const ts = parseInt(parts[1], 10);
      // 合理范围：2020-01-01 ~ 2100-01-01
      if (!isNaN(ts) && ts > 1577836800 && ts < 4102444800) return ts;
    }
  } catch {}
  return null;
}

/**
 * 将 cookie 对象转换为请求头字符串
 * @param {Object} cookieObj
 * @returns {string}
 */
export function buildCookieString(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ---- 内部工具 ----

function parseCookies(setCookieArray) {
  return setCookieArray.map(cookieStr => {
    const [nameValue] = cookieStr.split(';');
    const eqIdx = nameValue.indexOf('=');
    const name  = nameValue.substring(0, eqIdx).trim();
    const value = nameValue.substring(eqIdx + 1).trim();
    return { name, value };
  });
}
