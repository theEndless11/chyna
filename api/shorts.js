const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com', // Added protocol
  region: 'eu-central-003', // Optional but recommended
  accessKeyId: '0032cb5d211d8f30000000001',
  secretAccessKey: 'K003a54JRMDdmTm5HC/joAjLaN9f5xc',
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

const BUCKET = 'Lizard';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

 try {
  const { username } = req.query;

  const list = await s3.listObjectsV2({
    Bucket: BUCKET,
    Prefix: ''
  }).promise();

  console.log("📦 Object Keys in Bucket:", list.Contents.map(item => item.Key));

  const shorts = await Promise.all(
    list.Contents
      .filter(item => item.Key.endsWith('.json'))
      .map(async (item) => {
        const obj = await s3.getObject({
          Bucket: BUCKET,
          Key: item.Key
        }).promise();

        const parsed = JSON.parse(obj.Body.toString());
        console.log("✅ Parsed:", parsed);
        return parsed;
      })
  );

  const filtered = username
    ? shorts.filter(s => s.username === username)
    : shorts;

  filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  res.json({ success: true, shorts: filtered });
} catch (error) {
  console.error('❌ S3 fetch error:', error);
  res.status(500).json({ error: 'Failed to fetch', details: error.message });
}
};

