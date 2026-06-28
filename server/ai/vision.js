// =============================================
// server/ai/vision.js
// Mock AI – Phân loại ảnh sự cố đô thị
// =============================================
//
// Trong production: thay thế analyzeImage() bằng
// Google Vision API / TensorFlow.js / custom model.
// Interface (input/output) không đổi → dễ swap.
// =============================================

// ── Bảng phân loại theo keyword ──────────────────────────────────────────────
const KEYWORD_MAP = [
  {
    type: "rac",
    keywords: ["rác", "rac", "trash", "garbage", "waste", "túi rác", "đống rác"],
    baseSeverity: 2,
  },
  {
    type: "o_ga",
    keywords: ["ổ gà", "o ga", "pothole", "hố", "lún", "nứt đường", "vỡ đường"],
    baseSeverity: 3,
  },
  {
    type: "ngap",
    keywords: ["ngập", "ngap", "flood", "nước", "nuoc", "tràn", "lũ", "mưa"],
    baseSeverity: 4,
  },
  {
    type: "den_hong",
    keywords: ["đèn", "den", "light", "bóng", "bong", "điện", "dien", "tối"],
    baseSeverity: 2,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá chuỗi: lowercase + bỏ dấu tiếng Việt
 * @param {string} str
 * @returns {string}
 */
const normalize = (str = "") =>
  str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Phân loại dựa trên keyword trong description / image filename
 * @param {string} text
 * @returns {{ type: string, baseSeverity: number } | null}
 */
const classifyByKeyword = (text) => {
  const normalized = normalize(text);
  for (const category of KEYWORD_MAP) {
    const hit = category.keywords.some((kw) => normalized.includes(normalize(kw)));
    if (hit) return { type: category.type, baseSeverity: category.baseSeverity };
  }
  return null;
};

/**
 * Tạo độ nghiêm trọng có noise ± 1 (giả lập model thật)
 * @param {number} base
 * @returns {number} 1–5
 */
const addSeverityNoise = (base) => {
  const noise = Math.round(Math.random() * 2) - 1; // -1, 0, hoặc +1
  return Math.max(1, Math.min(5, base + noise));
};

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Phân tích ảnh sự cố (Mock AI)
 *
 * @param {Object} input
 * @param {string} [input.imageUrl]     - URL ảnh (dùng filename để gợi ý loại)
 * @param {string} [input.description]  - Mô tả text của người dùng
 * @param {boolean} [input.mock=true]   - Dùng mock hay không
 *
 * @returns {Promise<{
 *   type: string,
 *   severity: number,
 *   confidence: number,
 *   labels: string[],
 *   processingTimeMs: number
 * }>}
 */
const analyzeImage = async ({ imageUrl = "", description = "", mock = true }) => {
  const startTime = Date.now();

  // Giả lập delay xử lý AI (200–600ms)
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 400));

  // ── MOCK MODE ──────────────────────────────────────────────────────────────
  if (mock || process.env.AI_MOCK_MODE === "true") {
    // Thử classify bằng keyword từ description + imageUrl
    const textToScan = `${description} ${imageUrl}`;
    const classified = classifyByKeyword(textToScan);

    if (classified) {
      const severity = addSeverityNoise(classified.baseSeverity);
      const confidence = 0.65 + Math.random() * 0.3; // 0.65 – 0.95

      return {
        type: classified.type,
        severity,
        confidence: parseFloat(confidence.toFixed(2)),
        labels: [classified.type, `severity_${severity}`],
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Không match keyword → random phân loại với confidence thấp
    const types = ["rac", "o_ga", "ngap", "den_hong", "khac"];
    const randomType = types[Math.floor(Math.random() * types.length)];
    const randomSeverity = Math.ceil(Math.random() * 3); // 1–3 (thấp hơn vì không chắc)
    const confidence = 0.3 + Math.random() * 0.3; // 0.3 – 0.6

    return {
      type: randomType,
      severity: randomSeverity,
      confidence: parseFloat(confidence.toFixed(2)),
      labels: [randomType, "low_confidence"],
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ── PRODUCTION MODE (placeholder) ─────────────────────────────────────────
  // TODO: Tích hợp Google Vision API hoặc TensorFlow.js model
  // Ví dụ: const result = await googleVision.labelDetection(imageUrl);
  throw new Error("Production AI mode chưa được implement. Dùng AI_MOCK_MODE=true");
};

module.exports = { analyzeImage };