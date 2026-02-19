import { createCoupon } from './stripe.js';

(async () => {
  try {
    const c = await createCoupon();
    console.log('Coupon result:', c);
  } catch (err) {
    console.error('createCoupon error:', err);
  }
})();