// =============================================
// server/services/trustService.js
// Business logic: Trust Score & Reputation
// =============================================

const User = require("../models/User");
const Report = require("../models/Report");
const { calculateTrustScore, reputationDelta } = require("../utils/scoring");

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tính Trust Score cho một báo cáo mới
 *
 * @param {Object} params
 * @param {Object|null} params.user      - Document User (hoặc null nếu ẩn danh)
 * @param {number} params.aiConfidence   - Kết quả từ AI Vision (0–1)
 * @param {number} [params.confirmations=0] - Số xác nhận (mặc định = 0 khi mới tạo)
 *
 * @returns {number} Trust Score (0–100)
 */
const calculateReportTrust = ({ user, aiConfidence, confirmations = 0 }) => {
  const userReputation = user?.reputationScore ?? 30; // 30 = mức ẩn danh

  return calculateTrustScore({
    userReputation,
    confirmations,
    aiConfidence,
  });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cập nhật reputation của user sau khi report được duyệt / từ chối
 *
 * @param {string} userId       - ObjectId của user
 * @param {"valid"|"invalid"} outcome
 * @returns {Promise<Object>}   - Updated user document
 */
const updateUserReputation = async (userId, outcome) => {
  if (!userId) return null;

  const delta = reputationDelta(outcome);

  const updateFields = {
    $inc: {
      reputationScore: delta,   // Cộng / trừ điểm uy tín
    },
  };

  // Cập nhật thống kê báo cáo
  if (outcome === "valid") {
    updateFields.$inc.validReports = 1;
  } else {
    updateFields.$inc.invalidReports = 1;
  }

  const user = await User.findByIdAndUpdate(
    userId,
    [
      {
        $set: {
          // Dùng aggregation pipeline để giới hạn 0–100
          reputationScore: {
            $max: [0, { $min: [100, { $add: ["$reputationScore", delta] }] }],
          },
          validReports: outcome === "valid"
            ? { $add: ["$validReports", 1] }
            : "$validReports",
          invalidReports: outcome === "invalid"
            ? { $add: ["$invalidReports", 1] }
            : "$invalidReports",
        },
      },
    ],
    { new: true }
  );

  if (!user) return null;

  // Kiểm tra mở khoá quyền xác nhận
  user.checkAndUnlockConfirmRight();
  await user.save();

  return user;
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Xử lý khi một user xác nhận một báo cáo (crowdsourcing)
 *
 * - Kiểm tra user có quyền xác nhận không
 * - Kiểm tra chưa xác nhận trước đó
 * - Tăng confirmations
 * - Tính lại Trust Score
 *
 * @param {string} reportId
 * @param {string} confirmerId  - userId người xác nhận
 * @returns {Promise<{ success: boolean, message: string, report?: Object }>}
 */
const confirmReport = async (reportId, confirmerId) => {
  // ── Lấy report & user ───────────────────────────────────────────────────────
  const [report, confirmer] = await Promise.all([
    Report.findById(reportId),
    User.findById(confirmerId),
  ]);

  if (!report) return { success: false, message: "Báo cáo không tồn tại" };
  if (!confirmer) return { success: false, message: "Người dùng không tồn tại" };
  if (!confirmer.canConfirmReports) {
    return {
      success: false,
      message: `Cần điểm uy tín >= 70 để xác nhận. Hiện tại: ${confirmer.reputationScore}`,
    };
  }

  // ── Kiểm tra đã xác nhận chưa ───────────────────────────────────────────────
  const alreadyConfirmed = report.confirmedBy.some(
    (id) => id.toString() === confirmerId
  );
  if (alreadyConfirmed) {
    return { success: false, message: "Bạn đã xác nhận báo cáo này rồi" };
  }

  // ── Không được xác nhận báo cáo của chính mình ──────────────────────────────
  if (report.userId?.toString() === confirmerId) {
    return { success: false, message: "Không thể tự xác nhận báo cáo của mình" };
  }

  // ── Cập nhật confirmations & tính lại trustScore ────────────────────────────
  report.confirmations += 1;
  report.confirmedBy.push(confirmerId);

  // Lấy thông tin user gốc để tính lại trust score
  const originalUser = report.userId
    ? await User.findById(report.userId)
    : null;

  report.trustScore = calculateReportTrust({
    user: originalUser,
    aiConfidence: report.aiResult?.confidence ?? 0,
    confirmations: report.confirmations,
  });

  await report.save();

  // Cộng thưởng nhỏ cho người xác nhận (khuyến khích cộng đồng)
  await User.findByIdAndUpdate(confirmerId, {
    $inc: { reputationScore: 1 },
  });

  return {
    success: true,
    message: `Xác nhận thành công. Trust Score mới: ${report.trustScore}`,
    report,
  };
};

module.exports = {
  calculateReportTrust,
  updateUserReputation,
  confirmReport,
};