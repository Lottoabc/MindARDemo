/**
 * WebAR 多人协同应用 - 后端服务入口
 * ============================================================================
 * 功能：
 *   1. 提供图片上传接口（POST /api/targets/image）
 *   2. 提供 .mind 编译文件上传接口（POST /api/targets/mind）
 *   3. 通过 Socket.IO 管理多人协同房间（加入/离开/元素增删改广播）
 *   4. 静态文件服务（提供上传的图片和 .mind 文件）
 *
 * 【安全提醒】生产环境必须使用 HTTPS，否则 WebXR 将无法运行。
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

// ---------------------------------------------------------------------------
// Express 应用初始化
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

// 服务端基础 URL（用于生成绝对路径的文件 URL）
// 开发环境：http://localhost:3000
// 生产环境：通过环境变量设置，如 RENDER_EXTERNAL_URL 或 BASE_URL
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;

// ---------------------------------------------------------------------------
// 中间件配置
// ---------------------------------------------------------------------------
/**
 * CORS 配置
 * 开发阶段允许所有来源；生产环境建议限制为 GitHub Pages 域名
 * 示例：origin: 'https://your-username.github.io'
 */
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

// ---------------------------------------------------------------------------
// 静态文件服务 — 提供上传目录的公开访问
// 客户端通过 /uploads/xxx 访问上传的图片和 .mind 文件
// ---------------------------------------------------------------------------
const uploadsDir = path.join(__dirname, 'uploads');
// 确保 uploads 目录存在
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// ---------------------------------------------------------------------------
// Multer 配置 — 处理文件上传
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 根据文件类型分流到不同子目录
    const ext = path.extname(file.originalname).toLowerCase();
    let subdir = 'images';
    if (ext === '.mind') {
      subdir = 'mind';
    }
    const dest = path.join(uploadsDir, subdir);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // 使用 UUID 避免文件名冲突
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,  // 最大 10MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // 只允许图片和 .mind 文件
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mind'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}。仅支持 ${allowed.join(', ')}`));
    }
  },
});

// ---------------------------------------------------------------------------
// REST API 路由
// ---------------------------------------------------------------------------

/**
 * POST /api/targets/image
 * 上传原始图片（用于在 AR 中展示触发目标，也可作为缩略图分享）
 * 返回: { roomId, imageUrl }
 */
