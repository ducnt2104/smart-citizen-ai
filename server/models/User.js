// =============================================
// server/models/User.js
// Schema người dùng tích cực (tài khoản)
// =============================================

const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Tên người dùng là bắt buộc"],
      trim: true,
      maxlength: [100, "Tên không được vượt quá 100 ký tự"],
    },

    email: {
      type: String,
      unique: true,
      sparse: true, // Cho phép null (user ẩn danh không có email)
      lowercase: true,
      trim: true,
    },

    // Điểm uy tín – dùng trong Trust Score
    reputationScore: {
      type: Number,
      default: 50,   // Bắt đầu ở mức trung bình
      min: 0,
      max: 100,
    },

    // Thống kê báo cáo
    totalReports: {
      type: Number,
      default: 0,
    },

    // Số báo cáo được xác nhận là hợp lệ
    validReports: {
      type: Number,
      default: 0,
    },

    // Số báo cáo bị đánh dấu là spam / sai
    invalidReports: {
      type: Number,
      default: 0,
    },

    // Quyền xác nhận báo cáo của người khác (mở khoá khi đủ uy tín)
    canConfirmReports: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: ["citizen", "admin"],
      default: "citizen",
    },

    isAnonymous: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // tự thêm createdAt & updatedAt
  }
);

// ── Virtual: tỷ lệ báo cáo hợp lệ ──────────────────────────────────────────
UserSchema.virtual("validRate").get(function () {
  if (this.totalReports === 0) return 0;
  return ((this.validReports / this.totalReports) * 100).toFixed(1);
});

// ── Method: mở khoá quyền xác nhận khi reputation >= 70 ────────────────────
UserSchema.methods.checkAndUnlockConfirmRight = function () {
  if (this.reputationScore >= 70 && !this.canConfirmReports) {
    this.canConfirmReports = true;
  }
};

// ── Static: tìm hoặc tạo user ẩn danh dùng chung ───────────────────────────
UserSchema.statics.getAnonymousUser = async function () {
  let anon = await this.findOne({ isAnonymous: true });
  if (!anon) {
    anon = await this.create({
      name: "Anonymous",
      reputationScore: 30, // uy tín thấp hơn mặc định
      isAnonymous: true,
    });
  }
  return anon;
};

module.exports = mongoose.model("User", UserSchema);