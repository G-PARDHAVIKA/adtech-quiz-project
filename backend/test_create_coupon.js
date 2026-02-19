import fetch from 'node-fetch';

(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/create-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.text();
    console.log('Status:', res.status);
    console.log('Response body:', data);
  } catch (err) {
    console.error('Fetch error:', err);
  }
})();