app.post('/api/targets/image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择一张图片上传' });
    }

    const roomId = uuidv4().slice(0, 8); // 8 位短 ID 作为房间号
    // 返回绝对 URL，兼容 GitHub Pages 等跨域部署场景
    const imageUrl = `${BASE_URL}/uploads/images/${req.file.filename}`;

    console.log(`[API] 图片上传成功: ${imageUrl} (roomId: ${roomId})`);

    res.json({
      success: true,
      roomId,
      imageUrl,
    });
  } catch (err) {
    console.error('[API] 图片上传失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * POST /api/targets/mind
 * 上传编译好的 .mind 特征文件（客户端 MindAR Compiler 编译完成后上传）
 * 请求体需要包含 roomId (用于关联房间) 和 .mind 文件
 * 返回: { roomId, mindUrl }
 */
app.post('/api/targets/mind', upload.fields([
  { name: 'mind', maxCount: 1 },     // .mind 编译文件
  { name: 'image', maxCount: 1 },    // 可选：缩略图（方便在首页预览）
]), (req, res) => {
  try {
    const { roomId } = req.body;

    if (!roomId) {
      return res.status(400).json({ error: '缺少 roomId 参数' });
    }

    if (!req.files || !req.files.mind || req.files.mind.length === 0) {
      return res.status(400).json({ error: '请上传 .mind 编译文件' });
    }

    const mindFile = req.files.mind[0];
    const mindUrl = `${BASE_URL}/uploads/mind/${mindFile.filename}`;

    // 可选：缩略图 URL
    let imageUrl = null;
    if (req.files.image && req.files.image.length > 0) {
      imageUrl = `${BASE_URL}/uploads/images/${req.files.image[0].filename}`;
    }

    console.log(`[API] .mind 文件上传成功: ${mindUrl} (roomId: ${roomId})`);

    res.json({
      success: true,
      roomId,
      mindUrl,
      imageUrl,
    });
  } catch (err) {
    console.error('[API] .mind 文件上传失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * GET /api/targets/:roomId
 * 查询房间是否存在及其关联的目标文件信息
 */
app.get('/api/targets/:roomId', (req, res) => {
  const { roomId } = req.params;

  // 检查内存中是否有此房间的活跃 Socket 连接（粗略验证房间有效性）
  // 更严谨的做法是维护一个 roomMeta Map
  const hasRoom = rooms.has(roomId) || true; // 简化：总是返回存在（因为有文件即可）

  res.json({
    exists: hasRoom,
    roomId,
  });
});

// ---------------------------------------------------------------------------
// Socket.IO 配置与房间管理
// ---------------------------------------------------------------------------

/**
 * 房间数据结构：
 * rooms: Map<roomId, {
 *   elements: Map<elementId, element>,
 *   users: Map<socketId, userInfo>,
 *   createdAt: timestamp
 * }>
 */
const rooms = new Map();

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 5e6,  // 5MB 上限（涵盖大型 .mind 文件传输）
  pingInterval: 10000,      // 每 10 秒 ping 一次，检测断线
  pingTimeout: 5000,         // 5 秒无 pong 视为断线
});

io.on('connection', (socket) => {
  console.log(`[Socket] 新连接: ${socket.id}`);

  // -----------------------------------------------------------------------
  // 加入房间
  // 当用户进入 AR 场景或上传完成跳转时触发
  // payload: { roomId, userInfo: { id, name, color } }
  // -----------------------------------------------------------------------
  socket.on('join-room', ({ roomId, userInfo }) => {
    if (!roomId || !userInfo) return;

    // 确保房间存在
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        elements: new Map(),
        users: new Map(),
        createdAt: Date.now(),
      });
      console.log(`[Room] 创建房间: ${roomId}`);
    }

    const room = rooms.get(roomId);

    // 将当前 socket 加入 Socket.IO 房间
    socket.join(roomId);

    // 记录当前 socket 所在房间（用于 disconnect 时清理）
    socket.data.roomId = roomId;
    socket.data.persistentUserId = userInfo.id;

    // 存储用户信息
    const user = {
      id: userInfo.id,             // localStorage 持久化的 userId
      socketId: socket.id,         // 当前连接的 socketId
      name: userInfo.name,
      color: userInfo.color,
      joinedAt: Date.now(),
    };
    room.users.set(socket.id, user);

    console.log(`[Room] ${user.name} (${socket.id}) 加入房间 ${roomId}`);

    // 向新加入的用户发送当前房间的完整状态（全量同步）
    socket.emit('room-state', {
      elements: Array.from(room.elements.values()),
      users: Array.from(room.users.values()).map(u => ({
        id: u.id,
        name: u.name,
        color: u.color,
        online: true,
      })),
    });

    // 向房间内其他人广播新用户加入
    socket.to(roomId).emit('user-joined', {
      id: user.id,
      name: user.name,
      color: user.color,
      online: true,
    });
  });

  // -----------------------------------------------------------------------
  // 添加元素
  // payload: element { id, userId, userName, userColor, type, content, style, position }
  // -----------------------------------------------------------------------
  socket.on('element-add', (element) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    // 验证必要字段
    if (!element || !element.id || !element.userId) return;

    const room = rooms.get(roomId);

    // 服务端加盖时间戳（以服务端时间为准）
    element.createdAt = Date.now();

    // 存入房间状态
    room.elements.set(element.id, element);

    console.log(`[Room ${roomId}] 元素添加: ${element.id} by ${element.userName}`);

    // 广播给房间内所有人（包括发送者，作为服务端确认）
    io.to(roomId).emit('element-added', element);
  });

  // -----------------------------------------------------------------------
  // 更新元素
  // payload: { id: elementId, updates: { content, position, style, ... } }
  // 只有元素的创建者才能更新
  // -----------------------------------------------------------------------
  socket.on('element-update', ({ id, updates }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const existing = room.elements.get(id);

    // 元素不存在
    if (!existing) {
      socket.emit('error', { message: '元素不存在' });
      return;
    }

    // 权限校验：只有创建者可以更新自己的元素
    const persistentUserId = socket.data.persistentUserId;
    if (existing.userId !== persistentUserId) {
      socket.emit('error', { message: '无权修改他人的元素' });
      return;
    }

    // 合并更新（浅合并：content, position, style）
    Object.assign(existing, updates);
    existing.updatedAt = Date.now();

    console.log(`[Room ${roomId}] 元素更新: ${id}`);

    // 广播给房间内其他人（不包括发送者自己）
    socket.to(roomId).emit('element-updated', { id, updates });
  });

  // -----------------------------------------------------------------------
  // 删除元素
  // payload: { id: elementId }
  // 只有元素的创建者才能删除
  // -----------------------------------------------------------------------
  socket.on('element-delete', ({ id }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const existing = room.elements.get(id);

    if (!existing) {
      socket.emit('error', { message: '元素不存在' });
      return;
    }

    // 权限校验：只有创建者可以删除
    const persistentUserId = socket.data.persistentUserId;
    if (existing.userId !== persistentUserId) {
      socket.emit('error', { message: '无权删除他人的元素' });
      return;
    }

    room.elements.delete(id);

    console.log(`[Room ${roomId}] 元素删除: ${id}`);

    // 广播给房间内所有人（包括发送者）
    io.to(roomId).emit('element-deleted', { id });
  });

  // -----------------------------------------------------------------------
  // 离开房间（可选，客户端导航离开时主动触发）
  // -----------------------------------------------------------------------
  socket.on('leave-room', () => {
    handleUserLeave(socket);
  });

  // -----------------------------------------------------------------------
  // 断线处理
  // 浏览器关闭、网络断开、WiFi 切换等都触发 disconnect
  // -----------------------------------------------------------------------
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] 断开: ${socket.id} (原因: ${reason})`);
    handleUserLeave(socket);
  });
});

/**
 * 处理用户离开房间的逻辑
 * 从房间状态中移除用户，并广播 user-left 事件
 */
function handleUserLeave(socket) {
  const roomId = socket.data.roomId;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  const user = room.users.get(socket.id);
  room.users.delete(socket.id);

  if (user) {
    console.log(`[Room ${roomId}] 用户离开: ${user.name} (${socket.id})`);

    // 广播用户离开（使用 persistentUserId，而非 socketId）
    socket.to(roomId).emit('user-left', { userId: user.id });
  }

  // 清理空房间：当所有用户都离开后，5 分钟后自动删除房间
  if (room.users.size === 0) {
    console.log(`[Room ${roomId}] 房间已空，5 分钟后自动清理`);
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.users.size === 0) {
        rooms.delete(roomId);
        console.log(`[Room ${roomId}] 房间已清理`);
      }
    }, 5 * 60 * 1000); // 5 分钟
  }

  // 清理 socket 数据
  socket.data.roomId = null;
}

// ---------------------------------------------------------------------------
// 健康检查接口
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: rooms.size,
    timestamp: Date.now(),
  });
});

// ---------------------------------------------------------------------------
// 启动服务器
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('  WebAR 多人协同 — 后端服务已启动');
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  环境: ${process.env.NODE_ENV || 'development'}`);
  console.log('  【提醒】手机测试时，请将 localhost 替换为');
  console.log('         你电脑的局域网 IP 地址');
  console.log('═══════════════════════════════════════════');
});
