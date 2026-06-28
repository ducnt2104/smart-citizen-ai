// =============================================
// server/ai/prediction.js
// Hệ thống dự đoán rủi ro sự cố đô thị
// =============================================

// ── Hằng số cấu hình ─────────────────────────────────────────────────────────
const GRID_RESOLUTION = 0.005;   // ~500m mỗi ô grid (lat/lng degree)
const HIGH_RISK_THRESHOLD = 0.6; // Trên 60% → nguy cơ cao
const MED_RISK_THRESHOLD  = 0.35; // Trên 35% → nguy cơ trung bình

// Trọng số mức độ nghiêm trọng theo loại sự cố
const SEVERITY_WEIGHT = {
  ngap: 1.5,    // Ngập nước nguy hiểm hơn
  o_ga: 1.2,    // Ổ gà gây tai nạn
  den_hong: 0.8,
  rac: 0.7,
  khac: 1.0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Làm tròn toạ độ về ô grid (snap to grid)
 * @param {number} coord
 * @returns {number}
 */
const snapToGrid = (coord) =>
  Math.round(coord / GRID_RESOLUTION) * GRID_RESOLUTION;

/**
 * Tạo key duy nhất cho mỗi ô grid
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
const gridKey = (lat, lng) =>
  `${snapToGrid(lat).toFixed(4)}_${snapToGrid(lng).toFixed(4)}`;

/**
 * Tính hệ số thời gian trong ngày
 * Ngập nước cao hơn vào giờ mưa chiều, ổ gà cao hơn giờ cao điểm
 * @param {string} type - Loại sự cố
 * @returns {number} 0.8 – 1.3
 */
const getTimeMultiplier = (type) => {
  const hour = new Date().getHours();
  if (type === "ngap") {
    // Ngập cao nhất lúc 14–18h (mưa chiều TPHCM)
    return hour >= 14 && hour <= 18 ? 1.3 : 0.9;
  }
  if (type === "o_ga") {
    // Ổ gà nguy hiểm hơn giờ cao điểm sáng + chiều
    return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1.2 : 1.0;
  }
  return 1.0;
};

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Dự đoán nguy cơ sự cố theo khu vực (heatmap risk)
 *
 * @param {Array<{
 *   location: { lat: number, lng: number },
 *   type: string,
 *   trustScore: number,
 *   aiResult: { severity: number },
 *   createdAt: Date
 * }>} reports - Danh sách báo cáo từ database
 *
 * @returns {Array<{
 *   lat: number,
 *   lng: number,
 *   riskScore: number,       // 0–1
 *   riskLevel: string,       // "high" | "medium" | "low"
 *   dominantType: string,
 *   reportCount: number,
 *   prediction: string       // Mô tả dự đoán
 * }>}
 */
const predictRisk = (reports = []) => {
  if (!reports.length) return [];

  // Thời điểm hiện tại để tính độ "tươi" của data
  const now = Date.now();
  const ONE_DAY_MS  = 24 * 60 * 60 * 1000;
  const ONE_WEEK_MS = 7  * ONE_DAY_MS;

  // ── Bước 1: Gom báo cáo vào các ô grid ─────────────────────────────────────
  const gridMap = new Map();

  for (const report of reports) {
    const { lat, lng } = report.location || {};
    if (!lat || !lng) continue;

    const key = gridKey(lat, lng);

    if (!gridMap.has(key)) {
      gridMap.set(key, {
        lat: snapToGrid(lat),
        lng: snapToGrid(lng),
        reports: [],
      });
    }

    gridMap.get(key).reports.push(report);
  }

  // ── Bước 2: Tính riskScore cho từng ô grid ──────────────────────────────────
  const results = [];

  for (const [, cell] of gridMap) {
    const { lat, lng, reports: cellReports } = cell;

    // Đếm loại sự cố xuất hiện nhiều nhất
    const typeCounts = {};
    let totalScore = 0;

    for (const report of cellReports) {
      const type = report.type || "khac";
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      // Trọng số: trustScore + severity + độ tươi dữ liệu
      const trustWeight   = (report.trustScore || 50) / 100;
      const severityWeight = SEVERITY_WEIGHT[type] || 1.0;
      const severity       = report.aiResult?.severity || 1;

      // Dữ liệu càng cũ thì trọng số càng thấp
      const ageMs      = now - new Date(report.createdAt).getTime();
      const freshness  = ageMs < ONE_DAY_MS
        ? 1.0
        : ageMs < ONE_WEEK_MS
        ? 0.7
        : 0.4;

      totalScore += trustWeight * severityWeight * (severity / 5) * freshness;
    }

    // Loại sự cố phổ biến nhất trong ô này
    const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Hệ số thời gian trong ngày
    const timeMultiplier = getTimeMultiplier(dominantType);

    // Chuẩn hoá score về 0–1 (log scale để tránh skew khi nhiều report)
    const normalizedScore = Math.min(
      1,
      (Math.log(1 + totalScore) / Math.log(1 + cellReports.length + 2)) * timeMultiplier
    );

    // ── Xếp mức rủi ro ──────────────────────────────────────────────────────
    let riskLevel;
    let prediction;
    const pct = Math.round(normalizedScore * 100);

    if (normalizedScore >= HIGH_RISK_THRESHOLD) {
      riskLevel = "high";
      prediction = buildPredictionText(dominantType, pct, "high");
    } else if (normalizedScore >= MED_RISK_THRESHOLD) {
      riskLevel = "medium";
      prediction = buildPredictionText(dominantType, pct, "medium");
    } else {
      riskLevel = "low";
      prediction = buildPredictionText(dominantType, pct, "low");
    }

    results.push({
      lat,
      lng,
      riskScore: parseFloat(normalizedScore.toFixed(3)),
      riskLevel,
      dominantType,
      reportCount: cellReports.length,
      prediction,
    });
  }

  // Sắp xếp theo riskScore giảm dần
  return results.sort((a, b) => b.riskScore - a.riskScore);
};

/**
 * Tạo văn bản mô tả dự đoán
 * @param {string} type
 * @param {number} pct
 * @param {"high"|"medium"|"low"} level
 * @returns {string}
 */
const buildPredictionText = (type, pct, level) => {
  const typeNames = {
    rac: "xuất hiện rác thải",
    o_ga: "có ổ gà / hư hỏng mặt đường",
    ngap: "ngập nước",
    den_hong: "đèn đường hỏng",
    khac: "có sự cố đô thị",
  };

  const name = typeNames[type] || "có sự cố";

  if (level === "high")   return `⚠️  Khu vực này có ${pct}% khả năng ${name} trong 24 giờ tới. Cần xử lý ngay.`;
  if (level === "medium") return `🔶 Khu vực này có ${pct}% khả năng ${name}. Theo dõi thêm.`;
  return                         `🟢 Khu vực này có nguy cơ thấp (${pct}%) về ${name}.`;
};

module.exports = { predictRisk };