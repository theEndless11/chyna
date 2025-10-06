const AWS = require('aws-sdk');
const formidable = require('formidable-serverless');
const fs = require('fs');

const s3 = new AWS.S3({
  endpoint: 's3.eu-central-003.backblazeb2.com',
  accessKeyId: '0032cb5d211d8f30000000001',
  secretAccessKey: 'K003a54JRMDdmTm5HC/joAjLaN9f5xc',
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

const BUCKET = 'lizard';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = new formidable.IncomingForm();
    const data = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    const { username, title, description } = data.fields;
    const videoFile = data.files.video;

    if (!videoFile || !username) {
      return res.status(400).json({ error: 'Video and username required' });
    }

    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    const ext = videoFile.name.split('.').pop();
    const key = `shorts/${username}/${id}.${ext}`;

    // Upload video
    const videoBuffer = fs.readFileSync(videoFile.path);
    await s3.upload({
      Bucket: BUCKET,
      Key: key,
      Body: videoBuffer,
      ContentType: videoFile.type
    }).promise();

    // Save metadata
    const metadata = {
      id,
      username,
      title: title || 'Untitled',
      description: description || '',
      videoUrl: `https://${BUCKET}.s3.eu-central-003.backblazeb2.com/${key}`,
      uploadedAt: new Date().toISOString()
    };

    await s3.putObject({
      Bucket: BUCKET,
      Key: `metadata/${id}.json`,
      Body: JSON.stringify(metadata),
      ContentType: 'application/json'
    }).promise();

    res.json({ success: true, short: metadata });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
};
