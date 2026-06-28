// =============================================
// database/db-config.js
// Kết nối MongoDB qua Mongoose
// =============================================

const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || "mongodb://localhost:27017/smartcitizen";

    const conn = await mongoose.connect(uri, {
      // Mongoose 8+ không cần các option cũ nữa
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Lắng nghe các sự kiện connection
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB disconnected. Attempting to reconnect...");
    });

  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1); // Dừng server nếu không kết nối được DB
  }
};

module.exports = connectDB;