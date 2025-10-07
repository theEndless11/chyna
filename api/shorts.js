const axios = require('axios');
const AWS = require('aws-sdk');

const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_SECRET = process.env.B2_SECRET;
const BUCKET = 'Lizard';
const BUCKET_ID = process.env.B2_BUCKET_ID; // You must provide your B2 Bucket ID here

// Cache B2 auth info for reuse
let b2Auth = null;
let b2AuthExpiresAt = 0;

// Get B2 authorization token and apiUrl
async function b2AuthorizeAccount() {
  const now = Date.now();
  if (b2Auth && now < b2AuthExpiresAt) {
    return b2Auth;
  }

  const auth = Buffer.from(`${B2_KEY_ID}:${B2_SECRET}`).toString('base64');

  const res = await axios.get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${auth}` }
  });

  b2Auth = {
    apiUrl: res.data.apiUrl,
    downloadUrl: res.data.downloadUrl,
    authToken: res.data.authorizationToken,
  };
  // Token expires in 24 hours, refresh 5 min before expiry
  b2AuthExpiresAt = now + (24 * 60 * 60 * 1000) - (5 * 60 * 1000);

  return b2Auth;
}

// Generate signed URL for a given file
async function generateSignedUrl(fileName) {
  const { apiUrl, authToken } = await b2AuthorizeAccount();

  const res = await axios.post(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
    bucketId: BUCKET_ID,
    fileNamePrefix: fileName,
    validDurationInSeconds: 3600 // 1 hour access
  }, {
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json'
    }
  });

  const downloadAuthToken = res.data.authorizationToken;
  // Construct full signed URL
  return `https://f003.backblazeb2.com/file/${BUCKET}/${encodeURIComponent(fileName)}?Authorization=${downloadAuthToken}`;
}

// Your existing s3 client, still used for listing and fetching metadata
const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: B2_KEY_ID,
  secretAccessKey: B2_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    // List all objects in the bucket
    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();

    if (!list.Contents || list.Contents.length === 0) {
      return res.json({ success: true, shorts: [] });
    }

    // Filter metadata files only
    const metadataKeys = list.Contents
      .map(item => item.Key)
      .filter(key => key.startsWith('meta-') && key.endsWith('.json'));

    // Fetch and parse metadata
    const shorts = await Promise.all(
      metadataKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: key
          }).promise();

          const metadata = JSON.parse(obj.Body.toString('utf-8'));

          // Generate signed URLs for video and thumbnail if not absolute
          if (metadata.videoUrl && !metadata.videoUrl.startsWith('http')) {
            metadata.videoUrl = await generateSignedUrl(metadata.videoUrl);
          }
          if (metadata.thumbnailUrl && !metadata.thumbnailUrl.startsWith('http')) {
            metadata.thumbnailUrl = await generateSignedUrl(metadata.thumbnailUrl);
          }

          return metadata;
        } catch (e) {
          console.error('Error parsing metadata file:', key, e.message);
          return null;
        }
      })
    );

    const validShorts = shorts.filter(s => s !== null);

    // Filter by userId if provided
    const filtered = userId
      ? validShorts.filter(s => s.userId === userId)
      : validShorts;

    // Sort by uploadedAt descending
    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, shorts: filtered });

  } catch (error) {
    console.error('Error fetching shorts:', error);
    res.status(500).json({
      error: 'Failed to fetch shorts',
      details: error.message
    });
  }
};

