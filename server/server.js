// =============================================
// server/server.js
// Entry point – Express + Socket.io + MongoDB
// =============================================

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const path       = require("path");

const connectDB   = require("../database/db-config");
const reportApi   = require("./api/reportApi");

// ─────────────────────────────────────────────────────────────────────────────
// KHỞI TẠO APP
// ─────────────────────────────────────────────────────────────────────────────

const app        = express();
const httpServer = http.createServer(app);

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST", "PATCH"],
  },
});

// Gắn io vào app để dùng trong các route (req.app.get("io"))
app.set("io", io);

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.CLIENT_URL || "*",
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));       // Cho phép body lớn (base64 ảnh)
app.use(express.urlencoded({ extended: true }));

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, "../public")));

// ── Request logger (dev only) ─────────────────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  app.use((req, _res, next) => {
    console.log(`📥 ${req.method} ${req.path}`);
    next();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.use("/api/reports", reportApi);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO EVENTS
// ─────────────────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Client tham gia room admin
  socket.on("join-admin", () => {
    socket.join("admin-room");
    console.log(`👮 Admin joined: ${socket.id}`);
  });

  // Client yêu cầu danh sách report mới nhất qua socket
  socket.on("request-reports", async () => {
    try {
      const reportService = require("./services/reportService");
      const { data } = await reportService.getReports({ limit: 10 });
      socket.emit("reports-list", data);
    } catch (err) {
      socket.emit("error", { message: "Không thể tải danh sách báo cáo" });
    }
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLING MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Endpoint không tồn tại" });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);

  // Lỗi từ Mongoose validation
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, message: messages.join(", ") });
  }

  // Lỗi ObjectId không hợp lệ
  if (err.name === "CastError") {
    return res.status(400).json({ success: false, message: "ID không hợp lệ" });
  }

  // Duplicate key (vd: email đã tồn tại)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `Giá trị '${field}' đã tồn tại`,
    });
  }

  return res.status(500).json({
    success: false,
    message: err.message || "Lỗi server nội bộ",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KHỞI ĐỘNG SERVER
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log("\n========================================");
      console.log(`🚀 SmartCitizen AI Server running`);
      console.log(`   ➜ Local:   http://localhost:${PORT}`);
      console.log(`   ➜ Health:  http://localhost:${PORT}/api/health`);
      console.log(`   ➜ Mode:    ${process.env.NODE_ENV || "development"}`);
      console.log(`   ➜ AI Mock: ${process.env.AI_MOCK_MODE || "true"}`);
      console.log("========================================\n");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Xử lý tắt server gracefully
process.on("SIGTERM", () => {
  console.log("📴 SIGTERM received. Shutting down gracefully...");
  httpServer.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("\n📴 SIGINT received. Shutting down...");
  httpServer.close(() => process.exit(0));
});

startServer();