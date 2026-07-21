# WebAR 多人协同应用

基于 **A-Frame + MindAR** 的 WebAR 多人实时协同应用。用户拍照上传图片作为 AR 触发目标（Image Target），识别后在图片上方展示 DOM Overlay UI，支持多人实时协同编辑。

---

## ✨ 功能特性

- 📷 **图片采集** — 移动端拍照或从相册选择图片作为 AR 识别目标
- 🧠 **图片编译** — 浏览器端使用 MindAR Compiler 将图片编译为 `.mind` 特征文件
- 🎯 **图像追踪** — 使用 A-Frame + MindAR 实现实时图像识别与追踪
- 📝 **协作留言** — 识别后在目标上方展示多人协同 UI（文字、表情）
- 🔴 **实时同步** — Socket.IO 房间管理，多人编辑实时广播
- 👤 **用户标识** — 不同用户以不同颜色区分，含昵称和在线状态
- 📱 **移动端适配** — 响应式设计、安全区适配、触摸事件优化

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Vite |
| AR 引擎 | A-Frame 1.5.0 + MindAR 1.2.5 |
| 实时通信 | Socket.IO 4.x |
| 后端 | Node.js + Express |
| 文件上传 | Multer |

---

## 📁 项目结构

```
mydemo/
├── .github/workflows/
│   └── deploy.yml              # GitHub Actions 自动部署
├── server/
│   ├── package.json
│   ├── index.js                # Express + Socket.IO 服务
│   └── uploads/                # 上传文件 (gitignored)
├── client/
│   ├── package.json
│   ├── vite.config.js          # Vite 配置（含 proxy + GitHub Pages base）
│   ├── .env.development        # 开发环境变量
│   ├── .env.production         # 生产环境变量
│   ├── index.html              # 加载 A-Frame / MindAR CDN
│   └── src/
│       ├── main.js
│       ├── App.vue
│       ├── config.js           # 全局配置（API_BASE / SOCKET_URL）
│       ├── router/index.js
│       ├── views/
│       │   ├── HomeView.vue    # 图片上传与编译
│       │   └── ARView.vue      # AR 场景 + Overlay + 协同
│       ├── components/
│       │   ├── ImageUploader.vue
│       │   ├── ARScene.vue
│       │   ├── DOMOverlay.vue
│       │   ├── UserElement.vue
│       │   ├── EditorToolbar.vue
│       │   └── UserPresence.vue
│       └── composables/
│           ├── useSocket.js
│           ├── useMindAR.js
│           └── useCollaboration.js
└── README.md
```

---

## 🚀 本地开发

### 环境要求

- **Node.js** >= 18
- **手机与电脑在同一局域网**（用于手机测试）

### 第一步：启动后端

```bash
cd server
npm install
npm start
```

后端默认监听 `http://localhost:3000`。

### 第二步：启动前端

```bash
cd client
npm install
npm run dev
```

Vite 开发服务器运行在 `http://localhost:5173`（同时监听 `0.0.0.0`）。

### 第三步：在手机上测试（本地开发）

1. 手机与电脑连接**同一 WiFi**
2. 查看电脑的局域网 IP (`ipconfig` → `IPv4 地址`)
3. 手机浏览器访问 `http://<局域网IP>:5173`

> ⚠️ 手机端摄像头要求 **HTTPS** 或 **localhost**。如果通过局域网 IP（非 localhost），浏览器会拒绝摄像头权限。本地开发建议用 **ngrok** 创建 HTTPS 隧道，或直接部署到 GitHub Pages（见下方）。

---

## 🌐 部署到 GitHub Pages + Render（推荐手机测试方案）

这是最适合手机测试的方案：**前端部署到 GitHub Pages（免费 HTTPS），后端部署到 Render（免费，支持 WebSocket）**。

### 架构图

```
手机浏览器 (HTTPS)
    │
    ├──→ GitHub Pages (静态文件) — client/dist/
    │      https://<user>.github.io/mydemo/
    │
    └──→ Render (Node.js 后端)
           https://xxx.onrender.com
           ├── /api/targets/image     (图片上传)
           ├── /api/targets/mind      (.mind 上传)
           ├── /uploads/*             (静态文件)
           └── Socket.IO WebSocket    (实时协同)
```

### 一、后端部署到 Render

Render 支持 WebSocket 一键部署，有免费额度。

