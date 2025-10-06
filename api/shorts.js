const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
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

  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request received');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    console.log('Invalid HTTP method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username } = req.query;
    console.log('username query param:', username);

    // List everything in the bucket
    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();

    console.log('listObjectsV2 result:', JSON.stringify(list, null, 2));

    if (!list.Contents) {
      console.log('No Contents in list result.');
      return res.json({ success: true, shorts: [] });
    }

    const allKeys = list.Contents.map(item => item.Key);
    console.log('All Keys:', allKeys);

    // Filter for JSON metadata
    const jsonKeys = allKeys.filter(key => key.toLowerCase().endsWith('.json'));
    console.log('JSON Keys:', jsonKeys);

    const shorts = await Promise.all(
      jsonKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: key
          }).promise();
          const body = obj.Body.toString();
          console.log(`Content of ${key}:`, body);
          const parsed = JSON.parse(body);
          return parsed;
        } catch (e) {
          console.log('Error getting/parsing key:', key, e);
          return null;
        }
      })
    );

    // Filter out any nulls from parse errors
    const validShorts = shorts.filter(s => s != null);
    console.log('Parsed Shorts:', validShorts);

    const filtered = username
      ? validShorts.filter(s => s.username === username)
      : validShorts;

    console.log('Filtered Shorts (after username filter):', filtered);

    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    console.log('Sorted Final Shorts:', filtered);

    res.json({ success: true, shorts: filtered });
  } catch (error) {
    console.error('❌ S3 fetch error (full):', error);
    res.status(500).json({ error: 'Failed to fetch', details: error.message });
  }
};
