// =============================================
// server/utils/scoring.js
// Công thức tính Trust Score
// =============================================

/**
 * TRUST SCORE FORMULA:
 *
 *   Trust Score (0–100) =
 *     (userReputation * 0.4)  → uy tín người dùng
 *   + (confirmScore   * 0.3)  → xác nhận cộng đồng
 *   + (aiConfidence   * 0.3)  → độ chắc chắn của AI
 *
 * Mỗi thành phần được chuẩn hoá về thang 0–100 trước khi nhân hệ số.
 */

// ── Hằng số trọng số ─────────────────────────────────────────────────────────
const WEIGHTS = {
  USER_REPUTATION: 0.4,
  COMMUNITY_CONFIRM: 0.3,
  AI_CONFIDENCE: 0.3,
};

// Số xác nhận tối đa để tính điểm tối đa (không cần vô hạn xác nhận)
const MAX_CONFIRMATIONS = 10;

/**
 * Tính điểm thành phần từ xác nhận cộng đồng
 * Dùng hàm log để giảm tốc độ tăng (10 xác nhận ≈ 100đ, không cần đến 1000)
 *
 * @param {number} confirmations - Số lượt xác nhận
 * @returns {number} 0–100
 */
const confirmationScore = (confirmations) => {
  if (confirmations <= 0) return 0;
  // Mỗi confirmation tăng điểm, nhưng càng nhiều thì tăng chậm dần
  const score = (confirmations / MAX_CONFIRMATIONS) * 100;
  return Math.min(score, 100); // Giới hạn tối đa 100
};

/**
 * Tính Trust Score tổng hợp
 *
 * @param {Object} params
 * @param {number} params.userReputation    - Điểm uy tín user (0–100)
 * @param {number} params.confirmations     - Số lượt xác nhận cộng đồng
 * @param {number} params.aiConfidence      - Độ tin cậy AI (0–1), sẽ nhân 100
 * @returns {number} Trust Score (0–100), làm tròn 1 chữ số thập phân
 */
const calculateTrustScore = ({ userReputation = 50, confirmations = 0, aiConfidence = 0 }) => {
  // Chuẩn hoá từng thành phần về 0–100
  const reputationComponent = Math.max(0, Math.min(100, userReputation));
  const confirmComponent = confirmationScore(confirmations);
  const aiComponent = Math.max(0, Math.min(1, aiConfidence)) * 100;

  // Áp dụng trọng số
  const score =
    reputationComponent * WEIGHTS.USER_REPUTATION +
    confirmComponent    * WEIGHTS.COMMUNITY_CONFIRM +
    aiComponent         * WEIGHTS.AI_CONFIDENCE;

  return Math.round(score * 10) / 10; // Làm tròn 1 chữ số thập phân
};

/**
 * Xếp loại mức độ tin cậy theo Trust Score
 *
 * @param {number} score
 * @returns {{ label: string, color: string }}
 */
const getTrustLabel = (score) => {
  if (score >= 80) return { label: "Rất tin cậy",  color: "green"  };
  if (score >= 60) return { label: "Tin cậy",       color: "blue"   };
  if (score >= 40) return { label: "Trung bình",    color: "yellow" };
  if (score >= 20) return { label: "Ít tin cậy",   color: "orange" };
  return               { label: "Không tin cậy",  color: "red"    };
};

/**
 * Tính điểm thay đổi uy tín sau khi một report được xác nhận / từ chối
 *
 * @param {"valid"|"invalid"} outcome
 * @returns {number} điểm cộng/trừ
 */
const reputationDelta = (outcome) => {
  const deltas = {
    valid: +5,    // Báo cáo hợp lệ → +5 điểm uy tín
    invalid: -10, // Báo cáo sai / spam → -10 điểm uy tín
  };
  return deltas[outcome] ?? 0;
};

module.exports = {
  calculateTrustScore,
  getTrustLabel,
  reputationDelta,
  WEIGHTS,
};