import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import accountsRoutes from './routes/accounts.js';
import { startAutoValidation } from './services/accountManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3100', 10);

// 配置 CORS，允许来自其他本地服务的跨域访问
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'bili-cookie-manager',
  });
});

// 未知 API 路由返回 404 JSON
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// SPA 回退（非 API 请求）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('🍪 B站 Cookie 管理工具已启动');
  console.log(`📡 服务地址: http://localhost:${PORT}`);
  console.log(`📚 管理界面: http://localhost:${PORT}`);
  console.log(`🔌 Cookie接口: http://localhost:${PORT}/api/accounts/cookie`);
  console.log('');
  startAutoValidation();
});
