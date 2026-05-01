import express from 'express';
import {
  generateQRCode,
  pollQRCode,
  fetchBuvid,
  QR_CODE_STATUS,
} from '../services/bilibiliAuth.js';
import { addAccount } from '../services/accountManager.js';

const router = express.Router();

/**
 * GET /api/auth/qrcode
 * 生成B站登录二维码
 */
router.get('/qrcode', async (req, res) => {
  try {
    const data = await generateQRCode();
    res.json({ success: true, data });
  } catch (error) {
    console.error('生成二维码失败:', error.message);
    res.status(500).json({ success: false, message: `生成二维码失败: ${error.message}` });
  }
});

/**
 * GET /api/auth/poll?key=xxx
 * 轮询二维码扫描状态，扫码成功时自动保存账号
 */
router.get('/poll', async (req, res) => {
  const { key } = req.query;
  if (!key) {
    return res.status(400).json({ success: false, message: '缺少 key 参数' });
  }

  try {
    const result = await pollQRCode(key);
    const statusCode = result.data.code;

    // 扫码成功
    if (statusCode === QR_CODE_STATUS.SUCCESS && result.cookies) {
      // 组装 cookie 对象
      const cookieObj = {};
      result.cookies.forEach(c => {
        if (c.name && c.value) cookieObj[c.name] = c.value;
      });

      // 获取与账号绑定的 buvid 及 finger/spi 接口下发的所有附加 Cookie
      const buvid = await fetchBuvid(cookieObj);
      if (buvid) {
        Object.assign(cookieObj, buvid); // 合并 buvid3、buvid4、buvid_fp、b_nut 等全部字段
      }

      const uid = cookieObj.DedeUserID;
      if (uid) {
        const account = await addAccount(uid, cookieObj);
        return res.json({
          success: true,
          data: result.data,
          isUpdate: account.isUpdate,
          account: {
            uid:      account.uid,
            username: account.username,
            avatar:   account.avatar,
            isValid:  account.isValid,
          },
        });
      }
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('轮询二维码失败:', error.message);
    res.status(500).json({ success: false, message: `轮询失败: ${error.message}` });
  }
});

export default router;
