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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username } = req.query;
    
    // List metadata files
    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: 'metadata/'
    }).promise();

    // Fetch all metadata
    const shorts = await Promise.all(
      list.Contents.map(async (item) => {
        const obj = await s3.getObject({
          Bucket: BUCKET,
          Key: item.Key
        }).promise();
        return JSON.parse(obj.Body.toString());
      })
    );

    // Filter by username if provided
    let filtered = shorts;
    if (username) {
      filtered = shorts.filter(s => s.username === username);
    }

    // Sort by date
    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, shorts: filtered });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch', details: error.message });
  }
};
