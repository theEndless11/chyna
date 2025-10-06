import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import AWS from 'aws-sdk';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';

// Disable default body parser (Next.js requirement for formidable)
export const config = {
  api: {
    bodyParser: false,
  },
};

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: '0032cb5d211d8f30000000001',
  secretAccessKey: 'K003a54JRMDdmTm5HC/joAjLaN9f5xc',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

function parseForm(req) {
  const form = new IncomingForm({ multiples: false });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
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
      .on('error', (err) => reject(err));
  });
}

async function uploadToS3(key, body, contentType) {
  return s3
    .upload({
      Bucket: 'Lizard',
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read', // make accessible publicly or configure accordingly
    })
    .promise();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, files } = await parseForm(req);
    const { userId, title, description } = fields;
    const videoFile = files.video;

    if (!videoFile) return res.status(400).json({ error: 'No video file uploaded' });
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Temp file paths
    const tempVideoPath = videoFile.filepath || videoFile.path; // formidable v2 vs v1
    const tempThumbnailPath = path.join(os.tmpdir(), `thumb-${Date.now()}.png`);

    // Generate thumbnail image from video
    await generateThumbnail(tempVideoPath, tempThumbnailPath);

    // Read thumbnail file
    const thumbnailBuffer = fs.readFileSync(tempThumbnailPath);

    // Generate unique keys for S3
    const timestamp = Date.now();
    const videoKey = `videos/${userId}-${timestamp}-${videoFile.originalFilename}`;
    const thumbKey = `thumbnails/${userId}-${timestamp}.png`;
    const metaKey = `metadata/${userId}-${timestamp}.json`;

    // Upload video and thumbnail
    const [videoUpload, thumbUpload] = await Promise.all([
      uploadToS3(videoKey, fs.createReadStream(tempVideoPath), videoFile.mimetype),
      uploadToS3(thumbKey, thumbnailBuffer, 'image/png'),
    ]);

    // Metadata object
    const metadata = {
      id: `${userId}-${timestamp}`,
      userId,
      title,
      description,
      uploadedAt: new Date().toISOString(),
      videoUrl: videoUpload.Location,
      thumbnailUrl: thumbUpload.Location,
      hearts: 0,
      comments: 0,
      views: 0,
    };

    // Upload metadata JSON
    await uploadToS3(metaKey, JSON.stringify(metadata), 'application/json');

    // Cleanup temp thumbnail file
    fs.unlinkSync(tempThumbnailPath);

    res.status(200).json({ success: true, short: metadata });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
}
