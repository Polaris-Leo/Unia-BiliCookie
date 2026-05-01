# Unia-BiliCookie

B站多账号 Cookie 管理工具。支持扫码登录多个账号，自动验证 Cookie 有效性，并提供统一的 HTTP API 供其他服务（如 Unia-Danmuku）调用，实现当单一账号 Cookie 失效时的自动故障转移。

## 功能

- **多账号管理**：扫码登录任意数量的 B站账号
- **自动验证**：服务启动及每 6 小时自动调用 B站接口校验 Cookie 有效性
- **故障转移**：`GET /api/accounts/cookie` 始终返回当前有效的账号 Cookie
- **Web 管理界面**：可视化查看账号状态、手动触发验证、删除账号、复制 Cookie
- **数据持久化**：账号信息存储在本地 JSON 文件，服务重启后数据不丢失

## 快速开始

### 安装依赖

```bash
cd bili-cookie-manager
npm install
```

### 启动服务

```bash
npm start
# 或开发模式（代码变更自动重启）
npm run dev
```

服务默认监听 `http://localhost:3100`，打开浏览器访问即可进入管理界面。

### Docker 镜像打包

```bash
docker build -t nakiripolaris/unia-bilicookie:latest .
```

### 使用 Docker CLI 运行

```bash
docker run -d \
  --name bili-cookie-manager \
  --restart unless-stopped \
  -p 3100:3100 \
  -v "$(pwd)/data:/app/data" \
  -e PORT=3100 \
  bili-cookie-manager:latest
```

运行后访问 `http://localhost:3100` 即可进入管理界面。

如需限制跨域来源，可额外传入环境变量：

```bash
docker run -d \
  --name bili-cookie-manager \
  --restart unless-stopped \
  -p 3100:3100 \
  -v "$(pwd)/data:/app/data" \
  -e PORT=3100 \
  -e ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080 \
  bili-cookie-manager:latest
```

### 添加账号

1. 打开 `http://localhost:3100`
2. 点击「添加账号」
3. 用 **B站 APP** 扫描弹窗中的二维码并确认登录
4. 账号 Cookie 自动保存，可在列表中看到账号状态

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts/cookie` | **获取当前有效 Cookie**（外部集成入口）|
| GET | `/api/accounts` | 获取账号列表（不含 Cookie 值）|
| POST | `/api/accounts/validate-all` | 触发全部账号验证 |
| GET | `/api/accounts/:uid/cookie` | 获取指定账号的 Cookie |
| POST | `/api/accounts/:uid/validate` | 验证指定账号 |
| DELETE | `/api/accounts/:uid` | 删除指定账号 |
| GET | `/api/health` | 健康检查 |

### 响应格式

```json
// GET /api/accounts/cookie
{
  "success": true,
  "data": {
    "uid": "123456789",
    "username": "B站用户名",
    "cookies": {
      "SESSDATA": "...",
      "bili_jct": "...",
      "DedeUserID": "...",
      "DedeUserID__ckMd5": "...",
      "buvid3": "...",
      "buvid4": "...",
      "sid": "..."
    }
  }
}
```

Cookie 格式与 Unia-Danmuku 的 `backend/data/cookies.json` 完全兼容。

## 与 Unia-Danmuku 集成

在 Unia-Danmuku 中，修改 `backend/src/utils/cookieStorage.js` 的 `loadCookies` 函数，改为从本服务获取 Cookie：

```js
// 示例：从 Cookie 管理服务获取有效 Cookie
import axios from 'axios';

const COOKIE_MANAGER_URL = process.env.COOKIE_MANAGER_URL || 'http://localhost:3100';

export async function loadCookies() {
  try {
    const res = await axios.get(`${COOKIE_MANAGER_URL}/api/accounts/cookie`, { timeout: 5000 });
    if (res.data.success) return res.data.data.cookies;
  } catch (e) {
    console.warn('Cookie 管理服务不可用，回退到本地文件:', e.message);
  }
  // 回退：读取本地 cookies.json（原有逻辑）
  // ...
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3100` | 服务监听端口 |
| `ALLOWED_ORIGINS` | `*` | 允许跨域的来源（逗号分隔），生产环境建议设置 |

## 数据存储

账号数据存储在 `data/accounts.json`，已加入 `.gitignore`，不会被提交到版本库。

> **安全提示**：Cookie 中包含账号凭证，请确保 `data/` 目录不被公开访问，并限制服务只在内网运行。

## 项目结构

```
bili-cookie-manager/
├── server.js                 # Express 服务入口
├── package.json
├── routes/
│   ├── auth.js               # 二维码登录路由
│   └── accounts.js           # 账号管理路由
├── services/
│   ├── bilibiliAuth.js       # B站 API（二维码、buvid、用户信息验证）
│   └── accountManager.js     # 多账号管理逻辑 + 定时验证
├── utils/
│   └── storage.js            # JSON 文件存储
├── public/
│   ├── index.html            # 管理界面
│   ├── style.css
│   └── app.js
└── data/                     # 运行时数据目录（gitignored）
    └── accounts.json
```
