import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createCoupon } from "./stripe.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ======================
   QUESTIONS API
====================== */
const QUESTIONS = [
  {
    question: "What does CTR stand for in AdTech?",
    options: [
      "Click Through Rate",
      "Cost To Revenue",
      "Customer Tracking Ratio",
      "Campaign Time Range"
    ],
    answer: "Click Through Rate"
  },
  {
    question: "What is A/B testing?",
    options: [
      "Comparing two ad versions",
      "Stopping ads",
      "Audience blocking",
      "Fraud detection"
    ],
    answer: "Comparing two ad versions"
  }
];

app.get("/api/question", (req, res) => {
  const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  res.json(q);
});

// Debug route to inspect registered routes
app.get('/_routes', (req, res) => {
  const routes = [];
  if (app._router && app._router.stack) {
    app._router.stack.forEach((mw) => {
      if (mw.route) {
        const methods = Object.keys(mw.route.methods).join(',').toUpperCase();
        routes.push({ path: mw.route.path, methods });
      }
    });
  }
  res.json(routes);
});

/* ======================
   STRIPE COUPON API
====================== */
app.post("/api/create-coupon", async (req, res) => {
  console.log("POST /api/create-coupon called", { body: req.body });
  try {
    const coupon = await createCoupon();
    console.log("Coupon created:", coupon);
    return res.json({ code: coupon.name, mock: !!coupon.mock });
  } catch (error) {
    console.error("create-coupon error:", error);

    const strict = String(process.env.STRICT_STRIPE_ERRORS || "false").toLowerCase() === "true";
    if (strict) {
      // Surface the real error to the client for strict mode
      return res.status(500).json({ error: error.message || "Stripe error" });
    }

    // Fallback to mock coupon
    const mock = {
      id: `mock_${Date.now()}`,
      name: `ADTECH10-MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      percent_off: 10,
      duration: 'once',
      mock: true
    };
    return res.json({ code: mock.name, mock: true });
  }
});

// Synchronous test endpoint that returns a mock coupon (useful if Stripe is not configured)
app.get('/api/create-coupon-test', (req, res) => {
  const mock = {
    id: `mock_${Date.now()}`,
    name: 'ADTECH10-MOCK-TEST',
    percent_off: 10,
    duration: 'once',
    mock: true
  };
  res.json({ code: mock.name, mock });
});

/* DEBUG: list registered routes */
const listRoutes = () => {
  console.log('Registered routes:');
  if (!app._router || !app._router.stack) {
    console.log('  No routes found (app._router not initialized yet)');
    return;
  }
  app._router.stack.forEach((mw) => {
    if (mw.route) {
      const methods = Object.keys(mw.route.methods).join(',').toUpperCase();
      console.log(`  ${methods} ${mw.route.path}`);
    } else if (mw.name === 'router' && mw.handle && mw.handle.stack) {
      mw.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).join(',').toUpperCase();
          console.log(`  ${methods} ${handler.route.path}`);
        }
      });
    }
  });
};

listRoutes();

/* ======================
   SERVER START
====================== */
app.listen(5000, () => {
  console.log("✅ Backend running at http://localhost:5000");
});
