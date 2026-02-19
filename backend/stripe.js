import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const getStripe = () => {
  const forceMock = String(process.env.FORCE_MOCK_COUPONS || "false").toLowerCase() === "true";
  if (forceMock) {
    console.log("FORCE_MOCK_COUPONS is enabled — using mock coupons (no Stripe calls)");
    return null;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn(
      "STRIPE_SECRET_KEY is not set. Using mock coupon responder for local development."
    );
    return null; // signal to use mock
  }
  return new Stripe(key, { apiVersion: "2022-11-15" });
};

const makeMockCoupon = () => {
  const code = `ADTECH10-MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    id: `mock_${Date.now()}`,
    name: code,
    percent_off: 10,
    duration: "once",
    mock: true
  };
};

export const createCoupon = async () => {
  const stripe = getStripe();
  if (!stripe) {
    // Return a mock coupon when Stripe key is not set or forced into mock mode
    return makeMockCoupon();
  }

  try {
    const coupon = await stripe.coupons.create({
      percent_off: 10,
      duration: "once",
      name: "ADTECH10"
    });
    return coupon;
  } catch (err) {
    // If authentication fails or any Stripe error occurs
    console.error('Stripe coupon creation failed:', err.message || err);

    const strict = String(process.env.STRICT_STRIPE_ERRORS || "false").toLowerCase() === "true";
    if (strict) {
      // Re-throw so the caller returns 500
      throw err;
    }

    // Otherwise fall back to a mock coupon for local development
    return makeMockCoupon();
  }
};
