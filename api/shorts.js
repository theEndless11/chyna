const fetch = require('node-fetch');
const AWS = require('aws-sdk');

const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_SECRET = process.env.B2_SECRET;
const BUCKET = 'Lizard';
const BUCKET_ID = process.env.B2_BUCKET_ID;

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

  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` }
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('B2 auth failed:', errorText);
    throw new Error(`Backblaze authorize failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  b2Auth = {
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    authToken: data.authorizationToken,
  };
  // Token expires in 24 hours, refresh 5 min before expiry
  b2AuthExpiresAt = now + (24 * 60 * 60 * 1000) - (5 * 60 * 1000);

  return b2Auth;
}

// Generate signed URL for a given file
async function generateSignedUrl(fileName) {
  try {
    const { apiUrl, authToken, downloadUrl } = await b2AuthorizeAccount();

    const res = await fetch(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: BUCKET_ID,
        fileNamePrefix: fileName,
        validDurationInSeconds: 86400 // 24 hours access
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('B2 download auth failed:', errorText);
      throw new Error(`Backblaze get_download_authorization failed: ${res.status}`);
    }

    const data = await res.json();
    const downloadAuthToken = data.authorizationToken;

    // Use the correct download URL format
    // For private buckets, we need to use the download URL with proper encoding
    const encodedFileName = encodeURIComponent(fileName).replace(/%2F/g, '/');
    const signedUrl = `${downloadUrl}/file/${BUCKET}/${encodedFileName}?Authorization=${downloadAuthToken}`;
    
    console.log('Generated signed URL for:', fileName);
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
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
  console.log('Handler called, method:', req.method);

  // Check environment variables
  if (!B2_KEY_ID || !B2_SECRET || !BUCKET_ID) {
    console.error('Missing Backblaze credentials or bucket ID');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
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

    console.log('Found metadata files:', metadataKeys.length);

    // Fetch and parse metadata
    const shorts = await Promise.all(
      metadataKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: key
          }).promise();

          const metadata = JSON.parse(obj.Body.toString('utf-8'));

          // Generate signed URLs for video and thumbnail
          if (metadata.videoUrl && !metadata.videoUrl.startsWith('http')) {
            try {
              metadata.videoUrl = await generateSignedUrl(metadata.videoUrl);
              console.log('Video URL generated for:', metadata.title);
            } catch (e) {
              console.error('Failed to generate signed URL for video:', metadata.videoUrl, e.message);
              metadata.videoUrl = null; // Set to null if failed
            }
          }
          
          if (metadata.thumbnailUrl && !metadata.thumbnailUrl.startsWith('http')) {
            try {
              metadata.thumbnailUrl = await generateSignedUrl(metadata.thumbnailUrl);
              console.log('Thumbnail URL generated for:', metadata.title);
            } catch (e) {
              console.error('Failed to generate signed URL for thumbnail:', metadata.thumbnailUrl, e.message);
              metadata.thumbnailUrl = null; // Set to null if failed
            }
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

    console.log('Returning shorts:', filtered.length);
    res.json({ success: true, shorts: filtered });

  } catch (error) {
    console.error('Error fetching shorts:', error);
    res.status(500).json({
      error: 'Failed to fetch shorts',
      details: error.message
    });
  }
};

