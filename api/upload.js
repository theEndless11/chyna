const fetch = require('node-fetch');

// Vercel requires this for Node.js API routes
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.error('Invalid JSON body:', body);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const { filename, contentType, userId } = body;

  if (!filename || !contentType || !userId) {
    console.warn('Missing parameters:', { filename, contentType, userId });
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    console.log('Starting B2 auth...');

    // Step 1: Authorize B2
    const authString = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_SECRET}`).toString('base64');
    const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: {
        Authorization: `Basic ${authString}`
      }
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('B2 Auth failed:', errorText);
      return res.status(500).json({ error: 'B2 authorization failed', details: errorText });
    }

    const authData = await authResponse.json();
    const { authorizationToken, apiUrl } = authData;

    console.log('Authorized B2. Getting upload URL...');

    // Step 2: Get upload URL
    const uploadUrlResponse = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
      method: 'POST',
      headers: {
        Authorization: authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ bucketId: process.env.B2_BUCKET_ID })
    });

    if (!uploadUrlResponse.ok) {
      const errorText = await uploadUrlResponse.text();
      console.error('Get upload URL failed:', errorText);
      return res.status(500).json({ error: 'Failed to get upload URL', details: errorText });
    }

    const uploadData = await uploadUrlResponse.json();
    const { uploadUrl, authorizationToken: uploadToken } = uploadData;

    const timestamp = Date.now();
    const key = `${userId}-${timestamp}-${filename}`;

    console.log('Returning signed upload URL:', { uploadUrl, key });

    return res.status(200).json({
      uploadUrl,
      uploadToken,
      key,
      contentType
    });
  } catch (err) {
    console.error('Unexpected B2 API Error:', err.message);
    return res.status(500).json({
      error: 'Unexpected error',
      details: err.message
    });
  }
};

