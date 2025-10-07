const fetch = require('node-fetch');

// Backblaze B2 Native API Upload
module.exports = async function handler(req, res) {
  console.log('=== Upload API Called ===');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Body type:', typeof req.body);
  console.log('Body:', req.body);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - returning 200');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Parse body if needed
  let body = req.body;
  console.log('Initial body:', body);
  
  if (typeof body === 'string') {
    console.log('Body is string, attempting to parse...');
    try {
      body = JSON.parse(body);
      console.log('Parsed body:', body);
    } catch (e) {
      console.error('JSON parse error:', e.message);
      return res.status(400).json({ error: 'Invalid JSON body', rawBody: body });
    }
  }

  const { filename, contentType, userId } = body || {};
  console.log('Extracted params:', { filename, contentType, userId });

  if (!filename || !contentType || !userId) {
    console.log('Missing params - returning 400');
    return res.status(400).json({ 
      error: 'Missing parameters', 
      received: { filename, contentType, userId },
      bodyType: typeof req.body,
      body: req.body
    });
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

