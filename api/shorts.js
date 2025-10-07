
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

const BUCKET = 'Lizard';

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('[api/shorts] OPTIONS request');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    console.log(`[api/shorts] Invalid HTTP method: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;
    console.log('[api/shorts] userId query param:', userId);

    // List all objects in the bucket
    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();

    const allKeys = (list.Contents || []).map(item => item.Key);
    console.log('[api/shorts] Total objects found:', allKeys.length);
    console.log('[api/shorts] All keys:', allKeys);

    // Filter metadata JSON files
    const metadataKeys = allKeys.filter(key => key.startsWith('meta-') && key.endsWith('.json'));
    console.log('[api/shorts] Metadata files found:', metadataKeys);

    // Fetch and parse metadata objects
    const shorts = await Promise.all(
      metadataKeys.map(async (metaKey) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: metaKey
          }).promise();

          const body = obj.Body.toString('utf-8');
          // Print first part for debug
          console.log(`[api/shorts] Content of ${metaKey}:`, body.slice(0, 200));

          const metadata = JSON.parse(body);

          // Trim URLs (remove whitespace, newlines)
          if (metadata.videoUrl) metadata.videoUrl = metadata.videoUrl.trim();
          if (metadata.thumbnailUrl) metadata.thumbnailUrl = metadata.thumbnailUrl.trim();

          console.log(`[api/shorts] After trim — URLs:`, {
            videoUrl: metadata.videoUrl,
            thumbnailUrl: metadata.thumbnailUrl
          });

          // If not absolute, prepend base URL
          if (metadata.videoUrl && !metadata.videoUrl.startsWith('http')) {
            metadata.videoUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.videoUrl}`;
          }
          if (metadata.thumbnailUrl && !metadata.thumbnailUrl.startsWith('http')) {
            metadata.thumbnailUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.thumbnailUrl}`;
          }

          console.log(`[api/shorts] Final URLs:`, {
            videoUrl: metadata.videoUrl,
            thumbnailUrl: metadata.thumbnailUrl
          });

          return metadata;
        } catch (err) {
          console.error(`[api/shorts] Error parsing metadata ${metaKey}:`, err.message);
          return null;
        }
      })
    );

    const validShorts = shorts.filter(s => s !== null);
    console.log('[api/shorts] Valid shorts count:', validShorts.length);

    // If userId parameter provided, filter
    let filtered = validShorts;
    if (userId) {
      filtered = validShorts.filter(s => {
        // Sometimes metadata.userId may be number or string; normalize
        return String(s.userId) === String(userId);
      });
      console.log('[api/shorts] Filtered shorts count (by userId):', filtered.length);
    } else {
      console.log('[api/shorts] No userId filter applied; returning all shorts');
    }

    // Sort by upload time (newest first)
    filtered.sort((a, b) => {
      return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    });

    console.log('[api/shorts] Returning shorts (id, title):', filtered.map(s => ({ id: s.id, title: s.title })));

    return res.json({
      success: true,
      shorts: filtered
    });

  } catch (error) {
    console.error('[api/shorts] ❌ Error fetching shorts:', error);
    return res.status(500).json({
      error: 'Failed to fetch shorts',
      details: error.message
    });
  }
};
