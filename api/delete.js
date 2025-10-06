const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: 's3.eu-central-003.backblazeb2.com',
  accessKeyId: 'K003a54JRMDdmTm5HC',
  secretAccessKey: 'joAjLaN9f5xc',
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

const BUCKET = 'lizard';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, username } = req.body || JSON.parse(req.body || '{}');

    if (!id || !username) {
      return res.status(400).json({ error: 'ID and username required' });
    }

    // Get metadata to verify ownership
    const metaObj = await s3.getObject({
      Bucket: BUCKET,
      Key: `metadata/${id}.json`
    }).promise();

    const meta = JSON.parse(metaObj.Body.toString());

    if (meta.username !== username) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Extract video key from URL
    const videoKey = meta.videoUrl.split('.com/')[1];

    // Delete video and metadata
    await Promise.all([
      s3.deleteObject({ Bucket: BUCKET, Key: videoKey }).promise(),
      s3.deleteObject({ Bucket: BUCKET, Key: `metadata/${id}.json` }).promise()
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Delete failed', details: error.message });
  }
};
