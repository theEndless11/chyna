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
const S3_BASE = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('[api/shorts] OPTIONS request received');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    console.log('[api/shorts] Invalid HTTP method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;
    console.log('[api/shorts] userId query param:', userId || 'undefined');

    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();

    console.log('[api/shorts] Total objects found:', list.Contents?.length || 0);

    if (!list.Contents || list.Contents.length === 0) {
      console.log('[api/shorts] No contents in bucket');
      return res.json({ success: true, shorts: [] });
    }

    const allKeys = list.Contents.map(item => item.Key);
    console.log('[api/shorts] All keys:', allKeys);

    const metadataKeys = allKeys.filter(key =>
      key.startsWith('meta-') && key.endsWith('.json')
    );

    console.log('[api/shorts] Metadata files found:', metadataKeys);

    const shorts = await Promise.all(
      metadataKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: key
          }).promise();

          const body = obj.Body.toString('utf-8');
          const metadata = JSON.parse(body);

          // Force S3-compatible URLs for both video and thumbnail
          if (metadata.videoUrl) {
            const fileName = metadata.videoUrl.split('/').pop(); // just the filename
            metadata.videoUrl = `${S3_BASE}/${fileName}`;
          }

          if (metadata.thumbnailUrl) {
            const thumbName = metadata.thumbnailUrl.split('/').pop();
            metadata.thumbnailUrl = `${S3_BASE}/${thumbName}`;
          }

          console.log('[api/shorts] Final URLs:', {
            videoUrl: metadata.videoUrl,
            thumbnailUrl: metadata.thumbnailUrl
          });

          return metadata;
        } catch (e) {
          console.error('[api/shorts] Error parsing metadata file:', key, e.message);
          return null;
        }
      })
    );

    const validShorts = shorts.filter(s => s !== null);
    console.log('[api/shorts] Valid shorts count:', validShorts.length);

    const filtered = userId
      ? validShorts.filter(s => s.userId === userId)
      : validShorts;

    console.log(
      userId
        ? `[api/shorts] Filtered by userId=${userId}, count: ${filtered.length}`
        : '[api/shorts] No userId filter applied; returning all shorts'
    );

    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    console.log('[api/shorts] Returning shorts (id, title):', filtered.map(s => ({ id: s.id, title: s.title })));

    res.json({ success: true, shorts: filtered });
  } catch (error) {
    console.error('[api/shorts] ❌ Error fetching shorts:', error);
    res.status(500).json({
      error: 'Failed to fetch shorts',
      details: error.message
    });
  }
};
