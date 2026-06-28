// =============================================
// server/services/reportService.js
// Business logic chính cho báo cáo sự cố
// =============================================

const Report = require("../models/Report");
const User   = require("../models/User");
const { analyzeImage }         = require("../ai/vision");
const { predictRisk }          = require("../ai/prediction");
const { calculateReportTrust } = require("./trustService");

// ─────────────────────────────────────────────────────────────────────────────
// CREATE REPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo báo cáo sự cố mới
 *
 * Flow:
 *  1. Lấy thông tin user (hoặc tạo anonymous)
 *  2. Gọi AI Vision để phân loại ảnh
 *  3. Tính Trust Score
 *  4. Lưu vào DB
 *  5. Cập nhật thống kê user
 *
 * @param {Object} data
 * @param {string} [data.userId]
 * @param {string} [data.image]
 * @param {{ lat: number, lng: number }} data.location
 * @param {string} [data.description]
 *
 * @returns {Promise<Object>} report document
 */
const createReport = async ({ userId, image, location, description }) => {
  // ── 1. Lấy thông tin user ────────────────────────────────────────────────────
  let user = null;
  if (userId) {
    user = await User.findById(userId);
    if (!user) throw new Error(`User '${userId}' không tồn tại`);
  } else {
    // User ẩn danh: dùng anonymous account chung
    user = await User.getAnonymousUser();
  }

  // ── 2. AI Vision phân loại ảnh ──────────────────────────────────────────────
  const aiResult = await analyzeImage({
    imageUrl: image || "",
    description: description || "",
    mock: process.env.AI_MOCK_MODE !== "false",
  });

  // ── 3. Tính Trust Score ──────────────────────────────────────────────────────
  const trustScore = calculateReportTrust({
    user,
    aiConfidence: aiResult.confidence,
    confirmations: 0,
  });

  // ── 4. Tạo document Report ───────────────────────────────────────────────────
  const report = await Report.create({
    image: image || "",
    location,
    description: description || "",
    userId: userId || user._id,

    aiResult: {
      type:       aiResult.type,
      severity:   aiResult.severity,
      confidence: aiResult.confidence,
      labels:     aiResult.labels,
    },

    type:       aiResult.type,
    trustScore,
    confirmations: 0,
    status: "pending",
  });

  // ── 5. Cập nhật thống kê user ────────────────────────────────────────────────
  await User.findByIdAndUpdate(user._id, {
    $inc: { totalReports: 1 },
  });

  // Populate userId để trả về đầy đủ
  await report.populate("userId", "name reputationScore");

  return report;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET REPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách báo cáo với filter + pagination
 *
 * @param {Object} filters
 * @param {string}  [filters.type]            - Loại sự cố
 * @param {number}  [filters.minTrustScore]   - Trust score tối thiểu
 * @param {string}  [filters.status]          - Trạng thái
 * @param {number}  [filters.page=1]
 * @param {number}  [filters.limit=20]
 * @param {string}  [filters.sortBy="createdAt"] - Field sắp xếp
 * @param {"asc"|"desc"} [filters.sortOrder="desc"]
 *
 * @returns {Promise<{ data: Object[], total: number, page: number, totalPages: number }>}
 */
const getReports = async ({
  type,
  minTrustScore,
  status,
  page = 1,
  limit = 20,
  sortBy = "createdAt",
  sortOrder = "desc",
} = {}) => {
  const query = {};

  if (type)           query.type = type;
  if (status)         query.status = status;
  if (minTrustScore !== undefined) {
    query.trustScore = { $gte: Number(minTrustScore) };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

  const [data, total] = await Promise.all([
    Report.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "name reputationScore"),
    Report.countDocuments(query),
  ]);

  return {
    data,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE REPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy một báo cáo theo ID
 * @param {string} reportId
 * @returns {Promise<Object>}
 */
const getReportById = async (reportId) => {
  const report = await Report.findById(reportId).populate(
    "userId",
    "name reputationScore canConfirmReports"
  );
  if (!report) throw new Error("Báo cáo không tồn tại");
  return report;
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cập nhật trạng thái xử lý (dành cho admin)
 *
 * @param {string} reportId
 * @param {"pending"|"processing"|"done"|"rejected"} status
 * @param {string} [adminNote]
 *
 * @returns {Promise<Object>} updated report
 */
const updateStatus = async (reportId, status, adminNote = "") => {
  const validStatuses = ["pending", "processing", "done", "rejected"];
  if (!validStatuses.includes(status)) {
    throw new Error(`Trạng thái không hợp lệ: '${status}'`);
  }

  const report = await Report.findByIdAndUpdate(
    reportId,
    { status, adminNote },
    { new: true, runValidators: true }
  ).populate("userId", "name reputationScore");

  if (!report) throw new Error("Báo cáo không tồn tại");
  return report;
};

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTION HEATMAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy heatmap dự đoán rủi ro
 * Dùng dữ liệu 7 ngày gần nhất để predict
 *
 * @returns {Promise<Array>} mảng các ô grid với riskScore
 */
const getRiskHeatmap = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentReports = await Report.find({
    createdAt: { $gte: sevenDaysAgo },
    status: { $ne: "rejected" }, // Bỏ qua report đã bị từ chối
  }).select("location type trustScore aiResult createdAt");

  return predictRisk(recentReports);
};

// ─────────────────────────────────────────────────────────────────────────────
// STATS (Dashboard)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thống kê tổng hợp cho admin dashboard
 * @returns {Promise<Object>}
 */
const getDashboardStats = async () => {
  const [
    totalReports,
    pendingCount,
    processingCount,
    doneCount,
    byType,
    avgTrustScore,
  ] = await Promise.all([
    Report.countDocuments(),
    Report.countDocuments({ status: "pending" }),
    Report.countDocuments({ status: "processing" }),
    Report.countDocuments({ status: "done" }),

    // Phân bổ theo loại
    Report.aggregate([
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // Trust score trung bình
    Report.aggregate([
      { $group: { _id: null, avg: { $avg: "$trustScore" } } },
    ]),
  ]);

  return {
    totalReports,
    byStatus: { pending: pendingCount, processing: processingCount, done: doneCount },
    byType: Object.fromEntries(byType.map((t) => [t._id, t.count])),
    avgTrustScore: parseFloat((avgTrustScore[0]?.avg || 0).toFixed(1)),
  };
};

module.exports = {
  createReport,
  getReports,
  getReportById,
  updateStatus,
  getRiskHeatmap,
  getDashboardStats,
};