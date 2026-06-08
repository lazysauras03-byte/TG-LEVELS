const rateLimit = require("express-rate-limit");

module.exports = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || "";
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("::ffff:127.") ||
      ip.startsWith("::ffff:192.168.") ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      ip.startsWith("172.")
    );
  },
});
