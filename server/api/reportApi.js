// =============================================
// server/api/reportApi.js
// Express Router – tất cả endpoints báo cáo
// =============================================

const express = require("express");
const router  = express.Router();

const reportService = require("../services/reportService");
const trustService  = require("../services/trustService");

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Wrapper async để bắt lỗi không cần try/catch lặp lại
// ─────────────────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reports
// Tạo báo cáo sự cố mới
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { image, location, description, userId } = req.body;

    // ── Validate bắt buộc ─────────────────────────────────────────────────────
    if (!location || location.lat === undefined || location.lng === undefined) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin vị trí (location.lat & location.lng)",
      });
    }

    // ── Tạo report ────────────────────────────────────────────────────────────
    const report = await reportService.createReport({
      userId,
      image,
      location,
      description,
    });

    // ── Emit Socket.io event cho tất cả clients ───────────────────────────────
    // req.app.get("io") được gắn trong server.js
    const io = req.app.get("io");
    if (io) {
      io.emit("new-report", {
        _id:        report._id,
        type:       report.type,
        typeLabel:  report.typeLabel,
        trustScore: report.trustScore,
        location:   report.location,
        status:     report.status,
        createdAt:  report.createdAt,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Báo cáo đã được gửi thành công",
      data: report,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports
// Lấy danh sách báo cáo (có filter & pagination)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const {
      type,
      minTrustScore,
      status,
      page  = 1,
      limit = 20,
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const result = await reportService.getReports({
      type,
      minTrustScore: minTrustScore ? Number(minTrustScore) : undefined,
      status,
      page:  Number(page),
      limit: Number(limit),
      sortBy,
      sortOrder,
    });

    return res.json({
      success: true,
      ...result,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/stats
// Thống kê dashboard (phải đặt TRƯỚC /:id để không bị bắt nhầm)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const stats = await reportService.getDashboardStats();
    return res.json({ success: true, data: stats });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/heatmap
// Heatmap dự đoán rủi ro
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/heatmap",
  asyncHandler(async (req, res) => {
    const heatmap = await reportService.getRiskHeatmap();
    return res.json({
      success: true,
      count: heatmap.length,
      data: heatmap,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/:id
// Lấy chi tiết một báo cáo
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const report = await reportService.getReportById(req.params.id);
    return res.json({ success: true, data: report });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/reports/:id/status
// Admin cập nhật trạng thái xử lý
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status, adminNote } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Thiếu trường 'status'",
      });
    }

    const report = await reportService.updateStatus(req.params.id, status, adminNote);

    // Nếu rejected → cập nhật reputation user gửi báo cáo
    if (status === "rejected" && report.userId) {
      await trustService.updateUserReputation(report.userId, "invalid");
    }
    if (status === "done" && report.userId) {
      await trustService.updateUserReputation(report.userId, "valid");
    }

    // Emit socket event để admin dashboard cập nhật real-time
    const io = req.app.get("io");
    if (io) {
      io.emit("report-status-updated", {
        _id:    report._id,
        status: report.status,
      });
    }

    return res.json({
      success: true,
      message: `Cập nhật trạng thái thành '${status}' thành công`,
      data: report,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reports/:id/confirm
// User xác nhận báo cáo (crowdsourcing)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu 'userId' trong body",
      });
    }

    const result = await trustService.confirmReport(req.params.id, userId);

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    // Emit cập nhật trust score real-time
    const io = req.app.get("io");
    if (io) {
      io.emit("report-confirmed", {
        _id:          result.report._id,
        trustScore:   result.report.trustScore,
        confirmations: result.report.confirmations,
      });
    }

    return res.json({
      success: true,
      message: result.message,
      data: result.report,
    });
  })
);

module.exports = router;