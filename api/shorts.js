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
    console.log('userId query param:', userId);

    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();

    const allKeys = list.Contents?.map(item => item.Key) || [];
    const metadataKeys = allKeys.filter(key => 
      key.startsWith('meta-') && key.endsWith('.json')
    );

    const shorts = await Promise.all(
      metadataKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({ Bucket: BUCKET, Key: key }).promise();
          const body = obj.Body.toString('utf-8');

          const metadata = JSON.parse(body);

          // ✅ Clean URLs with .trim()
          metadata.videoUrl = metadata.videoUrl?.trim();
          metadata.thumbnailUrl = metadata.thumbnailUrl?.trim();

          // ✅ Ensure full absolute URLs
          if (metadata.videoUrl && !metadata.videoUrl.startsWith('http')) {
            metadata.videoUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.videoUrl}`;
          }
          if (metadata.thumbnailUrl && !metadata.thumbnailUrl.startsWith('http')) {
            metadata.thumbnailUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.thumbnailUrl}`;
          }

          return metadata;
        } catch (e) {
          console.error('Error parsing metadata file:', key, e.message);
          return null;
        }
      })
    );

    const validShorts = shorts.filter(s => s !== null);

    const filtered = userId
      ? validShorts.filter(s => s.userId === userId)
      : validShorts;

    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, shorts: filtered });
  } catch (error) {
    console.error('❌ Error fetching shorts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch shorts', 
      details: error.message 
    });
  }
};
