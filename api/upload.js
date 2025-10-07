const fetch = require('node-fetch');

// Disable automatic body parsing
module.exports = async function handler(req, res) {
  try {
    console.log('=== Upload API Called ===');
    console.log('Method:', req.method);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      console.log('OPTIONS request');
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      console.log('Wrong method');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('About to read body...');
    
    // Always read body manually - don't access req.body
    const buffers = [];
    
    for await (const chunk of req) {
      console.log('Received chunk:', chunk.length, 'bytes');
      buffers.push(chunk);
    }
    
    const rawBody = Buffer.concat(buffers).toString('utf-8');
    console.log('Raw body:', rawBody);
    
    let body;
    try {
      body = JSON.parse(rawBody);
      console.log('Parsed body:', JSON.stringify(body));
    } catch (e) {
      console.error('Parse error:', e.message);
      return res.status(400).json({ error: 'Invalid JSON', raw: rawBody });
    }

    const { filename, contentType, userId } = body;
    console.log('Extracted:', { filename, contentType, userId });

    if (!filename || !contentType || !userId) {
      return res.status(400).json({ 
        error: 'Missing parameters', 
        received: { filename, contentType, userId }
      });
    }

    console.log('Calling B2 API...');

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
    console.log('B2 authorized, apiUrl:', apiUrl);

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
    console.log('Got upload URL');

    const timestamp = Date.now();
    const key = `${userId}-${timestamp}-${filename}`;

    console.log('Returning success with key:', key);

    // Return upload URL and token to frontend
    return res.status(200).json({
      uploadUrl,
      uploadToken,
      key,
      contentType
    });
  } catch (error) {
    console.error('=== ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Failed to get upload URL',
      details: error.message 
    });
  }
}

// Disable automatic body parsing
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
