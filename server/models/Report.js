// =============================================
// server/models/Report.js
// Schema báo cáo sự cố đô thị
// =============================================

const mongoose = require("mongoose");

// ── Sub-schema: vị trí địa lý ───────────────────────────────────────────────
const LocationSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      required: [true, "Latitude là bắt buộc"],
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: [true, "Longitude là bắt buộc"],
      min: -180,
      max: 180,
    },
    address: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

// ── Sub-schema: kết quả AI ───────────────────────────────────────────────────
const AIResultSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["rac", "o_ga", "ngap", "den_hong", "khac"],
      default: "khac",
    },
    severity: {
      type: Number,
      min: 1,
      max: 5,
      default: 1,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    labels: [String], // Các nhãn phụ từ AI
  },
  { _id: false }
);

// ── Main Schema ──────────────────────────────────────────────────────────────
const ReportSchema = new mongoose.Schema(
  {
    // Ảnh hiện trường (URL hoặc base64)
    image: {
      type: String,
      default: "",
    },

    location: {
      type: LocationSchema,
      required: [true, "Vị trí báo cáo là bắt buộc"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Mô tả không vượt quá 500 ký tự"],
      default: "",
    },

    // Ai gửi báo cáo
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Kết quả phân tích AI
    aiResult: {
      type: AIResultSchema,
      default: () => ({}),
    },

    // ── Trust Score (0–100) ──────────────────────────────────────────────────
    trustScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Số lượt xác nhận từ cộng đồng
    confirmations: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Danh sách userId đã xác nhận (tránh xác nhận 2 lần)
    confirmedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Trạng thái xử lý
    status: {
      type: String,
      enum: ["pending", "processing", "done", "rejected"],
      default: "pending",
    },

    // Ghi chú xử lý từ admin
    adminNote: {
      type: String,
      default: "",
    },

    // Loại sự cố (được copy từ aiResult để dễ filter)
    type: {
      type: String,
      enum: ["rac", "o_ga", "ngap", "den_hong", "khac"],
      default: "khac",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Index: tìm kiếm theo vị trí + status thường xuyên ───────────────────────
ReportSchema.index({ "location.lat": 1, "location.lng": 1 });
ReportSchema.index({ status: 1 });
ReportSchema.index({ trustScore: -1 });
ReportSchema.index({ createdAt: -1 });

// ── Virtual: label hiển thị loại sự cố ──────────────────────────────────────
ReportSchema.virtual("typeLabel").get(function () {
  const labels = {
    rac: "🗑️ Rác thải",
    o_ga: "🕳️ Ổ gà",
    ngap: "🌊 Ngập nước",
    den_hong: "💡 Đèn hỏng",
    khac: "📍 Khác",
  };
  return labels[this.type] || "Không xác định";
});

// ── Virtual: label mức độ nghiêm trọng ──────────────────────────────────────
ReportSchema.virtual("severityLabel").get(function () {
  const s = this.aiResult?.severity || 1;
  if (s <= 1) return "Rất nhẹ";
  if (s <= 2) return "Nhẹ";
  if (s <= 3) return "Trung bình";
  if (s <= 4) return "Nghiêm trọng";
  return "Rất nghiêm trọng";
});

module.exports = mongoose.model("Report", ReportSchema);