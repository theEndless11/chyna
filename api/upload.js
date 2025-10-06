import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { filename, contentType, userId } = req.body;
  if (!filename || !contentType || !userId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // Create a unique key
  const timestamp = Date.now();
  const key = `videos/${userId}-${timestamp}-${filename}`;

  const params = {
    Bucket: 'Lizard',
    Key: key,
    Expires: 60 * 5, // 5 min expiry
    ContentType: contentType,
    ACL: 'public-read'
  };

  try {
    const uploadUrl = await s3.getSignedUrlPromise('putObject', params);
    res.status(200).json({ uploadUrl, key });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Could not generate signed URL' });
  }
};
