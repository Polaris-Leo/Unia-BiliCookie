import express from 'express';
import {
  getAccounts,
  removeAccount,
  validateAccount,
  validateAll,
  getValidCookie,
  getAccountCookie,
  accountEvents,
} from '../services/accountManager.js';

const router = express.Router();

/**
 * GET /api/accounts/cookie
 * 获取当前可用的有效 Cookie（外部服务集成入口）
 * 注意：必须在 /:uid 路由之前注册，避免被参数路由拦截
 */
router.get('/cookie', (req, res) => {
  const result = getValidCookie();
  if (result) {
    res.json({ success: true, data: result });
  } else {
    res.status(503).json({
      success: false,
      message: '暂无可用的有效 Cookie，请先添加账号或执行验证',
    });
  }
});

/**
 * GET /api/accounts/stream
 * SSE 实时账号状态推送
 * 事件类型：
 *   init              — 初始账号列表（连接建立时推送）
 *   account-update    — 单个账号状态变更
 *   validation-complete — 全量验证完成
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁止 nginx 缓冲
  res.flushHeaders();

  // 推送初始账号列表
  const initial = getAccounts().map(({ cookies: _omit, ...rest }) => rest);
  res.write(`event: init\ndata: ${JSON.stringify(initial)}\n\n`);

  // 保持连接心跳（每 25 秒一次，防止代理超时断连）
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  const onAccountUpdate = (account) => {
    res.write(`event: account-update\ndata: ${JSON.stringify(account)}\n\n`);
  };
  const onValidationComplete = (results) => {
    res.write(`event: validation-complete\ndata: ${JSON.stringify(results)}\n\n`);
  };
  const onAllInvalid = () => {
    res.write(`event: all-invalid\ndata: {}\n\n`);
  };

  accountEvents.on('account-update', onAccountUpdate);
  accountEvents.on('validation-complete', onValidationComplete);
  accountEvents.on('all-invalid', onAllInvalid);

  req.on('close', () => {
    clearInterval(heartbeat);
    accountEvents.off('account-update', onAccountUpdate);
    accountEvents.off('validation-complete', onValidationComplete);
    accountEvents.off('all-invalid', onAllInvalid);
  });
});

/**
 * GET /api/accounts
 * 获取所有账号列表（不含 Cookie 值）
 */
router.get('/', (req, res) => {
  const accounts = getAccounts();
  const sanitized = accounts.map(({ cookies: _omit, ...rest }) => rest);
  res.json({ success: true, data: sanitized, count: sanitized.length });
});

/**
 * POST /api/accounts/validate-all
 * 触发全部账号验证
 */
router.post('/validate-all', async (req, res) => {
  try {
    const results   = await validateAll();
    const validCount = results.filter(r => r.isValid).length;
    res.json({
      success: true,
      data: results,
      summary: {
        total:   results.length,
        valid:   validCount,
        invalid: results.length - validCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/accounts/:uid/cookie
 * 获取指定账号的 Cookie
 */
router.get('/:uid/cookie', (req, res) => {
  const result = getAccountCookie(req.params.uid);
  if (result) {
    res.json({ success: true, data: result });
  } else {
    res.status(404).json({ success: false, message: '账号不存在' });
  }
});

/**
 * POST /api/accounts/:uid/validate
 * 验证单个账号的 Cookie 有效性
 */
router.post('/:uid/validate', async (req, res) => {
  try {
    const account = await validateAccount(req.params.uid);
    if (account) {
      res.json({ success: true, data: account });
    } else {
      res.status(404).json({ success: false, message: '账号不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/accounts/:uid
 * 删除指定账号
 */
router.delete('/:uid', (req, res) => {
  const removed = removeAccount(req.params.uid);
  if (removed) {
    res.json({ success: true, message: '账号已删除' });
  } else {
    res.status(404).json({ success: false, message: '账号不存在' });
  }
});

export default router;
