import AWS from 'aws-sdk';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

function downloadToTemp(s3key) {
  const tmpPath = path.join(os.tmpdir(), `video-${Date.now()}`);
  const file = fs.createWriteStream(tmpPath);
  return new Promise((resolve, reject) => {
    s3.getObject({ Bucket: 'Lizard', Key: s3key })
      .createReadStream()
      .pipe(file)
      .on('finish', () => resolve(tmpPath))
      .on('error', err => reject(err));
  });
}

function generateThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01.000'],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
        size: '320x240',
      })
      .on('end', () => resolve(thumbnailPath))
      .on('error', err => reject(err));
  });
}

async function uploadToS3(key, body, contentType) {
  return s3.upload({
    Bucket: 'Lizard',
    Key: key,
    Body: body,
    ContentType: contentType,
    ACL: 'public-read'
  }).promise();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { key: videoKey, userId, title, description } = req.body;
    if (!videoKey || !userId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Download the video to temp
    const tempVideoPath = await downloadToTemp(videoKey);
    const thumbnailPath = path.join(os.tmpdir(), `thumb-${Date.now()}.png`);
    await generateThumbnail(tempVideoPath, thumbnailPath);

    const thumbnailBuffer = fs.readFileSync(thumbnailPath);

    const metaTimestamp = Date.now();
    const thumbKey = `thumbnails/${userId}-${metaTimestamp}.png`;
    const metaKey = `metadata/${userId}-${metaTimestamp}.json`;

    // Upload thumbnail
    const thumbUpload = await uploadToS3(thumbKey, thumbnailBuffer, 'image/png');

    // Build metadata
    const metadata = {
      id: `${userId}-${metaTimestamp}`,
      userId,
      title,
      description,
      uploadedAt: new Date().toISOString(),
      videoUrl: `https://s3.eu-central-003.backblazeb2.com/Lizard/${videoKey}`,
      thumbnailUrl: thumbUpload.Location,
      hearts: 0,
      comments: 0,
      views: 0
    };

    // Upload metadata JSON
    await uploadToS3(metaKey, JSON.stringify(metadata), 'application/json');

    res.status(200).json({ success: true, short: metadata });
  } catch (error) {
    console.error('Error in saveMetadata:', error);
    res.status(500).json({ error: 'Failed in metadata', details: error.message });
  }
}