1. 登录 [render.com](https://render.com)（用 GitHub 账号登录）
2. 点击 **New +** → **Web Service**
3. 连接你的 GitHub 仓库
4. 配置如下：

| 配置项 | 值 |
|--------|-----|
| **Name** | `webar-server` |
| **Root Directory** | `server` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node index.js` |
| **Free Tier** | 勾选 |

5. 添加环境变量（可选）：

| Key | Value |
|-----|-------|
| `CORS_ORIGIN` | `https://<你的用户名>.github.io` |
| `BASE_URL` | `https://webar-server.onrender.com` *(Render 会自动注入 `RENDER_EXTERNAL_URL`)* |

6. 点击 **Deploy Web Service**
7. 部署完成后，你会获得一个 URL，如 `https://webar-server.onrender.com`
8. 记下这个 URL——下一步要用！

> ⚠️ **重要**：Render 免费实例 15 分钟无活动会休眠（冷启动约 30-60 秒）。如果需要保持活跃，可以用 [UptimeRobot](https://uptimerobot.com) 定时 ping `/api/health` 接口。

### 二、前端部署到 GitHub Pages

#### 方式 A：GitHub Actions 自动部署（推荐）

1. 在你的 GitHub 仓库中，进入 **Settings** → **Pages**
2. **Source** 选择 **GitHub Actions**
3. 进入 **Settings** → **Secrets and variables** → **Actions** → **Variables**
4. 添加两个变量：

| Name | Value |
|------|-------|
| `VITE_API_BASE` | `https://webar-server.onrender.com` *(你的 Render 后端 URL)* |
| `VITE_SOCKET_URL` | `https://webar-server.onrender.com` *(同上)* |

5. 修改 [client/vite.config.js](client/vite.config.js) 中的 `base` 为你的仓库名（如 `'/my-webar/'`）
6. 推送代码到 `main` 分支：
   ```bash
   git add .
   git commit -m "Deploy to GitHub Pages"
   git push origin main
   ```
7. GitHub Actions 自动构建并部署。完成后在 **Settings** → **Pages** 查看 URL。

#### 方式 B：手动部署

```bash
cd client

# 设置后端 URL 环境变量
export VITE_API_BASE=https://webar-server.onrender.com
export VITE_SOCKET_URL=https://webar-server.onrender.com

# 构建
npm run build

# 推送到 gh-pages 分支
npx gh-pages -d dist
```

### 三、在手机上测试

1. 在手机浏览器打开 GitHub Pages URL：`https://<你的用户名>.github.io/mydemo/`
2. 拍照/选图 → 编译 → 进入 AR 空间
3. 将摄像头对准电脑屏幕上的原始图片
4. 另一个设备访问同一 URL → 进入同一 roomId → 实时协同！

> ✅ GitHub Pages 自动提供 **HTTPS**，满足摄像头权限要求。完美！

---

## 📖 使用流程

### 1. 创建 AR 房间

在手机浏览器打开应用首页：

1. 点击 **📷 拍照**（使用后置摄像头拍摄）或 **🖼️ 从相册选择**
2. 选择好图片后，等待 **编译进度条** 完成（约 2-5 秒）
3. 编译完成后点击 **🚀 进入 AR 空间**

> 💡 **图片选择建议**：选择纹理丰富、特征明显的图片（如海报、Logo、包装盒）。避免纯色或低对比度的图片。

### 2. AR 识别与协同

进入 AR 页面后：

1. **摄像头启动**，将手机对准你选择的原始图片
2. 识别成功后，画面中出现 **✨ 空状态提示**
3. 使用底部工具栏：
   - 点击 **💬 添加文字** 创建文字留言
   - 点击 **😊 添加表情** 添加 emoji
4. 点击自己的元素进入**编辑模式**（可修改颜色、字号、删除）
5. **长按拖拽**自己的元素可移动位置

### 3. 多人协同测试

1. 另一台设备打开相同的 GitHub Pages URL
2. 上传**同一张图片**，编译后进入 AR
3. 将手机摄像头对准电脑屏幕上的原始图片
4. 两个设备就能实时看到对方的留言了！

---

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/targets/image` | 上传原始图片，返回 `{ roomId, imageUrl }` |
| `POST` | `/api/targets/mind` | 上传 .mind 编译文件，返回 `{ roomId, mindUrl }` |
| `GET` | `/api/targets/:roomId` | 查询房间信息 |
| `GET` | `/api/health` | 健康检查 |

---

## 📡 Socket.IO 事件

### 客户端 → 服务端

| 事件 | 数据 | 说明 |
|------|------|------|
| `join-room` | `{ roomId, userInfo }` | 加入房间 |
| `leave-room` | — | 离开房间 |
| `element-add` | `element` | 添加元素 |
| `element-update` | `{ id, updates }` | 更新元素（仅创建者） |
| `element-delete` | `{ id }` | 删除元素（仅创建者） |

### 服务端 → 客户端

| 事件 | 数据 | 说明 |
|------|------|------|
| `room-state` | `{ elements[], users[] }` | 加入时全量同步 |
| `user-joined` | `user` | 新用户通知 |
| `user-left` | `{ userId }` | 用户离开 |
| `element-added` | `element` | 元素新增广播 |
| `element-updated` | `{ id, updates }` | 元素更新广播 |
| `element-deleted` | `{ id }` | 元素删除广播 |

---

## ⚠️ 注意事项

1. **HTTPS 要求**：WebXR 和摄像头 API 要求安全上下文。GitHub Pages 和 Render 都提供 HTTPS。
2. **图片选择**：建议选择特征丰富的图片（如有文字、Logo、纹理的图案），纯色图片识别效果差。
3. **Render 冷启动**：免费 Render 实例 15 分钟无人访问会休眠，首次请求需等待 30-60 秒唤醒。
4. **光照条件**：AR 识别对光照有一定要求，避免过暗或反光强烈的环境。
5. **浏览器兼容**：推荐使用 Chrome/Safari 最新版。
6. **编译耗时**：图片编译在浏览器主线程进行，约需 2-5 秒。

---

## 📄 License

MIT
