// Use require for better Vercel compatibility
const axios = require('axios');

// Backblaze B2 Native API Upload
export default async function handler(req, res) {
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

  const { filename, contentType, userId } = req.body;

  if (!filename || !contentType || !userId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // Step 1: Authorize with B2
    const authResponse = await axios.get(
      'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
      {
        auth: {
          username: process.env.B2_KEY_ID,
          password: process.env.B2_SECRET
        }
      }
    );

    const { authorizationToken, apiUrl } = authResponse.data;

    // Step 2: Get upload URL
    const uploadUrlResponse = await axios.post(
      `${apiUrl}/b2api/v2/b2_get_upload_url`,
      { bucketId: process.env.B2_BUCKET_ID },
      {
        headers: {
          Authorization: authorizationToken
        }
      }
    );

    const { uploadUrl, authorizationToken: uploadToken } = uploadUrlResponse.data;

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
    console.error('B2 API Error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get upload URL',
      details: error.response?.data || error.message 
    });
  }
}
