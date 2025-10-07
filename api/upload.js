const fetch = require('node-fetch');

// Backblaze B2 Native API Upload
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Parse body if needed
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const { filename, contentType, userId } = body;

  if (!filename || !contentType || !userId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // Step 1: Authorize with B2
    const authString = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_SECRET}`).toString('base64');
    const authResponse = await fetch(
      'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
      {
        headers: {
          Authorization: `Basic ${authString}`
        }
      }
    );

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('B2 Auth failed:', errorText);
      throw new Error(`B2 Auth failed: ${authResponse.status}`);
    }

    const authData = await authResponse.json();
    const { authorizationToken, apiUrl } = authData;

    // Step 2: Get upload URL
    const uploadUrlResponse = await fetch(
      `${apiUrl}/b2api/v2/b2_get_upload_url`,
      {
        method: 'POST',
        headers: {
          Authorization: authorizationToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bucketId: process.env.B2_BUCKET_ID })
      }
    );

    if (!uploadUrlResponse.ok) {
      const errorText = await uploadUrlResponse.text();
      console.error('Get upload URL failed:', errorText);
      throw new Error(`Get upload URL failed: ${uploadUrlResponse.status}`);
    }

    const uploadData = await uploadUrlResponse.json();
    const { uploadUrl, authorizationToken: uploadToken } = uploadData;

    const timestamp = Date.now();
    const key = `${userId}-${timestamp}-${filename}`;

    // Return upload URL and token to frontend
    res.status(200).json({
      uploadUrl,
      uploadToken,
      key,
      contentType
    });
  } catch (error) {
    console.error('B2 API Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get upload URL',
      details: error.message 
    });
  }
}
